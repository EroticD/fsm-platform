// i18n-ignore-file: utboksens logger og feilkoder er driftsdata, ikke UI-tekst.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { formatAmount } from "@/lib/billing";
import { formatDateLocalized } from "@/lib/dates";
import { cleanEmail, cleanText, LIMITS } from "@/lib/sanitize";
import { logger } from "@/lib/logger";
import {
  createSmtpTransport,
  isSmtpConfigured,
  safeEmailError,
} from "@/lib/email";
import {
  EMAIL_EVENT_KEYS,
  EMAIL_EVENT_MODULES,
  EMAIL_TEST_TEMPLATE,
  isEmailEventKey,
  type EmailEventKey,
  type EmailTemplateKey,
  type EmailTemplatePayload,
} from "@/lib/email-events";
import {
  emailLocale,
  renderTransactionalEmail,
  type EmailBranding,
} from "@/lib/email-templates";
import { moduleEnabled } from "./modules";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import type { ErrorCode } from "@/lib/error-codes";

/**
 * Vedvarende utboks for transaksjons-e-post.
 *
 * Request-stien legger bare en rad i `EmailMessage`. En bakgrunnsworker henter
 * raden med `FOR UPDATE SKIP LOCKED`, renderer en lokalisert mal og sender via
 * den eksisterende SMTP-transporten. Da blokkerer aldri en treg SMTP-server en
 * faktura, et tilbud eller en booking, og hver utsendelse har retry og historikk.
 *
 * Idempotensen ligger i `idempotencyKey`. Samme hendelse/mottaker kan enqueues
 * mange ganger uten å gi flere e-poster, også når flere app-instanser kjenner
 * hendelsen samtidig.
 */

export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_RETRY_BASE_MS = 60_000;
export const EMAIL_RETRY_MAX_MS = 60 * 60_000;
export const EMAIL_STALE_LOCK_MS = 15 * 60_000;
export const EMAIL_OUTBOX_INTERVAL_MS = 15_000;
export const EMAIL_OUTBOX_BATCH_SIZE = 5;

export type EmailSettingsView = {
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  events: Record<EmailEventKey, boolean>;
};

const DEFAULT_EVENTS = Object.fromEntries(
  EMAIL_EVENT_KEYS.map((key) => [key, true]),
) as Record<EmailEventKey, boolean>;

const DEFAULT_SETTINGS: EmailSettingsView = {
  fromName: null,
  fromAddress: null,
  replyTo: null,
  events: DEFAULT_EVENTS,
};

export type EmailEnqueueReason =
  | "queued"
  | "duplicate"
  | "no_recipient"
  | "invalid_recipient"
  | "disabled"
  | "error";

export type EmailEnqueueResult = {
  queued: boolean;
  id: string | null;
  reason: EmailEnqueueReason;
};

export type EnqueueEmailInput = {
  to: string | null | undefined;
  template: EmailTemplateKey;
  locale?: string | null;
  payload: EmailTemplatePayload;
  idempotencyKey: string;
  /** Hendelsestypen som avgjør om administratoren har slått den av. */
  event?: EmailEventKey;
  /** Test-e-post skal kunne sendes uavhengig av av/på-innstillingene. */
  force?: boolean;
};

export type EmailMessageRow = {
  id: string;
  to: string;
  subject: string;
  template: string;
  payload: unknown;
  locale: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  idempotencyKey: string;
  lockedAt: Date | null;
  createdAt: Date;
  sentAt: Date | null;
};

export type EmailProcessOutcome =
  | "sent"
  | "retry"
  | "failed"
  | "deferred"
  | "smtp_off"
  | "skipped";

export type ProcessEmailOutboxResult = {
  skipped: boolean;
  smtpConfigured: boolean;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  deferred: number;
};

export type EmailOutboxMetrics = {
  smtpConfigured: boolean;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  oldestPendingAt: Date | null;
};

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

/** Eksponentiell pause med tak. `attempts` er antall mislykkede forsøk. */
export function emailBackoffMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts));
  const base =
    Number.parseInt(process.env.EMAIL_RETRY_BASE_MS ?? "", 10) ||
    EMAIL_RETRY_BASE_MS;
  return Math.min(base * 2 ** (safeAttempt - 1), EMAIL_RETRY_MAX_MS);
}

function baseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}

function rowEvents(row: {
  quoteSent: boolean;
  invoiceSent: boolean;
  paymentReceived: boolean;
  bookingRequested: boolean;
  bookingConfirmed: boolean;
  bookingCancelled: boolean;
  workOrderAssigned: boolean;
}): Record<EmailEventKey, boolean> {
  return {
    quoteSent: row.quoteSent,
    invoiceSent: row.invoiceSent,
    paymentReceived: row.paymentReceived,
    bookingRequested: row.bookingRequested,
    bookingConfirmed: row.bookingConfirmed,
    bookingCancelled: row.bookingCancelled,
    workOrderAssigned: row.workOrderAssigned,
  };
}

/** Leser innstillingene. Manglende rad betyr «alt på» og standard avsender. */
export async function getEmailSettings(): Promise<EmailSettingsView> {
  try {
    const row = await prisma.emailSettings.findUnique({
      where: { id: "default" },
    });
    if (!row) return DEFAULT_SETTINGS;
    return {
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      replyTo: row.replyTo,
      events: rowEvents(row),
    };
  } catch {
    // En database som ikke er migrert ennå skal ikke stoppe e-postflyten.
    return DEFAULT_SETTINGS;
  }
}

export async function getEmailSettingsView(
  actor: ServiceActor,
): Promise<ServiceResult<EmailSettingsView>> {
  if (!actor.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  return ok(await getEmailSettings());
}

function booleanFrom(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

function validOptionalEmail(value: unknown): { ok: true; value: string } | { ok: false } {
  const raw = cleanText(value, { maxLength: LIMITS.line });
  if (!raw) return { ok: true, value: "" };
  const email = cleanEmail(raw);
  return email ? { ok: true, value: email } : { ok: false };
}

export type SaveEmailSettingsInput = {
  fromName?: unknown;
  fromAddress?: unknown;
  replyTo?: unknown;
  events?: Partial<Record<EmailEventKey, unknown>>;
};

/** Lagrer avsender, reply-to og av/på per hendelsestype. Administrator only. */
export async function saveEmailSettings(
  actor: ServiceActor,
  input: SaveEmailSettingsInput,
): Promise<ServiceResult<EmailSettingsView>> {
  if (!actor.isActive || !can(actor, "settings.manage")) return fail("forbidden");

  const fromAddress = validOptionalEmail(input.fromAddress);
  const replyTo = validOptionalEmail(input.replyTo);
  if (!fromAddress.ok || !replyTo.ok) return fail("invalid");

  const current = await getEmailSettings();
  const events = { ...current.events };
  for (const key of EMAIL_EVENT_KEYS) {
    const value = input.events?.[key];
    if (value !== undefined) events[key] = booleanFrom(value);
  }

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.emailSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        fromName: cleanText(input.fromName, { maxLength: LIMITS.title }) || null,
        fromAddress: fromAddress.value || null,
        replyTo: replyTo.value || null,
        ...events,
        updatedById: actor.id,
      },
      update: {
        fromName: cleanText(input.fromName, { maxLength: LIMITS.title }) || null,
        fromAddress: fromAddress.value || null,
        replyTo: replyTo.value || null,
        ...events,
        updatedById: actor.id,
      },
    });
    await audit(tx, {
      entityType: "EmailSettings",
      entityId: "default",
      action: "Oppdaterte e-postinnstillingene",
      actor: toAuditActor(actor),
      metadata: {
        hasFromAddress: Boolean(fromAddress.value),
        hasReplyTo: Boolean(replyTo.value),
        events,
      },
    });
    return row;
  });

  return ok({
    fromName: saved.fromName,
    fromAddress: saved.fromAddress,
    replyTo: saved.replyTo,
    events: rowEvents(saved),
  });
}

async function loadBranding(): Promise<EmailBranding> {
  try {
    const branding = await prisma.branding.findFirst();
    return {
      companyName: branding?.companyName,
      logoUrl: branding?.logoUrl,
      primaryColor: branding?.primaryColor,
    };
  } catch {
    return {};
  }
}

function headerSafeName(value: string): string {
  return value.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
}

function fromAddress(settings: EmailSettingsView): string {
  return (
    (settings.fromAddress && cleanEmail(settings.fromAddress)) ||
    cleanEmail(process.env.SMTP_USER) ||
    "no-reply@localhost"
  );
}

async function renderFor(
  template: EmailTemplateKey,
  locale: string | null | undefined,
  payload: EmailTemplatePayload,
): Promise<{ subject: string; html: string; text: string; branding: EmailBranding }> {
  const branding = await loadBranding();
  const rendered = renderTransactionalEmail({
    template,
    locale,
    payload,
    branding,
    baseUrl: baseUrl(),
  });
  return { ...rendered, branding };
}

/** Enqueue er idempotent på `idempotencyKey` og kaster aldri. */
export async function enqueueEmail(
  input: EnqueueEmailInput,
): Promise<EmailEnqueueResult> {
  const to = cleanEmail(input.to);
  if (!input.to || !String(input.to).trim()) {
    return { queued: false, id: null, reason: "no_recipient" };
  }
  if (!to) return { queued: false, id: null, reason: "invalid_recipient" };

  const idempotencyKey = cleanText(input.idempotencyKey, {
    maxLength: LIMITS.line,
  });
  if (!idempotencyKey) {
    return { queued: false, id: null, reason: "error" };
  }

  if (input.event && !input.force) {
    const settings = await getEmailSettings();
    if (!settings.events[input.event]) {
      return { queued: false, id: null, reason: "disabled" };
    }
  }

  try {
    const rendered = await renderFor(input.template, input.locale, input.payload);
    const row = await prisma.emailMessage.create({
      data: {
        to,
        subject: rendered.subject,
        template: input.template,
        payload: input.payload as Prisma.InputJsonValue,
        locale: emailLocale(input.locale),
        idempotencyKey,
      },
      select: { id: true },
    });
    return { queued: true, id: row.id, reason: "queued" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      try {
        const existing = await prisma.emailMessage.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        return {
          queued: false,
          id: existing?.id ?? null,
          reason: "duplicate",
        };
      } catch {
        return { queued: false, id: null, reason: "duplicate" };
      }
    }
    logger.error("Email outbox: could not enqueue message", {
      template: input.template,
      error: safeEmailError(error),
    });
    return { queued: false, id: null, reason: "error" };
  }
}

/**
 * Henter og låser neste klare melding. `SKIP LOCKED` gjør at flere prosesser
 * kan dele køen uten å vente på hverandre eller sende samme rad.
 */
export async function claimNextEmailMessage(): Promise<EmailMessageRow | null> {
  const rows = await prisma.$queryRaw<EmailMessageRow[]>`
    UPDATE "EmailMessage"
    SET "status" = 'SENDING',
        "lockedAt" = now()
    WHERE "id" = (
      SELECT "id"
      FROM "EmailMessage"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt", "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

/** Setter meldinger som en krasjet prosess etterlot i SENDING tilbake i køen. */
export async function requeueStaleEmailMessages(
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - EMAIL_STALE_LOCK_MS);
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "EmailMessage"
      SET "status" = 'PENDING',
          "lockedAt" = NULL,
          "nextAttemptAt" = now()
      WHERE "status" = 'SENDING'
        AND "lockedAt" < ${cutoff}
      RETURNING "id"
    `;
    if (rows.length > 0) {
      logger.warn("Email outbox: requeued stale messages", {
        count: rows.length,
      });
    }
    return rows.length;
  } catch (error) {
    logger.error("Email outbox: could not requeue stale messages", {
      error: safeEmailError(error),
    });
    return 0;
  }
}

async function templateModuleAvailable(template: string): Promise<boolean> {
  if (!isEmailEventKey(template)) return template === EMAIL_TEST_TEMPLATE;
  const moduleKey = EMAIL_EVENT_MODULES[template];
  if (moduleKey === "core") return true;
  try {
    return await moduleEnabled(moduleKey);
  } catch {
    // En midlertidig modulfeil skal utsette, ikke forkaste, e-posten.
    return false;
  }
}

async function releaseMessage(
  row: EmailMessageRow,
  outcome: "deferred" | "smtp_off",
): Promise<void> {
  const delay = outcome === "deferred" ? 10 * 60_000 : EMAIL_OUTBOX_INTERVAL_MS;
  try {
    await prisma.emailMessage.update({
      where: { id: row.id },
      data: {
        status: "PENDING",
        lockedAt: null,
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  } catch {
    // Raden blir tatt tilbake av requeueStaleEmailMessages.
  }
}

/**
 * Sender én allerede claimet melding. Retry planlegges med eksponentiell
 * backoff; etter `EMAIL_MAX_ATTEMPTS` mislykkede forsøk blir raden FAILED.
 */
export async function processEmailMessage(
  row: EmailMessageRow,
): Promise<EmailProcessOutcome> {
  if (!isSmtpConfigured()) {
    await releaseMessage(row, "smtp_off");
    return "smtp_off";
  }

  if (!(await templateModuleAvailable(row.template))) {
    await releaseMessage(row, "deferred");
    return "deferred";
  }

  const settings = await getEmailSettings();
  if (
    isEmailEventKey(row.template) &&
    !settings.events[row.template]
  ) {
    // En hendelse som er slått av etter at raden ble laget, skal ikke sendes.
    // Den blir liggende til administratoren slår hendelsen på igjen.
    await releaseMessage(row, "deferred");
    return "deferred";
  }

  try {
    const template = row.template as EmailTemplateKey;
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as EmailTemplatePayload)
        : {};
    const rendered = await renderFor(template, row.locale, payload);
    const transport = createSmtpTransport();

    await transport.sendMail({
      from: `"${headerSafeName(
        settings.fromName ||
          cleanText(rendered.branding.companyName, {
            maxLength: LIMITS.title,
          }) ||
          "FSM System",
      )}" <${fromAddress(settings)}>`,
      to: row.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(settings.replyTo ? { replyTo: cleanEmail(settings.replyTo) } : {}),
    });

    await prisma.emailMessage.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lockedAt: null,
        lastError: null,
        subject: rendered.subject,
        // Payload inneholder personopplysninger (navn, beløp, token). Etter
        // sending trengs den ikke for retry og tømmes.
        payload: {},
      },
    });
    logger.info("Email outbox: sent message", {
      template: row.template,
      attempts: row.attempts,
    });
    return "sent";
  } catch (error) {
    const lastError = safeEmailError(error);
    try {
      const updated = await prisma.emailMessage.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      if (updated.attempts >= EMAIL_MAX_ATTEMPTS) {
        await prisma.emailMessage.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            lockedAt: null,
            lastError,
          },
        });
        logger.error("Email outbox: message failed permanently", {
          template: row.template,
          attempts: updated.attempts,
          error: lastError,
        });
        return "failed";
      }

      const nextAttemptAt = new Date(Date.now() + emailBackoffMs(updated.attempts));
      await prisma.emailMessage.update({
        where: { id: row.id },
        data: {
          status: "PENDING",
          lockedAt: null,
          lastError,
          nextAttemptAt,
        },
      });
      logger.warn("Email outbox: send failed; scheduled retry", {
        template: row.template,
        attempts: updated.attempts,
        error: lastError,
      });
      return "retry";
    } catch (updateError) {
      logger.error("Email outbox: could not update failed message", {
        template: row.template,
        error: safeEmailError(updateError),
      });
      return "failed";
    }
  }
}

/**
 * Prosesserer køen. Uten SMTP er dette en trygg no-op: radene blir liggende
 * PENDING uten å telle som mislykkede forsøk.
 */
export async function processEmailOutbox(
  options: { limit?: number } = {},
): Promise<ProcessEmailOutboxResult> {
  const result: ProcessEmailOutboxResult = {
    skipped: false,
    smtpConfigured: isSmtpConfigured(),
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  };
  if (!result.smtpConfigured) {
    result.skipped = true;
    return result;
  }

  await requeueStaleEmailMessages();
  const limit = Math.max(
    1,
    Math.min(options.limit ?? EMAIL_OUTBOX_BATCH_SIZE, 50),
  );

  for (let index = 0; index < limit; index += 1) {
    let row: EmailMessageRow | null = null;
    try {
      row = await claimNextEmailMessage();
    } catch (error) {
      logger.error("Email outbox: could not claim message", {
        error: safeEmailError(error),
      });
      break;
    }
    if (!row) break;
    result.claimed += 1;

    const outcome = await processEmailMessage(row);
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "retry") result.retried += 1;
    else if (outcome === "failed") result.failed += 1;
    else if (outcome === "deferred") result.deferred += 1;
  }

  if (result.claimed > 0) {
    logger.info("Email outbox: processed batch", {
      claimed: result.claimed,
      sent: result.sent,
      retried: result.retried,
      failed: result.failed,
      deferred: result.deferred,
    });
  }
  return result;
}

/** Sender én bestemt melding (brukes av test-e-posten i innstillingene). */
export async function processEmailMessageById(
  id: string,
): Promise<EmailProcessOutcome> {
  const claimed = await prisma.emailMessage.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "SENDING", lockedAt: new Date() },
  });
  if (claimed.count === 0) return "skipped";
  const row = await prisma.emailMessage.findUnique({ where: { id } });
  if (!row) return "skipped";
  return processEmailMessage(row as EmailMessageRow);
}

/** Aggregerte tall for drift. Inneholder ingen mottakere eller innhold. */
export async function getEmailOutboxMetrics(): Promise<EmailOutboxMetrics> {
  const metrics: EmailOutboxMetrics = {
    smtpConfigured: isSmtpConfigured(),
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    oldestPendingAt: null,
  };

  try {
    const grouped = await prisma.emailMessage.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    for (const group of grouped) {
      const count = group._count._all;
      if (group.status === "PENDING") metrics.pending = count;
      else if (group.status === "SENDING") metrics.sending = count;
      else if (group.status === "SENT") metrics.sent = count;
      else if (group.status === "FAILED") metrics.failed = count;
    }
    const oldest = await prisma.emailMessage.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    metrics.oldestPendingAt = oldest?.createdAt ?? null;
  } catch {
    // Metrics er best effort.
  }
  return metrics;
}

/**
 * Sender en test-e-post fra innstillingene. Går gjennom utboksen, men sendes
 * umiddelbart slik at administratoren får svar på om SMTP virker.
 */
export async function sendTestEmail(
  actor: ServiceActor,
  to: unknown,
): Promise<ServiceResult<{ id: string }>> {
  if (!actor.isActive || !can(actor, "settings.manage")) return fail("forbidden");
  const recipient = cleanEmail(to);
  if (!recipient) return fail("invalid");
  if (!isSmtpConfigured()) return fail("error", { code: "smtp_not_configured" satisfies ErrorCode });

  const queued = await enqueueEmail({
    to: recipient,
    template: EMAIL_TEST_TEMPLATE,
    locale: "nb",
    payload: {},
    idempotencyKey: `test-email:${actor.id}:${randomUUID()}`,
    force: true,
  });
  if (!queued.id) return fail("error", { code: "enqueue_failed" satisfies ErrorCode });

  const outcome = await processEmailMessageById(queued.id);
  if (outcome !== "sent") return fail("error", { code: "send_failed" satisfies ErrorCode });
  return ok({ id: queued.id });
}

// ---------------------------------------------------------------------------
// Oppslag av mottaker og hendelseshjelpere
// ---------------------------------------------------------------------------

type Recipient = { email: string; locale: string };

/**
 * Finner mottakeren: kontaktpersonen først (den har eget språk), deretter
 * kundens e-post, deretter en aktiv portalbruker. Ukjent språk faller til nb.
 */
export async function resolveEmailRecipient(input: {
  customerId?: string | null;
  contactId?: string | null;
}): Promise<Recipient | null> {
  const localeFor = (value: string | null | undefined) =>
    emailLocale(value);

  if (input.contactId && input.customerId) {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: input.contactId, customerId: input.customerId },
        select: { email: true, locale: true },
      });
      const email = cleanEmail(contact?.email);
      if (email) return { email, locale: localeFor(contact?.locale) };
    } catch {
      // Faller tilbake til kundens adresse.
    }
  }

  if (input.customerId) {
    try {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: { email: true },
      });
      const email = cleanEmail(customer?.email);
      if (email) return { email, locale: "nb" };

      const portalUser = await prisma.user.findFirst({
        where: {
          customerId: input.customerId,
          isActive: true,
          role: "CUSTOMER",
          ...(input.contactId ? { contactId: input.contactId } : {}),
        },
        select: { email: true, locale: true },
      });
      const portalEmail = cleanEmail(portalUser?.email);
      if (portalEmail) {
        return { email: portalEmail, locale: localeFor(portalUser?.locale) };
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function safeEnqueue(input: EnqueueEmailInput): Promise<EmailEnqueueResult> {
  try {
    return await enqueueEmail(input);
  } catch (error) {
    logger.error("Email outbox: trigger failed", {
      template: input.template,
      error: safeEmailError(error),
    });
    return { queued: false, id: null, reason: "error" };
  }
}

export type QuoteSentEmailInput = {
  quoteId: string;
  token: string;
  version: number;
  title: string;
  customerName?: string | null;
  reference?: string | null;
  total: { toString(): string } | number | string;
  currency?: string;
  validUntil?: Date | string | null;
  customerId?: string | null;
  contactId?: string | null;
};

/** Enqueuer tilbuds-e-posten med absolutt godkjenningslenke. */
export async function enqueueQuoteSentEmail(
  input: QuoteSentEmailInput,
): Promise<EmailEnqueueResult> {
  const recipient = await resolveEmailRecipient(input);
  if (!recipient) return { queued: false, id: null, reason: "no_recipient" };

  return safeEnqueue({
    to: recipient.email,
    template: "quoteSent",
    event: "quoteSent",
    locale: recipient.locale,
    idempotencyKey: `quote-sent:${input.quoteId}:v${input.version}`,
    payload: {
      title: input.title,
      customerName: input.customerName,
      reference: input.reference,
      amount: formatAmount(input.total, input.currency || "NOK"),
      validUntil: formatDateLocalized(input.validUntil, recipient.locale),
      link: `/tilbud/godkjenn/${encodeURIComponent(input.token)}`,
    },
  });
}

export type InvoiceSentEmailInput = {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  contactId?: string | null;
  customerName?: string | null;
  total: { toString(): string } | number | string;
  currency?: string;
  dueDate?: Date | string | null;
};

/** Enqueuer faktura-e-posten med absolutt lenke til kundeportalen. */
export async function enqueueInvoiceSentEmail(
  input: InvoiceSentEmailInput,
): Promise<EmailEnqueueResult> {
  const recipient = await resolveEmailRecipient(input);
  if (!recipient) return { queued: false, id: null, reason: "no_recipient" };

  return safeEnqueue({
    to: recipient.email,
    template: "invoiceSent",
    event: "invoiceSent",
    locale: recipient.locale,
    idempotencyKey: `invoice-sent:${input.invoiceId}`,
    payload: {
      title: input.invoiceNumber,
      customerName: input.customerName,
      reference: input.invoiceNumber,
      amount: formatAmount(input.total, input.currency || "NOK"),
      dueDate: formatDateLocalized(input.dueDate, recipient.locale),
      link: `/kundeportal/faktura/${encodeURIComponent(input.invoiceId)}`,
    },
  });
}

export type PaymentReceivedEmailInput = {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  contactId?: string | null;
  customerName?: string | null;
  amount: { toString(): string } | number | string;
  currency?: string;
};

/** Enqueuer betalingskvittering når fakturaen er fullt betalt. */
export async function enqueuePaymentReceivedEmail(
  input: PaymentReceivedEmailInput,
): Promise<EmailEnqueueResult> {
  const recipient = await resolveEmailRecipient(input);
  if (!recipient) return { queued: false, id: null, reason: "no_recipient" };

  return safeEnqueue({
    to: recipient.email,
    template: "paymentReceived",
    event: "paymentReceived",
    locale: recipient.locale,
    idempotencyKey: `invoice-paid:${input.invoiceId}`,
    payload: {
      title: input.invoiceNumber,
      customerName: input.customerName,
      reference: input.invoiceNumber,
      amount: formatAmount(input.amount, input.currency || "NOK"),
      link: `/kundeportal/faktura/${encodeURIComponent(input.invoiceId)}`,
    },
  });
}

export type BookingEmailInput = {
  event: "bookingRequested" | "bookingConfirmed" | "bookingCancelled";
  bookingId: string;
  customerId: string;
  contactId?: string | null;
  title: string;
  customerName?: string | null;
  reference?: string | null;
  date?: Date | string | null;
  time?: string | null;
  technicianName?: string | null;
  note?: string | null;
};

const BOOKING_LINK = "/kundeportal/bestillinger";

/** Enqueuer kundens booking-e-post. Kontoret varsles via Notification-køen. */
export async function enqueueBookingEmail(
  input: BookingEmailInput,
): Promise<EmailEnqueueResult> {
  const recipient = await resolveEmailRecipient(input);
  if (!recipient) return { queued: false, id: null, reason: "no_recipient" };

  return safeEnqueue({
    to: recipient.email,
    template: input.event,
    event: input.event,
    locale: recipient.locale,
    idempotencyKey: `${input.event}:${input.bookingId}`,
    payload: {
      title: input.title,
      customerName: input.customerName,
      reference: input.reference,
      date: formatDateLocalized(input.date, recipient.locale),
      time: input.time,
      technicianName: input.technicianName,
      note: input.note,
      link: BOOKING_LINK,
    },
  });
}

export type WorkOrderAssignedEmailInput = {
  workOrderId: string;
  userId: string;
  title: string;
  email?: string | null;
  locale?: string | null;
};

/** Enqueuer et varsel til montøren som ble tildelt et oppdrag. */
export async function enqueueWorkOrderAssignedEmail(
  input: WorkOrderAssignedEmailInput,
): Promise<EmailEnqueueResult> {
  const email = cleanEmail(input.email);
  if (!email) return { queued: false, id: null, reason: "no_recipient" };

  return safeEnqueue({
    to: email,
    template: "workOrderAssigned",
    event: "workOrderAssigned",
    locale: input.locale,
    idempotencyKey: `work-order-assigned:${input.workOrderId}:${input.userId}`,
    payload: {
      title: input.title,
      link: `/mine-oppdrag/${encodeURIComponent(input.workOrderId)}`,
    },
  });
}
