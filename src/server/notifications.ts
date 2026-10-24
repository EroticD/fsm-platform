import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/email";
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
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const PAGE_SIZE = 25;

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

  if (type === "BOOKING" || type === "REPORT_READY") {
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

/**
 * Sender ventende varsel-e-poster. Kalles periodisk av jobbworkeren.
 * Returnerer hvor mange som ble forsøkt sendt.
 */
export async function processPendingNotificationEmails(
  limit = 20,
): Promise<{ processed: number; sent: number }> {
  const pending = await prisma.notification.findMany({
    where: { emailSentAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { user: { select: { email: true } } },
  });

  let sent = 0;
  for (const notification of pending) {
    const email = notification.user.email;
    if (!email) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailSentAt: new Date(), emailError: "Brukeren mangler e-post" },
      });
      continue;
    }

    try {
      const okSent = await sendNotificationEmail(
        email,
        notification.title,
        notification.body ?? "",
        notification.href ?? undefined,
      );
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          emailSentAt: new Date(),
          emailError: okSent ? null : "SMTP er ikke konfigurert",
        },
      });
      if (okSent) sent += 1;
    } catch (error) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          emailError:
            error instanceof Error ? error.message.slice(0, 2000) : "Ukjent feil",
        },
      });
    }
  }

  return { processed: pending.length, sent };
}
