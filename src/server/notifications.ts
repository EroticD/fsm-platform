// i18n-ignore-file: varseltitler og -tekster lagres i databasen uten key/params-
// kolonner. Render-tid-oversettelse krever skjemaendring i Phase 5B (C-23).
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendNotificationEmail, safeEmailError } from "@/lib/email";
import { toDateOnly } from "@/lib/dates";
import {
  isSafeNotificationHref,
  notificationHrefForUser,
} from "@/lib/notification-links";
import { cleanText } from "@/lib/sanitize";
import { neutralizeUrls } from "@/lib/neutralize-urls";
import { publishRealtime } from "@/lib/realtime";
import {
  notificationBodyFor,
  notificationTitleFor,
  type NotificationTextParams,
} from "@/lib/notification-text";
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
  "SLA_AT_RISK",
  "SLA_BREACHED",
  "WARRANTY",
  "MESSAGE",
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

/** Kilde-etiketten vises i varsellisten, så den må være kort og ren tekst. */
const SOURCE_LABEL_MAX = 200;
const FALLBACK_SOURCE_LABEL = "Systemvarsel";

/**
 * Vasker en kilde-etikett. Etiketten er menneskelig tekst, ikke en lenke:
 * HTML fjernes av `cleanText`, og URL-er fjernes eksplisitt slik at en
 * oppdragstittel eller kundenavn ikke kan smugle en adresse inn i varselet.
 */
function sanitizeSourceLabel(value: unknown): string {
  const text = cleanText(value, { maxLength: SOURCE_LABEL_MAX });
  if (!text) return "";
  return neutralizeUrls(text, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SOURCE_LABEL_MAX);
}

function workOrderSourceLabel(
  title: string | null | undefined,
  customerName: string | null | undefined,
): string {
  const cleanTitle = sanitizeSourceLabel(title);
  const cleanCustomer = sanitizeSourceLabel(customerName);
  if (!cleanTitle) return "Oppdrag: internt oppdrag";
  return cleanCustomer
    ? `Oppdrag: ${cleanTitle} · ${cleanCustomer}`
    : `Oppdrag: ${cleanTitle}`;
}

function customerSourceLabel(name: string | null | undefined): string {
  const cleanName = sanitizeSourceLabel(name);
  return cleanName ? `Kunde: ${cleanName}` : "Kunde";
}

/** E-postteksten får kilde-etiketten øverst, uten å endre selve køen. */
function emailBodyWithSource(
  notification: {
    sourceLabel?: string | null;
    body?: string | null;
  },
  bodyOverride?: string | null,
): string {
  const body = neutralizeUrls(bodyOverride ?? notification.body ?? "");
  const source = sanitizeSourceLabel(notification.sourceLabel);
  if (!source) return body;
  return body ? `${source}\n\n${body}` : source;
}

function idFromHref(href: string, prefix: RegExp): string | null {
  const match = prefix.exec(href);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).slice(0, 64);
  } catch {
    return null;
  }
}

/**
 * Utleder en kilde-etikett fra varselets lenke når innsenderen ikke oppgir
 * en. Oppslagsfeil skal aldri hindre selve varselet, så vi faller tilbake til
 * en nøytral etikett.
 */
async function resolveSourceLabelFromHref(
  href: string | null | undefined,
): Promise<string> {
  if (!href || !isSafeNotificationHref(href)) return FALLBACK_SOURCE_LABEL;

  try {
    const workOrderId = idFromHref(href, /^\/(?:oppdrag|mine-oppdrag)\/([^/?#]+)/);
    if (workOrderId) {
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { title: true, customer: { select: { name: true } } },
      });
      return workOrder
        ? workOrderSourceLabel(workOrder.title, workOrder.customer?.name)
        : "Oppdrag";
    }

    const customerId = idFromHref(href, /^\/kunder\/([^/?#]+)/);
    if (customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true },
      });
      return customer ? customerSourceLabel(customer.name) : "Kunde";
    }
  } catch {
    // Kilde-etiketten er kosmetisk; varselet skal fortsatt kunne opprettes.
    return FALLBACK_SOURCE_LABEL;
  }

  return FALLBACK_SOURCE_LABEL;
}

export async function listNotifications(
  actor: ServiceActor,
  options: { page?: number; unreadOnly?: boolean } = {},
): Promise<ServiceResult<unknown>> {
  if (!actor.isActive) return fail("forbidden");

  const requestedPage = Math.max(1, options.page ?? 1);
  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    ...(options.unreadOnly ? { readAt: null } : {}),
  };

  const [total, unread] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);

  // En side utenfor det som finnes skal vise siste side, ikke en tom liste.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const items = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return ok({ items, total, unread, page, totalPages });
}

/**
 * De nyeste varslene til bjelle-popoveren. Samme eierskapsfilter som
 * `listNotifications`: bare aktørens egne rader.
 */
export async function listRecentNotifications(
  actor: ServiceActor,
  limit = 5,
): Promise<ServiceResult<{ items: unknown[]; unread: number }>> {
  if (!actor.isActive) return fail("forbidden");

  const take = Math.min(10, Math.max(1, Math.floor(limit)));
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);

  return ok({ items, unread });
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
  if (!actor.isActive) return fail("forbidden");

  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (updated.count > 0) return ok(undefined);

  // Allerede lest er også «ok» – handlingen er idempotent. En fremmed id
  // skal derimot aldri avsløres som eksisterende.
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId: actor.id },
    select: { id: true },
  });
  return existing ? ok(undefined) : fail("not_found");
}

/**
 * Åpner et varsel for eieren: slår opp den lagrede raden, markerer den som
 * lest og returnerer en rolle-trygg, intern lenke. Klienten sender bare id-en,
 * så en skjult href i skjemaet kan ikke styre viderekoblingen.
 */
export async function openNotification(
  actor: ServiceActor,
  id: unknown,
): Promise<ServiceResult<{ href: string | null }>> {
  if (!actor.isActive) return fail("forbidden");

  const notificationId =
    typeof id === "string" ? id.trim().slice(0, 64) : "";
  if (!notificationId) return fail("invalid");

  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId: actor.id },
    select: { id: true, type: true, href: true, readAt: true },
  });
  if (!notification) return fail("not_found");

  // Idempotent: allerede leste varsler oppdateres ikke på nytt, men åpnes
  // fortsatt som normalt.
  if (!notification.readAt) {
    await prisma.notification.updateMany({
      where: { id: notification.id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  const href = notificationHrefForUser(
    actor.role,
    notification.type,
    notification.href,
  );
  return ok({ href: isSafeNotificationHref(href) ? href : null });
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
  /** Klartekst for eldre kall. Nye kall bør bruke `titleKey`. */
  title?: string | null;
  titleKey?: string | null;
  body?: string | null;
  bodyKey?: string | null;
  /** Verdier til {placeholder} i titleKey/bodyKey. */
  params?: NotificationTextParams | null;
  href?: string | null;
  /** Menneskevennlig kilde, f.eks. «Oppdrag: testoppdrag · Biniam». */
  sourceLabel?: string | null;
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
  // Inaktive kontoer skal ikke få nye varsler – verken in-app eller på e-post.
  // Sjekken ligger her, slik at alle varsel veier (tildeling, booking, cron)
  // får samme regel uten å måtte gjenta den.
  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { isActive: true },
  });
  if (!target?.isActive) return null;

  const preference = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId: input.userId, type: input.type } },
    select: { inApp: true, email: true },
  });

  const inApp = preference?.inApp ?? true;
  const email = preference?.email ?? true;
  if (!inApp && !email) return null;

  const sourceLabel =
    sanitizeSourceLabel(input.sourceLabel) ||
    (await resolveSourceLabelFromHref(input.href));

  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        // Titler og brødtekst kan inneholde oppdragstitler eller meldinger fra
        // kundeportalen. URL-er nøytraliseres før lagring, slik at de verken
        // blir klikkbare i varsellisten eller i e-posten.
        title: neutralizeUrls(input.title ?? "").slice(0, 200),
        titleKey: input.titleKey?.slice(0, 200) ?? null,
        bodyKey: input.bodyKey?.slice(0, 200) ?? null,
        params: input.params
          ? (input.params as Prisma.InputJsonValue)
          : undefined,
        body: input.body ? neutralizeUrls(input.body).slice(0, 4000) : null,
        sourceLabel: sourceLabel || null,
        href: isSafeNotificationHref(input.href)
          ? input.href.slice(0, 500)
          : null,
        dedupeKey: input.dedupeKey ?? null,
        // Er bare e-post slått på, skal raden ikke gi ulest-merke eller badge.
        // Den markeres derfor som lest med en gang, men e-postkøen bruker den
        // fortsatt som historikk og utgangspunkt for utsending.
        readAt: inApp ? null : new Date(),
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
      title: true,
      departmentId: true,
      customerId: true,
      customer: { select: { name: true } },
      // Inaktive kontoer skal aldri få varsler, selv om de fortsatt står
      // oppført på et gammelt oppdrag.
      technicians: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!workOrder) return 0;

  // Kilde-etiketten fryses per hendelse, slik at varselet fortsatt viser hvor
  // det kom fra selv om oppdraget eller kunden senere endres.
  const sourceLabel = workOrderSourceLabel(
    workOrder.title,
    workOrder.customer?.name,
  );
  const safeHref = isSafeNotificationHref(href) ? href : null;

  const recipients = new Set(workOrder.technicians.map((user) => user.id));

  if (
    type === "BOOKING" ||
    type === "REPORT_READY" ||
    type === "CONTRACT_DUE" ||
    type === "OVERDUE" ||
    type === "SLA_AT_RISK" ||
    type === "SLA_BREACHED"
  ) {
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
      href: safeHref,
      sourceLabel,
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
        // En konto som er deaktivert etter at varselet ble laget, skal ikke
        // få e-post. Varselet blir liggende i historikken.
        user: { isActive: true },
        OR: [
          { emailLockedAt: null },
          { emailLockedAt: { lt: leaseCutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        user: {
          select: {
            email: true,
            role: true,
            isActive: true,
            locale: true,
          },
        },
      },
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

      // Kontoen kan ha blitt deaktivert mellom spørringen og claimet.
      if (notification.user.isActive === false) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            emailSentAt: new Date(),
            emailError: "Brukeren er deaktivert",
            emailLockedAt: null,
            emailLockedBy: null,
          },
        });
        continue;
      }

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
          notificationTitleFor(notification, notification.user.locale),
          emailBodyWithSource(
            notification,
            notificationBodyFor(notification, notification.user.locale),
          ),
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
                : safeEmailError(error),
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
