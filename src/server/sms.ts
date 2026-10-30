// i18n-ignore-file: revisjonsloggen lagrer stabile handlingsstrenger på samme
// måte som de øvrige tjenestene; de oversettes ved visning.
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { cleanText, LIMITS } from "@/lib/sanitize";
import {
  getSmsProvider,
  resolveSmsProviderName,
  smsProviderInfo,
  smsSenderId,
  type SmsProviderName,
} from "@/lib/sms/provider";
import {
  isSmsEventKey,
  renderSmsTemplate,
  SMS_DEFAULT_LOCALE,
  SMS_LOCALES,
  smsLocale,
  validateSmsTemplateBody,
  type SmsEventKey,
  type SmsTemplateValues,
} from "@/lib/sms/templates";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Etter tre forsøk gir vi opp og dead-letter meldingen. */
export const MAX_SMS_ATTEMPTS = 3;

/** Første pause før nytt forsøk; dobles for hvert forsøk. */
export const SMS_RETRY_BASE_MS = 30_000;

/** En melding som står i SENDING lenger enn dette har en krasjet worker. */
export const SMS_LOCK_LEASE_MS = 30 * 60_000;

const SMS_POLL_INTERVAL_MS = 5_000;
const SMS_WORKER_CONCURRENCY = 1;

type WorkerGlobal = typeof globalThis & {
  __fsmSmsWorkerStarted?: boolean;
};

const SMS_WORKER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;

let smsRunInProgress = false;

/**
 * Tjenestene kan kjøre på den globale klienten eller på en aktiv transaksjon.
 * 5A kan dermed legge bookingbekreftelsen og SMS-raden i samme transaksjon.
 */
export type SmsDb = Prisma.TransactionClient | PrismaClient;

export type SmsQueueRow = {
  id: string;
  direction: string;
  provider: string;
  to: string;
  body: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  contactId: string | null;
  userId: string | null;
  workOrderId: string | null;
  departmentId: string | null;
  threadId: string | null;
};

export function smsRetryBackoffMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts));
  return Math.min(30 * 60_000, SMS_RETRY_BASE_MS * 2 ** (safeAttempt - 1));
}

function cleanPhone(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function cleanBody(value: unknown): string {
  return cleanText(value, { maxLength: 1600 });
}

/** Whitelist for test og staging: tom betyr «alle numre med samtykke». */
function smsAllowlist(): string[] {
  return (process.env.SMS_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.replace(/[^\d]/g, ""))
    .filter(Boolean);
}

function phoneIsAllowlisted(to: string): boolean {
  const list = smsAllowlist();
  if (list.length === 0) return true;
  const digits = to.replace(/[^\d]/g, "");
  return list.some(
    (allowed) => digits.endsWith(allowed) || allowed.endsWith(digits),
  );
}

/** Standardinnstillingene. Raden opprettes første gang den trengs. */
export async function getSmsSettings(db: SmsDb = prisma) {
  return db.smsSetting.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

export type SmsConsentTarget = {
  contactId?: string | null;
  userId?: string | null;
};

/**
 * Sann bare når mottakeren har en registrert, aktivt samtykke. Manglende rad
 * er «ukjent» og blokkerer utsending – vi antar aldri samtykke.
 */
export async function hasSmsConsent(
  target: SmsConsentTarget,
  db: SmsDb = prisma,
): Promise<boolean> {
  if (target.contactId) {
    const preference = await db.channelPreference.findUnique({
      where: {
        contactId_channel: {
          contactId: target.contactId,
          channel: "SMS",
        },
      },
      select: { optedIn: true, optedOut: true },
    });
    return Boolean(preference?.optedIn && !preference.optedOut);
  }
  if (target.userId) {
    const preference = await db.channelPreference.findUnique({
      where: {
        userId_channel: { userId: target.userId, channel: "SMS" },
      },
      select: { optedIn: true, optedOut: true },
    });
    return Boolean(preference?.optedIn && !preference.optedOut);
  }
  return false;
}

export type SmsEnqueueInput = {
  to: string;
  body: string;
  templateKey?: string | null;
  locale?: string | null;
  contactId?: string | null;
  userId?: string | null;
  workOrderId?: string | null;
  departmentId?: string | null;
  threadId?: string | null;
  provider?: SmsProviderName;
  /** Valgfri transaksjonsklient, slik at 5A kan gjøre alt atomisk. */
  db?: SmsDb;
};

export type SmsEnqueueResult = { id: string; provider: SmsProviderName };

async function withinMonthlyCap(
  departmentId: string | null,
  db: SmsDb,
): Promise<boolean> {
  const settings = await getSmsSettings(db);
  const cap = settings.monthlyCap ?? 0;
  if (cap <= 0) return true;

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const count = await db.smsMessage.count({
    where: {
      direction: "OUTBOUND",
      createdAt: { gte: start },
      ...(departmentId ? { departmentId } : {}),
    },
  });
  return count < cap;
}

/**
 * Legger én utgående SMS i den vedvarende køen. Sending skjer først når en
 * worker henter raden, slik at en treg leverandør ikke blokkerer UI-en.
 */
export async function enqueueSms(
  input: SmsEnqueueInput,
): Promise<ServiceResult<SmsEnqueueResult>> {
  const to = cleanPhone(input.to);
  const body = cleanBody(input.body);
  if (!to || !body) return fail("invalid");

  const db = input.db ?? prisma;

  // Ingen SMS uten et registrert samtykke for en navngitt mottaker.
  if (!(await hasSmsConsent(input, db))) return fail("forbidden");

  if (!phoneIsAllowlisted(to)) return fail("forbidden");

  if (!(await withinMonthlyCap(input.departmentId ?? null, db))) {
    return fail("rate_limited");
  }

  const provider = input.provider ?? resolveSmsProviderName();
  const message = await db.smsMessage.create({
    data: {
      direction: "OUTBOUND",
      provider,
      to,
      body,
      templateKey: input.templateKey?.slice(0, 100) ?? null,
      locale: smsLocale(input.locale),
      contactId: input.contactId ?? null,
      userId: input.userId ?? null,
      workOrderId: input.workOrderId ?? null,
      departmentId: input.departmentId ?? null,
      threadId: input.threadId ?? null,
      status: "QUEUED",
    },
    select: { id: true },
  });

  return ok({ id: message.id, provider });
}

export type SmsConsentInput = {
  contactId?: unknown;
  userId?: unknown;
  optedIn?: unknown;
  source?: unknown;
};

/**
 * Registrerer eller trekker samtykke. Bare kontor/administrasjon kan gjøre
 * dette manuelt; selve reservasjonen kan alltid komme inn via STOP.
 */
export async function setSmsConsent(
  actor: ServiceActor,
  input: SmsConsentInput,
): Promise<ServiceResult> {
  if (
    !actor?.isActive ||
    (!can(actor, "workorders.update") &&
      !can(actor, "workorders.edit") &&
      !can(actor, "customers.manage"))
  ) {
    return fail("forbidden");
  }

  const contactId = cleanText(input.contactId, { maxLength: LIMITS.line });
  const userId = cleanText(input.userId, { maxLength: LIMITS.line });
  if (!contactId && !userId) return fail("invalid");
  if (contactId && userId) return fail("invalid");

  const optedIn = input.optedIn === true || input.optedIn === "true";
  const source = cleanText(input.source, { maxLength: 200 }) || "manual";
  const now = new Date();

  const target = contactId
    ? await prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true, name: true },
      })
    : await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true },
      });
  if (!target) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    const data = {
      optedIn,
      optedOut: !optedIn,
      consentedAt: optedIn ? now : null,
      optedOutAt: optedIn ? null : now,
      source,
    };
    if (contactId) {
      await tx.channelPreference.upsert({
        where: {
          contactId_channel: { contactId, channel: "SMS" },
        },
        update: data,
        create: { contactId, channel: "SMS", ...data },
      });
    } else {
      await tx.channelPreference.upsert({
        where: {
          userId_channel: { userId, channel: "SMS" },
        },
        update: data,
        create: { userId, channel: "SMS", ...data },
      });
    }

    await audit(tx, {
      entityType: contactId ? "Contact" : "User",
      entityId: contactId || userId,
      action: optedIn
        ? `Registrerte SMS-samtykke for ${target.name ?? "mottakeren"}`
        : `Reserverte SMS for ${target.name ?? "mottakeren"}`,
      actor: toAuditActor(actor),
      metadata: { channel: "SMS", optedIn, source },
    });
  });

  return ok(undefined);
}

/** Brukes av webhooken når kunden svarer STOP eller START. */
export async function applyInboundConsent(
  tx: Prisma.TransactionClient,
  input: {
    contactId?: string | null;
    userId?: string | null;
    action: "OPT_OUT" | "OPT_IN";
    source: string;
  },
): Promise<void> {
  if (!input.contactId && !input.userId) return;
  const optedIn = input.action === "OPT_IN";
  const now = new Date();
  const data = {
    optedIn,
    optedOut: !optedIn,
    consentedAt: optedIn ? now : null,
    optedOutAt: optedIn ? null : now,
    source: input.source.slice(0, 200),
  };

  if (input.contactId) {
    await tx.channelPreference.upsert({
      where: {
        contactId_channel: {
          contactId: input.contactId,
          channel: "SMS",
        },
      },
      update: data,
      create: { contactId: input.contactId, channel: "SMS", ...data },
    });
  } else if (input.userId) {
    await tx.channelPreference.upsert({
      where: {
        userId_channel: { userId: input.userId, channel: "SMS" },
      },
      update: data,
      create: { userId: input.userId, channel: "SMS", ...data },
    });
  }
}

/** Malen for en hendelse, med norsk som fallback. */
export async function getSmsTemplate(
  eventKey: SmsEventKey,
  locale: string,
) {
  const wanted = smsLocale(locale);
  const rows = await prisma.smsTemplate.findMany({
    where: { eventKey, isActive: true, locale: { in: [wanted, SMS_DEFAULT_LOCALE] } },
    take: 2,
  });
  return rows.find((row) => row.locale === wanted) ?? rows[0] ?? null;
}

export async function renderEventSms(
  eventKey: SmsEventKey,
  locale: string,
  values: SmsTemplateValues,
): Promise<ServiceResult<{ body: string; locale: string }>> {
  const template = await getSmsTemplate(eventKey, locale);
  if (!template) return fail("not_found");
  return ok({
    body: renderSmsTemplate(template.body, values),
    locale: template.locale,
  });
}

export type SmsTemplateInput = {
  eventKey?: unknown;
  locale?: unknown;
  body?: unknown;
  isActive?: unknown;
};

export async function listSmsTemplates(actor: ServiceActor) {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  const templates = await prisma.smsTemplate.findMany({
    orderBy: [{ eventKey: "asc" }, { locale: "asc" }],
    take: 100,
  });
  return ok({ templates });
}

export async function saveSmsTemplate(
  actor: ServiceActor,
  input: SmsTemplateInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  if (!isSmsEventKey(input.eventKey)) return fail("invalid");
  const locale = smsLocale(input.locale);
  const validation = validateSmsTemplateBody(input.body);
  if (!validation.ok) return fail("invalid");

  const isActive = input.isActive !== false && input.isActive !== "false";
  const template = await prisma.smsTemplate.upsert({
    where: {
      eventKey_locale: { eventKey: input.eventKey, locale },
    },
    update: {
      body: String(input.body).trim(),
      variables: validation.variables,
      isActive,
    },
    create: {
      eventKey: input.eventKey,
      locale,
      body: String(input.body).trim(),
      variables: validation.variables,
      isActive,
    },
    select: { id: true },
  });

  return ok({ id: template.id });
}

export type SmsSettingsInput = {
  defaultLocale?: unknown;
  optOutKeywords?: unknown;
  optInKeywords?: unknown;
  monthlyCap?: unknown;
};

function keywordList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,;\n]/);
  return [
    ...new Set(
      raw
        .map((entry) => cleanText(entry, { maxLength: 40 }).toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export async function saveSmsSettings(
  actor: ServiceActor,
  input: SmsSettingsInput,
): Promise<ServiceResult> {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  const defaultLocale = smsLocale(input.defaultLocale).slice(0, 5);
  const optOutKeywords = keywordList(input.optOutKeywords);
  const optInKeywords = keywordList(input.optInKeywords);
  if (optOutKeywords.length === 0 || optInKeywords.length === 0) {
    return fail("invalid");
  }
  const monthlyCap = Math.max(
    0,
    Math.min(1_000_000, Math.round(Number(input.monthlyCap ?? 0) || 0)),
  );

  await prisma.smsSetting.upsert({
    where: { id: "default" },
    update: { defaultLocale, optOutKeywords, optInKeywords, monthlyCap },
    create: {
      id: "default",
      defaultLocale,
      optOutKeywords,
      optInKeywords,
      monthlyCap,
    },
  });
  return ok(undefined);
}

export async function getSmsSettingsView(actor: ServiceActor) {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  const [settings, templates] = await Promise.all([
    getSmsSettings(),
    prisma.smsTemplate.findMany({
      orderBy: [{ eventKey: "asc" }, { locale: "asc" }],
      take: 100,
    }),
  ]);
  return ok({
    settings,
    templates,
    provider: smsProviderInfo(),
    senderId: smsSenderId(),
    locales: SMS_LOCALES,
  });
}

/** Henter og låser neste melding. `SKIP LOCKED` gjør claimet unikt. */
export async function claimNextSmsMessage(
  workerId = SMS_WORKER_ID,
): Promise<SmsQueueRow | null> {
  const rows = await prisma.$queryRaw<SmsQueueRow[]>`
    UPDATE "SmsMessage"
    SET "status" = 'SENDING',
        "lockedAt" = now(),
        "lockedBy" = ${workerId},
        "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id"
      FROM "SmsMessage"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function requeueStaleSmsMessages(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "SmsMessage"
      SET "status" = 'QUEUED',
          "lockedAt" = NULL,
          "lockedBy" = NULL
      WHERE "status" = 'SENDING'
        AND "lockedAt" < now() - interval '30 minutes'
      RETURNING "id"
    `;
    if (rows.length > 0) {
      logger.warn("SMS: requeued stale messages", { count: rows.length });
    }
    return rows.length;
  } catch (error) {
    logger.error("Could not requeue stale SMS messages", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/** Kjører én allerede claimet melding. */
export async function processSmsMessage(
  message: SmsQueueRow,
): Promise<"sent" | "retry" | "dead_letter"> {
  // Samtykket kan ha blitt trukket etter at meldingen ble køet. Da skal den
  // aldri sendes, selv om den allerede har fått en worker.
  if (message.contactId || message.userId) {
    const consent = await hasSmsConsent({
      contactId: message.contactId,
      userId: message.contactId ? null : message.userId,
    });
    if (!consent) {
      await prisma.smsMessage.update({
        where: { id: message.id },
        data: {
          status: "FAILED",
          lastError: "no-consent",
          deadLetteredAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      });
      logger.warn("SMS not sent because consent was withdrawn", {
        smsMessageId: message.id,
      });
      return "dead_letter";
    }
  }

  const provider = getSmsProvider(
    resolveSmsProviderName(message.provider || undefined),
  );

  try {
    const result = await provider.send({
      to: message.to,
      body: message.body,
      senderId: smsSenderId(),
      reference: message.id,
    });

    await prisma.smsMessage.update({
      where: { id: message.id },
      data: {
        status: "SENT",
        provider: result.provider,
        providerId: result.providerId,
        sentAt: new Date(),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    });
    return "sent";
  } catch (error) {
    const lastError = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500);

    if (message.attempts >= MAX_SMS_ATTEMPTS) {
      await prisma.smsMessage.update({
        where: { id: message.id },
        data: {
          status: "DEAD_LETTER",
          lastError,
          deadLetteredAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      });
      logger.error("SMS dead-lettered after the maximum number of attempts", {
        smsMessageId: message.id,
        attempts: message.attempts,
      });
      return "dead_letter";
    }

    const runAt = new Date(Date.now() + smsRetryBackoffMs(message.attempts));
    await prisma.smsMessage.update({
      where: { id: message.id },
      data: {
        status: "QUEUED",
        lastError,
        nextAttemptAt: runAt,
        lockedAt: null,
        lockedBy: null,
      },
    });
    logger.warn("SMS send failed; retrying", {
      smsMessageId: message.id,
      attempts: message.attempts,
      runAt: runAt.toISOString(),
    });
    return "retry";
  }
}

/** Tømmer køen én gang. Brukes av workeren og av tester. */
export async function processSmsQueue(
  limit = 20,
): Promise<{ processed: number; sent: number; deadLettered: number }> {
  if (smsRunInProgress) return { processed: 0, sent: 0, deadLettered: 0 };
  smsRunInProgress = true;
  let processed = 0;
  let sent = 0;
  let deadLettered = 0;

  try {
    for (let index = 0; index < Math.max(1, limit); index += 1) {
      const message = await claimNextSmsMessage();
      if (!message) break;
      processed += 1;
      const outcome = await processSmsMessage(message);
      if (outcome === "sent") sent += 1;
      if (outcome === "dead_letter") deadLettered += 1;
    }
    return { processed, sent, deadLettered };
  } finally {
    smsRunInProgress = false;
  }
}

/**
 * Egen worker-markør, uavhengig av PDF-jobben. SMS-køen kan derfor kjøre når
 * PDF-workeren er slått av, og omvendt.
 */
export function startSmsWorker(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmSmsWorkerStarted) return;
  scope.__fsmSmsWorkerStarted = true;

  void requeueStaleSmsMessages();

  const run = () => {
    void processSmsQueue(SMS_WORKER_CONCURRENCY).catch((error) => {
      logger.error("SMS worker failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  const timer = setInterval(run, SMS_POLL_INTERVAL_MS);
  timer.unref?.();
  logger.info("SMS worker started");
}

export function resetSmsWorkerForTests(): void {
  const scope = globalThis as WorkerGlobal;
  scope.__fsmSmsWorkerStarted = false;
}
