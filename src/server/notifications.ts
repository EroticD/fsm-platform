import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/email";
import { toDateOnly } from "@/lib/dates";
import { notificationHrefForUser } from "@/lib/notification-links";
import { publishRealtime } from "@/lib/realtime";
import {
  fail,
  ok,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

export const NOTIFICATION_TYPES = [
  "ASSIGNMENT",
  "DATE_CHANGED",
  "CANCELLED",
  "REPORT_READY",
  "BOOKING",
  "CONTRACT_DUE",
  "OVERDUE",
  "CONTACT_UPDATE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const PAGE_SIZE = 25;

/** Hvor lenge en instans eier et varsel mens e-posten sendes. */
const EMAIL_LOCK_LEASE_MS = 5 * 60_000;
/** Etter så mange forsøk gir vi opp e-posten. */
const EMAIL_MAX_ATTEMPTS = 5;

/**
 * Stabil identitet per prosess. Brukes som `emailLockedBy` slik at en annen
 * instans kan se hvem som eier låsen. Selve sendingen bruker en lease, så en
 * krasjet prosess blokkerer ikke varselet for alltid.
 */
const EMAIL_WORKER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;

/**
 * Prosesslokal overlappsvakt. To samtidige kall i samme prosess skal ikke
 * plukke samme kø, selv om databaselåsen allerede hindrer dobbeltsending.
 */
let emailRunInProgress = false;

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export async function listNotifications(
  actor: ServiceActor,
  options: { page?: number; unreadOnly?: boolean } = {},
): Promise<ServiceResult<unknown>> {
  if (!actor.isActive) return fail("forbidden");

  const page = Math.max(1, options.page ?? 1);
  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    ...(options.unreadOnly ? { readAt: null } : {}),
  };

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);

  return ok({
    items,
    total,
    unread,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function countUnreadNotifications(
  actor: ServiceActor,
): Promise<number> {
  if (!actor.isActive) return 0;
  return prisma.notification.count({
    where: { userId: actor.id, readAt: null },
  });
}

export async function markNotificationRead(
  actor: ServiceActor,
  id: unknown,
): Promise<ServiceResult> {
  const notificationId =
    typeof id === "string" ? id.trim().slice(0, 64) : "";
  if (!notificationId) return fail("invalid");

  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count > 0 ? ok(undefined) : fail("not_found");
}

export async function markAllNotificationsRead(
  actor: ServiceActor,
): Promise<ServiceResult> {
  await prisma.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return ok(undefined);
}

export type NotificationPreferenceView = {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
};

export async function getNotificationPreferences(
  actor: ServiceActor,
): Promise<ServiceResult<NotificationPreferenceView[]>> {
  if (!actor.isActive) return fail("forbidden");

  const rows = await prisma.notificationPreference.findMany({
    where: { userId: actor.id },
  });
  const byType = new Map(rows.map((row) => [row.type, row]));

  return ok(
    NOTIFICATION_TYPES.map((type) => {
      const row = byType.get(type);
      return {
        type,
        inApp: row?.inApp ?? true,
        email: row?.email ?? true,
      };
    }),
  );
}

export async function updateNotificationPreferences(
  actor: ServiceActor,
  input: unknown,
): Promise<ServiceResult<NotificationPreferenceView[]>> {
  if (!actor.isActive) return fail("forbidden");
  if (!Array.isArray(input)) return fail("invalid");

  const valid = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const type = String((item as { type?: unknown }).type ?? "");
    if (!isNotificationType(type)) return [];
    return [
      {
        type,
        inApp: Boolean((item as { inApp?: unknown }).inApp),
        email: Boolean((item as { email?: unknown }).email),
      },
    ];
  });

  if (valid.length === 0) return fail("invalid");

  await prisma.$transaction(
    valid.map((preference) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_type: { userId: actor.id, type: preference.type },
        },
        update: {
          inApp: preference.inApp,
          email: preference.email,
        },
        create: {
          userId: actor.id,
          type: preference.type,
          inApp: preference.inApp,
          email: preference.email,
        },
      }),
    ),
  );

  return getNotificationPreferences(actor);
}

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  dedupeKey?: string | null;
};

/**
 * Oppretter ett in-app-varsel. E-post sendes senere av den vedvarende
 * e-postkøen (`processPendingNotificationEmails`), slik at en treg SMTP-server
 * ikke blokkerer handlingen som utløste varselet.
 */
export async function notifyUser(
  input: NotifyInput,
): Promise<{ id: string } | null> {
  const preference = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId: input.userId, type: input.type } },
    select: { inApp: true, email: true },
  });

  const inApp = preference?.inApp ?? true;
  const email = preference?.email ?? true;
  if (!inApp && !email) return null;

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 4000) ?? null,
        href: input.href?.slice(0, 500) ?? null,
        dedupeKey: input.dedupeKey ?? null,
        // Uten e-postpreferanse markeres varselet som «sendt», slik at køen
        // hopper over det. In-app-raden beholdes for historikken.
        emailSentAt: email ? null : new Date(),
      },
      select: { id: true },
    });
    // Beste-forsøk: varselet er allerede opprettet, og en feil her skal ikke
    // gjøre at innsenderen tror varselet ikke ble lagret.
    await publishRealtime("notifications");
    return notification;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return null; // Samme hendelse er allerede varslet.
    }
    throw error;
  }
}

/**
 * Varsler de som følger et oppdrag. Teknikere får alltid; kontoret får
 * booking/rapportvarsler, og kundeportalen får «rapport klar».
 */
export async function notifyWorkOrderEvent(
  workOrderId: string,
  type: NotificationType,
  title: string,
  body: string,
  href: string,
  dedupeKey: string,
): Promise<number> {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      technicians: { select: { id: true } },
    },
  });
  if (!workOrder) return 0;

  const recipients = new Set(workOrder.technicians.map((user) => user.id));

  if (type === "BOOKING" || type === "REPORT_READY" || type === "CONTRACT_DUE" || type === "OVERDUE") {
    const office = await prisma.user.findMany({
      where: {
        departmentId: workOrder.departmentId,
        role: { in: ["ADMIN", "OFFICE"] },
        isActive: true,
      },
      select: { id: true },
      take: 100,
    });
    for (const user of office) recipients.add(user.id);
  }

  if (type === "REPORT_READY" && workOrder.customerId) {
    const portalUsers = await prisma.user.findMany({
      where: {
        customerId: workOrder.customerId,
        role: "CUSTOMER",
        isActive: true,
      },
      select: { id: true },
      take: 100,
    });
    for (const user of portalUsers) recipients.add(user.id);
  }

  let created = 0;
  for (const userId of recipients) {
    const result = await notifyUser({
      userId,
      type,
      title,
      body,
      href,
      dedupeKey: `${dedupeKey}:${userId}`,
    });
    if (result) created += 1;
  }
  return created;
}

/** Varsler én gang per dag om oppdrag som er forfalt. */
export async function notifyOverdueWorkOrders(
  now = new Date(),
): Promise<number> {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const workOrders = await prisma.workOrder.findMany({
    where: {
      deletedAt: null,
      scheduledFor: { lt: today },
      status: { notIn: ["COMPLETED", "CANCELLED"] },
    },
    select: { id: true, title: true },
    take: 100,
  });

  let created = 0;
  for (const workOrder of workOrders) {
    created += await notifyWorkOrderEvent(
      workOrder.id,
      "OVERDUE",
      "Oppdrag er forfalt",
      `Oppdraget «${workOrder.title}» er forfalt.`,
      `/oppdrag/${workOrder.id}`,
      `overdue:${workOrder.id}:${toDateOnly(today)}`,
    );
  }
  return created;
}

/**
 * Sender ventende varsel-e-poster. Kalles periodisk av jobbworkeren.
 * Returnerer hvor mange som ble forsøkt sendt.
 *
 * Flere appinstanser kan kjøre denne samtidig. Hvert varsel hentes først med
 * en betinget `updateMany` som setter en kort lease. Bare instansen som får
 * `count === 1` sender e-posten, så samme varsel aldri går ut to ganger.
 */
export async function processPendingNotificationEmails(
  limit = 20,
): Promise<{ processed: number; sent: number }> {
  if (emailRunInProgress) return { processed: 0, sent: 0 };
  emailRunInProgress = true;

  try {
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - EMAIL_LOCK_LEASE_MS);

    const pending = await prisma.notification.findMany({
      where: {
        emailSentAt: null,
        emailAttempts: { lt: EMAIL_MAX_ATTEMPTS },
        emailNextAttemptAt: { lte: now },
        OR: [
          { emailLockedAt: null },
          { emailLockedAt: { lt: leaseCutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { user: { select: { email: true, role: true } } },
    });

    let sent = 0;
    for (const notification of pending) {
      // Atomisk claim: bare én instans kan gå fra «ulåst/utløpt» til «låst».
      const claimed = await prisma.notification.updateMany({
        where: {
          id: notification.id,
          emailSentAt: null,
          OR: [
            { emailLockedAt: null },
            { emailLockedAt: { lt: leaseCutoff } },
          ],
        },
        data: {
          emailLockedAt: new Date(),
          emailLockedBy: EMAIL_WORKER_ID,
        },
      });
      if (claimed.count !== 1) continue;

      const email = notification.user.email;
      if (!email) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            emailSentAt: new Date(),
            emailError: "Brukeren mangler e-post",
            emailLockedAt: null,
            emailLockedBy: null,
          },
        });
        continue;
      }

      const attempts = notification.emailAttempts + 1;

      try {
        // Samme trygge lenke som i varselvisningen: kundeportalbrukere skal
        // ikke få en e-postlenke til kontorets oppdragssider.
        const emailHref = notificationHrefForUser(
          notification.user.role,
          notification.type,
          notification.href,
        );
        const okSent = await sendNotificationEmail(
          email,
          notification.title,
          notification.body ?? "",
          emailHref ?? undefined,
        );
        if (!okSent) throw new Error("SMTP er ikke konfigurert");

        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            emailSentAt: new Date(),
            emailAttempts: attempts,
            emailError: null,
            emailLockedAt: null,
            emailLockedBy: null,
          },
        });
        sent += 1;
      } catch (error) {
        // Eksponentiell backoff, maks én time. Etter fem forsøk gir vi opp, slik
        // at en ødelagt SMTP-server ikke prøves for alltid.
        const delayMs = Math.min(
          60 * 60_000,
          5 * 60_000 * 2 ** attempts,
        );
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            emailAttempts: attempts,
            emailNextAttemptAt: new Date(Date.now() + delayMs),
            emailError:
              attempts >= EMAIL_MAX_ATTEMPTS
                ? "Gave up"
                : error instanceof Error
                  ? error.message.slice(0, 2000)
                  : "Ukjent feil",
            emailLockedAt: null,
            emailLockedBy: null,
          },
        });
      }
    }

    return { processed: pending.length, sent };
  } finally {
    emailRunInProgress = false;
  }
}
