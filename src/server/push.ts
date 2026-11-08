// i18n-ignore-file: revisjonshandlinger og driftslogger er lagrede data, ikke
// UI-tekst. Alle brukervendte tekster kommer fra oversettelseskatalogene.
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { moduleEnabled } from "@/server/modules";
import type { ModuleKey } from "@/lib/modules";
import {
  isSafeNotificationHref,
  notificationHrefForUser,
} from "@/lib/notification-links";
import {
  notificationBodyFor,
  notificationTitleFor,
  translateNotificationText,
} from "@/lib/notification-text";
import { isAdminActor, ok, fail, toAuditActor } from "./actor";
import type { ServiceActor, ServiceResult } from "./actor";
import {
  isPushPlatform,
  pushProviderForPlatform,
  pushProviderStatus,
  type PushPlatform,
  type PushProvider,
  type PushProviderStatus,
} from "@/lib/push";

export const PUSH_TOKEN_MIN_LENGTH = 8;
export const PUSH_TOKEN_MAX_LENGTH = 512;
export const PUSH_APP_VERSION_MAX = 40;
export const PUSH_DEVICE_ID_MAX = 128;

/** Etter fem forsøk gir vi opp en melding. */
export const PUSH_MAX_ATTEMPTS = 5;
/** Hvor lenge en instans eier en melding mens leverandøren kontaktes. */
export const PUSH_LOCK_LEASE_MS = 5 * 60_000;
/** Standard alder før en enhet regnes som foreldet i innstillingene. */
export const PUSH_STALE_DEVICE_DAYS = 90;

const PUSH_WORKER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;
const PUSH_POLL_INTERVAL_MS = 30_000;

type PushGlobal = typeof globalThis & {
  __fsmPushWorkerStarted?: boolean;
};

let pushRunInProgress = false;

export type PushDeviceView = {
  id: string;
  platform: PushPlatform;
  appVersion: string | null;
  deviceId: string | null;
  active: boolean;
  lastSeenAt: Date;
  createdAt: Date;
};

/**
 * Re-autentiserer enheten mot databasen. En gammel økt som er deaktivert siden
 * innlogging skal ikke kunne endre push-registreringen.
 */
async function freshActiveActor(
  actor: ServiceActor,
): Promise<ServiceActor | null> {
  if (!actor.isActive || !actor.id) return null;
  const row = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, isActive: true },
  });
  return row?.isActive ? actor : null;
}

function cleanToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (
    token.length < PUSH_TOKEN_MIN_LENGTH ||
    token.length > PUSH_TOKEN_MAX_LENGTH
  ) {
    return null;
  }
  // FCM-tokens inneholder bokstaver, tall, «:», «_» og «-». APNs-tokens er
  // heksadesimale. Alt annet avvises, slik at et token aldri kan bli en
  // logglinje, URL eller header med vilkårlig innhold.
  return /^[A-Za-z0-9._:\-]+$/.test(token) ? token : null;
}

function cleanOptional(
  value: unknown,
  maxLength: number,
  pattern: RegExp,
): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) return null;
  return pattern.test(text) ? text : null;
}

function appVersion(value: unknown): string | null {
  return cleanOptional(value, PUSH_APP_VERSION_MAX, /^[A-Za-z0-9.+()_\-]+$/);
}

function deviceId(value: unknown): string | null {
  return cleanOptional(value, PUSH_DEVICE_ID_MAX, /^[A-Za-z0-9._:\-]+$/);
}

function pushModuleForType(type: string): ModuleKey | null {
  switch (type) {
    case "BOOKING":
      return "booking";
    case "REPORT_READY":
      return "reports";
    case "INVOICE_PAID":
      return "invoicing";
    default:
      return null;
  }
}

/** Modulvakten som gjelder for varseltypen, hvis noen. */
export async function pushAllowedForType(type: string): Promise<boolean> {
  const moduleKey = pushModuleForType(type);
  if (!moduleKey) return true;
  return moduleEnabled(moduleKey);
}

export type RegisterPushDeviceInput = {
  token: unknown;
  platform: unknown;
  appVersion?: unknown;
  deviceId?: unknown;
};

/**
 * Registrerer eller oppdaterer en mobilenhet. Tokenet er unikt per plattform;
 * en ny innlogging på samme enhet flytter raden til den nye brukeren.
 *
 * Selve tokenet lagres, men logges eller revisjoneres aldri.
 */
export async function registerPushDevice(
  actor: ServiceActor,
  input: RegisterPushDeviceInput,
): Promise<ServiceResult<PushDeviceView>> {
  if (!(await freshActiveActor(actor))) return fail("forbidden");

  const token = cleanToken(input.token);
  const platform = isPushPlatform(input.platform) ? input.platform : null;
  if (!token || !platform) return fail("invalid");

  const version = appVersion(input.appVersion);
  const clientDeviceId = deviceId(input.deviceId);
  if (input.appVersion !== undefined && input.appVersion !== null) {
    if (typeof input.appVersion !== "string" || !version) {
      // En for lang eller ugyldig versjonsstreng er en klientfeil, ikke noe
      // vi skal lagre halvveis.
      if (String(input.appVersion).trim()) return fail("invalid");
    }
  }
  if (input.deviceId !== undefined && input.deviceId !== null) {
    if (typeof input.deviceId !== "string") return fail("invalid");
    if (String(input.deviceId).trim() && !clientDeviceId) return fail("invalid");
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.pushDevice.findUnique({
      where: { platform_token: { platform, token } },
      select: { id: true, userId: true, createdAt: true },
    });

    if (existing) {
      const moved = existing.userId !== actor.id;
      if (moved) {
        // Enheten er nå logget inn på en ny konto. Ventende varsler fra den
        // gamle kontoen skal ikke lekke til den nye brukeren.
        await tx.pushMessage.deleteMany({
          where: {
            deviceId: existing.id,
            status: { in: ["PENDING", "SENDING"] },
          },
        });
      }
      await tx.pushDevice.update({
        where: { id: existing.id },
        data: {
          userId: actor.id,
          appVersion: version,
          deviceId: clientDeviceId,
          active: true,
          lastSeenAt: now,
        },
      });
      await audit(tx, {
        entityType: "PushDevice",
        entityId: existing.id,
        action: moved
          ? "Flyttet push-enhet til en ny bruker"
          : "Oppdaterte push-enhet",
        actor: toAuditActor(actor),
        metadata: {
          platform,
          appVersion: version,
          ownerChanged: moved,
        },
      });
      return ok({
        id: existing.id,
        platform,
        appVersion: version,
        deviceId: clientDeviceId,
        active: true,
        lastSeenAt: now,
        createdAt: existing.createdAt,
      });
    }

    const created = await tx.pushDevice.create({
      data: {
        userId: actor.id,
        platform,
        token,
        appVersion: version,
        deviceId: clientDeviceId,
        active: true,
        lastSeenAt: now,
      },
      select: {
        id: true,
        platform: true,
        appVersion: true,
        deviceId: true,
        active: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
    await audit(tx, {
      entityType: "PushDevice",
      entityId: created.id,
      action: "Registrerte push-enhet",
      actor: toAuditActor(actor),
      metadata: { platform, appVersion: version },
    });
    return ok({
      ...created,
      platform: platform as PushPlatform,
    });
  });
}

/**
 * Avregistrerer en enhet. Bare eieren kan fjerne raden; en fremmed token gir
 * likevel «ok», slik at svaret ikke avslører om tokenet finnes.
 */
export async function unregisterPushDevice(
  actor: ServiceActor,
  input: { token: unknown; platform: unknown },
): Promise<ServiceResult<{ removed: boolean }>> {
  if (!(await freshActiveActor(actor))) return fail("forbidden");

  const token = cleanToken(input.token);
  const platform = isPushPlatform(input.platform) ? input.platform : null;
  if (!token || !platform) return fail("invalid");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.pushDevice.findFirst({
      where: { token, platform, userId: actor.id },
      select: { id: true },
    });
    if (!existing) return ok({ removed: false });

    await tx.pushDevice.delete({ where: { id: existing.id } });
    await audit(tx, {
      entityType: "PushDevice",
      entityId: existing.id,
      action: "Avregistrerte push-enhet",
      actor: toAuditActor(actor),
      metadata: { platform },
    });
    return ok({ removed: true });
  });
}

/** Intern sti for pushvarselet. Booking og faktura har egne målflater. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function pushPathForNotification(
  type: string,
  href: string | null,
): string | null {
  if (!isSafeNotificationHref(href)) {
    if (type === "INVOICE_PAID") return "/faktura";
    if (type === "BOOKING") return "/bookinger";
    return null;
  }

  if (type === "BOOKING") return "/bookinger";

  if (type === "INVOICE_PAID") {
    const invoiceId = /^\/faktura\/([^/?#]+)/.exec(href)?.[1];
    return invoiceId
      ? `/faktura/${safeDecode(invoiceId).slice(0, 64)}`
      : "/faktura";
  }

  if (type === "ASSIGNMENT" || type === "REPORT_READY") {
    const workOrderId = /^\/(?:oppdrag|mine-oppdrag)\/([^/?#]+)/.exec(href)?.[1];
    if (workOrderId && !href.startsWith("/kundeportal")) {
      return `/oppdrag/${safeDecode(workOrderId).slice(0, 64)}`;
    }
  }

  return href;
}

/**
 * Legger varselet i push-utboksen for alle aktive enheter. Idempotensnøkkelen
 * gjør gjentatte kall ufarlige, og modulvakten hindrer push fra en modul som er
 * slått av.
 */
export async function enqueuePushForNotification(notification: {
  id: string;
  userId: string;
  type: string;
}): Promise<number> {
  if (!(await pushAllowedForType(notification.type))) return 0;

  const devices = await prisma.pushDevice.findMany({
    where: { userId: notification.userId, active: true },
    select: { id: true, platform: true },
    take: 50,
  });
  if (devices.length === 0) return 0;

  const result = await prisma.pushMessage.createMany({
    data: devices.map((device) => ({
      idempotencyKey: `${notification.id}:${device.id}`,
      notificationId: notification.id,
      userId: notification.userId,
      deviceId: device.id,
      platform: device.platform,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export type PushQueueRow = {
  id: string;
  idempotencyKey: string;
  notificationId: string | null;
  userId: string;
  deviceId: string;
  platform: string;
  title: string | null;
  body: string | null;
  path: string | null;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  errorCode: string | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  device: {
    id: string;
    token: string;
    platform: string;
    active: boolean;
  };
};

/** Eksponentiell pause: 30 s, 60 s, 120 s, 240 s, maks én time. */
export function pushRetryBackoffMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts));
  return Math.min(60 * 60_000, 30_000 * 2 ** (safeAttempt - 1));
}

/** Setter meldinger som en krasjet prosess etterlot i SENDING tilbake i køen. */
export async function requeueStalePushMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - PUSH_LOCK_LEASE_MS);
  try {
    const result = await prisma.pushMessage.updateMany({
      where: { status: "SENDING", lockedAt: { lt: cutoff } },
      data: { status: "PENDING", lockedAt: null, lockedBy: null },
    });
    if (result.count > 0) {
      logger.warn("Push: requeued stale messages", { count: result.count });
    }
    return result.count;
  } catch (error) {
    logger.error("Could not requeue stale push messages", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function claimNextPushMessage(): Promise<PushQueueRow | null> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - PUSH_LOCK_LEASE_MS);
  const pending = await prisma.pushMessage.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: PUSH_MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: leaseCutoff } }],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 1,
    include: {
      device: {
        select: { id: true, token: true, platform: true, active: true },
      },
    },
  });
  const row = pending[0];
  if (!row) return null;

  const claimed = await prisma.pushMessage.updateMany({
    where: {
      id: row.id,
      status: "PENDING",
      OR: [{ lockedAt: null }, { lockedAt: { lt: leaseCutoff } }],
    },
    data: {
      status: "SENDING",
      lockedAt: now,
      lockedBy: PUSH_WORKER_ID,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;

  return { ...row, attempts: row.attempts + 1, lockedAt: now };
}

type PushProcessDeps = {
  providerForPlatform?: (platform: PushPlatform) => PushProvider;
};

async function finishPushMessage(
  message: PushQueueRow,
  data: Prisma.PushMessageUpdateInput,
): Promise<void> {
  await prisma.pushMessage.update({
    where: { id: message.id },
    data: { ...data, lockedAt: null, lockedBy: null },
  });
}

async function processOnePushMessage(
  message: PushQueueRow,
  deps: PushProcessDeps,
): Promise<"sent" | "skipped" | "failed"> {
  if (!message.device.active) {
    await finishPushMessage(message, {
      status: "SKIPPED",
      errorCode: "inactive_device",
      lastError: "Enheten er deaktivert",
    });
    return "skipped";
  }
  if (!isPushPlatform(message.platform)) {
    await finishPushMessage(message, {
      status: "FAILED",
      errorCode: "invalid_platform",
      lastError: "Ukjent plattform",
    });
    return "failed";
  }

  let title = message.title ?? "";
  let body = message.body;
  let path = message.path;
  let type = "TEST";
  let notificationId: string | null = null;

  if (message.notificationId) {
    const notification = await prisma.notification.findUnique({
      where: { id: message.notificationId },
      include: {
        user: { select: { role: true, locale: true, isActive: true } },
      },
    });
    if (!notification || !notification.user.isActive) {
      await finishPushMessage(message, {
        status: "SKIPPED",
        errorCode: "notification_missing",
        lastError: "Varslet finnes ikke lenger",
      });
      return "skipped";
    }

    if (!(await pushAllowedForType(notification.type))) {
      await finishPushMessage(message, {
        status: "SKIPPED",
        errorCode: "module_disabled",
        lastError: "Modulen er slått av",
      });
      return "skipped";
    }

    type = notification.type;
    title = notificationTitleFor(notification, notification.user.locale);
    body = notificationBodyFor(notification, notification.user.locale);
    const href = notificationHrefForUser(
      notification.user.role,
      notification.type,
      notification.href,
    );
    path = pushPathForNotification(notification.type, href);
    notificationId = notification.id;
  }

  const provider =
    deps.providerForPlatform?.(message.platform) ??
    pushProviderForPlatform(message.platform);
  const payload = {
    token: message.device.token,
    title: title || "FSM",
    body,
    path,
    notificationId,
    type,
  };

  const result = await provider.send(payload);
  if (result.status === "sent") {
    await finishPushMessage(message, {
      status: "SENT",
      sentAt: new Date(),
      errorCode: null,
      lastError: null,
    });
    return "sent";
  }
  if (result.status === "skipped") {
    await finishPushMessage(message, {
      status: "SKIPPED",
      errorCode: "not_configured",
      lastError: "Pushleverandøren er ikke konfigurert",
    });
    return "skipped";
  }

  // Et ugyldig token skal aldri prøves igjen. Enheten deaktiveres, slik at
  // senere varsler ikke køes til den.
  if (result.code === "invalid_token") {
    await prisma.$transaction([
      prisma.pushDevice.updateMany({
        where: { id: message.deviceId },
        data: { active: false },
      }),
      prisma.pushMessage.updateMany({
        where: { id: message.id },
        data: {
          status: "FAILED",
          errorCode: result.code,
          lastError: "Tokenet er ugyldig",
          lockedAt: null,
          lockedBy: null,
        },
      }),
    ]);
    return "failed";
  }

  if (result.retryable && message.attempts < PUSH_MAX_ATTEMPTS) {
    await prisma.pushMessage.update({
      where: { id: message.id },
      data: {
        status: "PENDING",
        errorCode: result.code,
        lastError: result.code,
        nextAttemptAt: new Date(
          Date.now() + pushRetryBackoffMs(message.attempts),
        ),
        lockedAt: null,
        lockedBy: null,
      },
    });
    return "failed";
  }

  await finishPushMessage(message, {
    status: result.retryable ? "DEAD_LETTER" : "FAILED",
    errorCode: result.code,
    lastError: result.code,
    ...(result.retryable ? {} : {}),
  });
  return "failed";
}

/**
 * Tømmer push-utboksen. Flere instanser kan kjøre samtidig: hver rad claim es
 * med en betinget oppdatering, så samme melding aldri sendes to ganger.
 */
export async function processPendingPushMessages(
  limit = 20,
  deps: PushProcessDeps = {},
): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  if (pushRunInProgress) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0 };
  }
  pushRunInProgress = true;

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (let index = 0; index < Math.max(1, limit); index += 1) {
      const message = await claimNextPushMessage();
      if (!message) break;
      processed += 1;
      const outcome = await processOnePushMessage(message, deps);
      if (outcome === "sent") sent += 1;
      if (outcome === "skipped") skipped += 1;
      if (outcome === "failed") failed += 1;
    }
    return { processed, sent, skipped, failed };
  } finally {
    pushRunInProgress = false;
  }
}

export type PushAdminStatus = {
  providers: PushProviderStatus;
  devices: { total: number; active: number; stale: number };
  queue: { pending: number; deadLetter: number; sent24h: number };
  staleDays: number;
  lastSentAt: Date | null;
};

function staleCutoff(days: number, now = new Date()): Date {
  return new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60_000);
}

export async function getPushAdminStatus(
  actor: ServiceActor,
  now = new Date(),
): Promise<ServiceResult<PushAdminStatus>> {
  if (!isAdminActor(actor)) return fail("forbidden");

  const cutoff = staleCutoff(PUSH_STALE_DEVICE_DAYS, now);
  const [total, active, stale, pending, deadLetter, sent24h, lastSent] =
    await Promise.all([
      prisma.pushDevice.count(),
      prisma.pushDevice.count({ where: { active: true } }),
      prisma.pushDevice.count({
        where: {
          OR: [{ active: false }, { lastSeenAt: { lt: cutoff } }],
        },
      }),
      prisma.pushMessage.count({ where: { status: "PENDING" } }),
      prisma.pushMessage.count({ where: { status: "DEAD_LETTER" } }),
      prisma.pushMessage.count({
        where: {
          status: "SENT",
          sentAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
        },
      }),
      prisma.pushMessage.findFirst({
        where: { sentAt: { not: null } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
    ]);

  return ok({
    providers: pushProviderStatus(),
    devices: { total, active, stale },
    queue: { pending, deadLetter, sent24h },
    staleDays: PUSH_STALE_DEVICE_DAYS,
    lastSentAt: lastSent?.sentAt ?? null,
  });
}

/**
 * Sender et testvarsel til administratorens egne registrerte enheter. Uten
 * konfigurert leverandør gjøres ingen nettverkskall.
 */
export async function sendPushTest(
  actor: ServiceActor,
): Promise<
  ServiceResult<{
    queued: number;
    sent: number;
    skipped: number;
    configured: boolean;
  }>
> {
  if (!isAdminActor(actor)) return fail("forbidden");

  const status = pushProviderStatus();
  const configured = status.fcm.configured || status.apns.configured;
  if (!configured) {
    return ok({ queued: 0, sent: 0, skipped: 0, configured: false });
  }

  const devices = await prisma.pushDevice.findMany({
    where: { userId: actor.id, active: true },
    select: { id: true, platform: true },
    take: 20,
  });
  if (devices.length === 0) {
    return ok({ queued: 0, sent: 0, skipped: 0, configured: true });
  }

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { locale: true },
  });
  const locale = user?.locale ?? "nb";
  const title =
    translateNotificationText(locale, "push.test.title") ?? "FSM";
  const body = translateNotificationText(locale, "push.test.body");

  const created = await prisma.pushMessage.createMany({
    data: devices.map((device) => ({
      idempotencyKey: `test:${actor.id}:${device.id}:${randomUUID()}`,
      userId: actor.id,
      deviceId: device.id,
      platform: device.platform,
      title,
      body,
      path: "/varsler",
      status: "PENDING",
    })),
    skipDuplicates: true,
  });

  const processed = await processPendingPushMessages(created.count);
  return ok({
    queued: created.count,
    sent: processed.sent,
    skipped: processed.skipped,
    configured: true,
  });
}

/**
 * Sletter foreldede og deaktiverte enheter. Selve slettingen kaskaderer til
 * push-utboksen, slik at det ikke blir liggende tokens igjen uten eier.
 */
export async function clearStalePushDevices(
  actor: ServiceActor,
  options: { days?: number; now?: Date } = {},
): Promise<ServiceResult<{ deleted: number }>> {
  if (!isAdminActor(actor)) return fail("forbidden");

  const days =
    typeof options.days === "number" && Number.isFinite(options.days)
      ? Math.min(3650, Math.max(1, Math.floor(options.days)))
      : PUSH_STALE_DEVICE_DAYS;
  const cutoff = staleCutoff(days, options.now ?? new Date());

  return prisma.$transaction(async (tx) => {
    const result = await tx.pushDevice.deleteMany({
      where: {
        OR: [{ active: false }, { lastSeenAt: { lt: cutoff } }],
      },
    });
    if (result.count > 0) {
      await audit(tx, {
        entityType: "PushDevice",
        entityId: "stale-devices",
        action: "Slettet foreldede push-enheter",
        actor: toAuditActor(actor),
        metadata: { deleted: result.count, olderThanDays: days },
      });
    }
    return ok({ deleted: result.count });
  });
}

/** Starter push-workeren. Egne flagg gjør at HMR ikke lager flere intervaller. */
export function startPushWorker(): void {
  if (process.env.PUSH_WORKER === "false") return;
  const scope = globalThis as PushGlobal;
  if (scope.__fsmPushWorkerStarted) return;
  scope.__fsmPushWorkerStarted = true;

  void requeueStalePushMessages();

  const run = () => {
    void processPendingPushMessages().catch((error) => {
      logger.error("Push worker failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  const timer = setInterval(run, PUSH_POLL_INTERVAL_MS);
  timer.unref?.();
  logger.info("Push worker started");
}

export function resetPushWorkerForTests(): void {
  const scope = globalThis as PushGlobal;
  scope.__fsmPushWorkerStarted = false;
}
