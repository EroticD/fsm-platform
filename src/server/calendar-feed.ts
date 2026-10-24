import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { addDaysUtc, toDateOnly } from "@/lib/dates";
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

/** Leser om brukeren har en aktiv kalenderlenke. */
export async function getCalendarTokenStatus(
  actor: ServiceActor,
): Promise<ServiceResult<{ token: string | null }>> {
  if (!actor.isActive) return fail("forbidden");
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { calendarToken: true },
  });
  if (!user) return fail("not_found");
  return ok({ token: user.calendarToken });
}

/** Oppretter eller gjenbruker en personlig iCal-token. */
export async function getOrCreateCalendarToken(
  actor: ServiceActor,
): Promise<ServiceResult<{ token: string }>> {
  if (!actor.isActive) return fail("forbidden");

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { calendarToken: true },
  });
  if (!user) return fail("not_found");
  if (user.calendarToken) return ok({ token: user.calendarToken });

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: actor.id },
    data: { calendarToken: token },
  });
  return ok({ token });
}

export async function revokeCalendarToken(
  actor: ServiceActor,
): Promise<ServiceResult> {
  if (!actor.isActive) return fail("forbidden");
  await prisma.user.update({
    where: { id: actor.id },
    data: { calendarToken: null },
  });
  return ok(undefined);
}

/**
 * Bygger en read-only iCal-feed for brukerens egne/avdelingens oppdrag.
 * Tokenet er hemmeligheten; ruten krever ingen innlogging.
 */
export async function getCalendarFeed(
  token: string,
  options: { from?: Date; to?: Date } = {},
): Promise<string | null> {
  if (!token || token.length < 32) return null;

  const user = await prisma.user.findUnique({
    where: { calendarToken: token },
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
  if (!user?.isActive) return null;

  const actor = user as FeedUser;
  const from = options.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = options.to ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScopeFor(actor),
        { status: { not: "CANCELLED" } },
        { scheduledFor: { not: null } },
        {
          OR: [
            { scheduledFor: { gte: from, lte: to } },
            { scheduledTo: { gte: from, lte: to } },
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
  ];

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  for (const workOrder of workOrders) {
    if (!workOrder.scheduledFor) continue;
    const start = workOrder.scheduledFor;
    const end = workOrder.scheduledTo
      ? addDaysUtc(workOrder.scheduledTo, 1)
      : addDaysUtc(start, 1);
    const location = workOrder.customer
      ? [workOrder.customer.address, workOrder.customer.postalCode, workOrder.customer.city]
          .filter(Boolean)
          .join(", ")
      : "";

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
  return lines.map(fold).join("\r\n") + "\r\n";
}
