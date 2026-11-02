// i18n-ignore-file: iCal-feeden har ingen request-locale; kalenderens navn er
// metadata for eksterne kalenderklienter.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { addDaysUtc, toDateOnly } from "@/lib/dates";
import { osloLocalParts } from "@/lib/business-hours";
import { allowRequestDb } from "@/lib/rate-limit-db";
import {
  fail,
  ok,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

type FeedUser = ServiceActor & {
  name: string | null;
  email: string | null;
  isActive: boolean;
};

/** Kalendertokens er 32 tilfeldige bytes, hex-kodet. */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Global, prosesslokal sikring mot flom av tilfeldige (men velformede) tokens. */
const globalFeedWindow = { startedAt: 0, count: 0 };
function allowGlobalFeed(now = Date.now()): boolean {
  if (now - globalFeedWindow.startedAt >= 60_000) {
    globalFeedWindow.startedAt = now;
    globalFeedWindow.count = 0;
  }
  globalFeedWindow.count += 1;
  return globalFeedWindow.count <= 1200;
}

export type CalendarTokenStatus = {
  active: boolean;
  createdAt: Date | null;
  lastUsedAt: Date | null;
};

/**
 * Kalenderlenken er en bærbar hemmelighet. Bare SHA-256-hashen lagres, slik
 * at en databaselekkasje ikke gir tilgang til noens kalender. Selve tokenet
 * returneres kun én gang, til den som nettopp opprettet eller roterte det.
 */
export function sha256(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Klienten trenger bare et Prisma-objekt med `user` (transaksjon eller rot). */
type CalendarTokenClient = Pick<Prisma.TransactionClient, "user">;

/** Fjerner kalenderlenken. Kalles også ved øktinvalidigering. */
export async function clearCalendarToken(
  userId: string,
  tx?: CalendarTokenClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.user.update({
    where: { id: userId },
    data: {
      calendarTokenHash: null,
      calendarTokenCreatedAt: null,
      calendarTokenLastUsedAt: null,
    },
  });
}

function newCalendarToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Leser status uten å eksponere selve tokenet – det finnes ikke i klartekst. */
export async function getCalendarTokenStatus(
  actor: ServiceActor,
): Promise<ServiceResult<CalendarTokenStatus>> {
  if (!actor.isActive) return fail("forbidden");
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      calendarTokenHash: true,
      calendarTokenCreatedAt: true,
      calendarTokenLastUsedAt: true,
    },
  });
  if (!user) return fail("not_found");
  return ok({
    active: Boolean(user.calendarTokenHash),
    createdAt: user.calendarTokenCreatedAt,
    lastUsedAt: user.calendarTokenLastUsedAt,
  });
}

/**
 * Oppretter en kalenderlenke dersom brukeren ikke har en aktiv en. En
 * eksisterende lenke returneres aldri på nytt; da må brukeren rotere den.
 */
export async function getOrCreateCalendarToken(
  actor: ServiceActor,
): Promise<ServiceResult<{ token: string | null }>> {
  if (!actor.isActive) return fail("forbidden");

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { calendarTokenHash: true },
  });
  if (!user) return fail("not_found");
  if (user.calendarTokenHash) return ok({ token: null });

  const token = newCalendarToken();
  await prisma.user.update({
    where: { id: actor.id },
    data: {
      calendarTokenHash: sha256(token),
      calendarTokenCreatedAt: new Date(),
      calendarTokenLastUsedAt: null,
    },
  });
  return ok({ token });
}

/** Roterer lenken: den gamle slutter å virke umiddelbart. */
export async function regenerateCalendarToken(
  actor: ServiceActor,
): Promise<ServiceResult<{ token: string | null }>> {
  if (!actor.isActive) return fail("forbidden");

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true },
  });
  if (!user) return fail("not_found");

  const token = newCalendarToken();
  await prisma.user.update({
    where: { id: actor.id },
    data: {
      calendarTokenHash: sha256(token),
      calendarTokenCreatedAt: new Date(),
      calendarTokenLastUsedAt: null,
    },
  });
  return ok({ token });
}

export async function revokeCalendarToken(
  actor: ServiceActor,
): Promise<ServiceResult> {
  if (!actor.isActive) return fail("forbidden");
  await clearCalendarToken(actor.id);
  return ok(undefined);
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function icsDate(value: Date): string {
  return toDateOnly(value).replace(/-/g, "");
}

/** Veggklokketid i Europe/Oslo, uten tidssone-suffiks (TZID står i feltet). */
function icsOsloLocal(value: Date): string {
  const parts = osloLocalParts(value);
  const hour = Math.floor(parts.minuteOfDay / 60);
  const minute = parts.minuteOfDay % 60;
  return `${parts.dateOnly.replace(/-/g, "")}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/**
 * Kalenderen skal aldri vise mer enn brukeren selv har tilgang til.
 * Kunder ser egen kunde, montører ser bare oppdrag de er tildelt, og
 * kontor/administrasjon følger den vanlige avdelingssperren.
 */
function feedScopeFor(user: FeedUser): Prisma.WorkOrderWhereInput {
  if (user.role === "CUSTOMER") {
    return user.customerId
      ? { customerId: user.customerId, deletedAt: null }
      : { id: { in: [] } };
  }
  if (user.role === "TECHNICIAN") {
    // Tildeling alene er ikke nok: brukeren må fortsatt ha oppdragsrettighet
    // og tilhøre oppdragets avdeling. Ellers ville en fjernet rettighet eller
    // en avdelingsendring fortsatt lekke gamle oppdrag gjennom kalenderen.
    return {
      AND: [
        { technicians: { some: { id: user.id } } },
        workOrderScopeFor(user),
      ],
    };
  }
  return workOrderScopeFor(user);
}

export type CalendarFeedResult =
  | { ok: true; feed: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Bygger en read-only iCal-feed for brukerens egne/avdelingens oppdrag.
 * Tokenet er hemmeligheten; ruten krever ingen innlogging.
 */
export async function getCalendarFeed(
  token: string,
  options: { from?: Date; to?: Date } = {},
): Promise<CalendarFeedResult> {
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid" };

  // Billig, prosesslokal flomvern før noe databasearbeid. Tilfeldige tokens
  // skal ikke kunne fylle RateLimit-tabellen eller hamre på databasen.
  if (!allowGlobalFeed()) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 60 };
  }

  const tokenHash = sha256(token);

  // Slå opp først: et ukjent token skal ikke skrive en RateLimit-rad.
  const user = await prisma.user.findUnique({
    where: { calendarTokenHash: tokenHash },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      departmentId: true,
      customerId: true,
      permissions: true,
      permissionsCustomized: true,
      roleDefinition: { select: { permissions: true } },
    },
  });
  if (!user?.isActive) return { ok: false, reason: "invalid" };

  // Grensen ligger per gyldig token, slik at en delt abonnementslenke ikke
  // kan brukes til å hamre ned databasen fra mange adresser.
  const limit = await allowRequestDb(`ical:${tokenHash}`, 120, 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  const actor = user as FeedUser;

  // Oppdateres bare etter vellykket oppslag, slik at et ukjent token ikke
  // skriver til databasen.
  await prisma.user.update({
    where: { id: user.id },
    data: { calendarTokenLastUsedAt: new Date() },
  });

  const from = options.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = options.to ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        feedScopeFor(actor),
        { status: { not: "CANCELLED" } },
        { scheduledFor: { not: null } },
        {
          OR: [
            { scheduledFor: { gte: from, lte: to } },
            { scheduledTo: { gte: from, lte: to } },
            {
              visits: {
                some: {
                  status: { not: "CANCELLED" },
                  startsAt: { lte: to },
                  endsAt: { gte: from },
                },
              },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      scheduledFor: true,
      scheduledTo: true,
      customer: {
        select: {
          name: true,
          address: true,
          postalCode: true,
          city: true,
        },
      },
      visits: {
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          sequence: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          status: true,
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 2000,
  });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FSM-plattformen//Kalender//NO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(user.name || "FSM-oppdrag")}`,
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Oslo",
    "X-LIC-LOCATION:Europe/Oslo",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  for (const workOrder of workOrders) {
    const location = workOrder.customer
      ? [workOrder.customer.address, workOrder.customer.postalCode, workOrder.customer.city]
          .filter(Boolean)
          .join(", ")
      : "";
    const activeVisits = (workOrder.visits ?? []).filter(
      (visit) =>
        visit.status !== "CANCELLED" &&
        visit.startsAt.getTime() <= to.getTime() &&
        visit.endsAt.getTime() >= from.getTime(),
    );

    if (activeVisits.length > 0) {
      for (const visit of activeVisits) {
        const summary =
          activeVisits.length > 1
            ? `${workOrder.title} (${visit.sequence + 1})`
            : workOrder.title;
        const description = [
          workOrder.description ?? "",
          workOrder.customer?.name
            ? `Kunde: ${workOrder.customer.name}`
            : "",
          `Status: ${workOrder.status}`,
          activeVisits.length > 1 ? `Visitt: ${visit.sequence + 1}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        if (visit.allDay) {
          const startDay = toDateOnly(visit.startsAt);
          const rawEnd = toDateOnly(visit.endsAt);
          const endDay =
            rawEnd <= startDay
              ? toDateOnly(addDaysUtc(visit.startsAt, 1))
              : rawEnd;
          lines.push(
            "BEGIN:VEVENT",
            `UID:visit-${visit.id}@fsm`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${startDay.replace(/-/g, "")}`,
            `DTEND;VALUE=DATE:${endDay.replace(/-/g, "")}`,
            `SUMMARY:${icsEscape(summary)}`,
            `DESCRIPTION:${icsEscape(description)}`,
            ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
            "STATUS:CONFIRMED",
            "END:VEVENT",
          );
        } else {
          lines.push(
            "BEGIN:VEVENT",
            `UID:visit-${visit.id}@fsm`,
            `DTSTAMP:${stamp}`,
            `DTSTART;TZID=Europe/Oslo:${icsOsloLocal(visit.startsAt)}`,
            `DTEND;TZID=Europe/Oslo:${icsOsloLocal(visit.endsAt)}`,
            `SUMMARY:${icsEscape(summary)}`,
            `DESCRIPTION:${icsEscape(description)}`,
            ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
            "STATUS:CONFIRMED",
            "END:VEVENT",
          );
        }
      }
      continue;
    }

    // All-day fallback gjelder bare oppdrag som faktisk ikke har visiter.
    // Har oppdraget visiter utenfor perioden (eller bare kansellerte), skal
    // det ikke dukke opp som et falskt heldagsarrangement.
    if ((workOrder.visits?.length ?? 0) > 0) continue;

    if (!workOrder.scheduledFor) continue;
    const start = workOrder.scheduledFor;
    const end = workOrder.scheduledTo
      ? addDaysUtc(workOrder.scheduledTo, 1)
      : addDaysUtc(start, 1);

    lines.push(
      "BEGIN:VEVENT",
      `UID:workorder-${workOrder.id}@fsm`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(start)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsEscape(workOrder.title)}`,
      `DESCRIPTION:${icsEscape(
        [
          workOrder.description ?? "",
          workOrder.customer?.name ? `Kunde: ${workOrder.customer.name}` : "",
          `Status: ${workOrder.status}`,
        ]
          .filter(Boolean)
          .join("\n"),
      )}`,
      ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return { ok: true, feed: lines.map(fold).join("\r\n") + "\r\n" };
}
