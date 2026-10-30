/**
 * Databaseoppslag for åpningstider og helligdager.
 *
 * Selve matematikken ligger i `src/lib/business-hours.ts` slik at den kan
 * testes uten database. Denne modulen laster avdelingens kalender og brukes av
 * SLA-tjenesten og innstillingene.
 */

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  DEFAULT_BUSINESS_HOURS,
  type BusinessCalendar,
  type BusinessHoursWindow,
} from "@/lib/business-hours";
import {
  MAX_BUSINESS_HOURS_MINUTES,
} from "@/lib/business-hours";
import { dateOnlyInOslo, parseDateOnly, toDateOnly } from "@/lib/dates";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { can, fail, ok, toAuditActor, type ServiceActor, type ServiceResult } from "./actor";

export {
  addBusinessMinutes,
  businessMinutesBetween,
  isOpenAt,
  nextOpening,
  osloLocalParts,
  osloWallTimeToUtc,
  DEFAULT_BUSINESS_HOURS,
  MAX_BUSINESS_HOURS_MINUTES,
} from "@/lib/business-hours";

type DbClient = Prisma.TransactionClient;

function toWindow(row: {
  weekday: number;
  openMinute: number;
  closeMinute: number;
}): BusinessHoursWindow {
  return {
    weekday: row.weekday,
    openMinute: row.openMinute,
    closeMinute: row.closeMinute,
  };
}

/**
 * Laster avdelingens åpningstider og helligdager. Mangler avdelingen rader,
 * brukes standarden hverdager 08–16. En avdeling som bevisst har lagret alle
 * dager som stengt (0/0) får ingen åpningstid – standarden brukes ikke da.
 */
export async function loadBusinessCalendar(
  client: DbClient,
  departmentId: string | null | undefined,
): Promise<BusinessCalendar> {
  if (!departmentId) {
    return { windows: DEFAULT_BUSINESS_HOURS, holidays: [] };
  }

  const [hours, holidays] = await Promise.all([
    client.businessHours.findMany({
      where: { departmentId },
      orderBy: { weekday: "asc" },
      take: 7,
    }),
    client.holiday.findMany({
      where: { OR: [{ departmentId }, { departmentId: null }] },
      select: { date: true },
      take: 2_000,
    }),
  ]);

  return {
    windows:
      hours.length > 0 ? hours.map(toWindow) : DEFAULT_BUSINESS_HOURS,
    holidays: holidays
      .map((holiday) => toDateOnly(holiday.date))
      .filter(Boolean),
  };
}

export type BusinessHoursRow = {
  weekday: number;
  openMinute: number;
  closeMinute: number;
};

function parseMinutes(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return null;
  if (number < 0 || number > MAX_BUSINESS_HOURS_MINUTES) return null;
  return number;
}

/** Erstatter hele ukeplanen for én avdeling i én transaksjon. */
export async function saveBusinessHours(
  actor: ServiceActor,
  departmentId: string,
  rows: BusinessHoursRow[],
): Promise<ServiceResult> {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const department = await prisma.department.findFirst({
    where: { id: departmentId, isActive: true },
    select: { id: true, name: true },
  });
  if (!department) return fail("not_found");

  const byWeekday = new Map<number, BusinessHoursRow>();
  for (const row of rows) {
    const weekday = Number(row.weekday);
    const openMinute = parseMinutes(row.openMinute);
    const closeMinute = parseMinutes(row.closeMinute);
    if (
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      openMinute === null ||
      closeMinute === null
    ) {
      return fail("invalid");
    }
    if (closeMinute !== 0 && closeMinute <= openMinute) {
      return fail("invalid");
    }
    byWeekday.set(weekday, {
      weekday,
      openMinute: closeMinute === 0 ? 0 : openMinute,
      closeMinute,
    });
  }

  const normalized: BusinessHoursRow[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const row = byWeekday.get(weekday);
    if (!row) return fail("invalid");
    normalized.push(row);
  }

  await prisma.$transaction(async (tx) => {
    await tx.businessHours.deleteMany({ where: { departmentId } });
    await tx.businessHours.createMany({
      data: normalized.map((row) => ({ departmentId, ...row })),
    });
    await audit(tx, {
      entityType: "Department",
      entityId: departmentId,
      action: `Oppdaterte åpningstider for ${department.name}`,
      actor: toAuditActor(actor),
      metadata: { rows: normalized },
    });
  });

  return ok(undefined);
}

/** Helligdager for én avdeling pluss globale. */
export async function listHolidays(
  actor: ServiceActor,
  departmentId?: string | null,
) {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const holidays = await prisma.holiday.findMany({
    where: {
      OR: [
        { departmentId: null },
        ...(departmentId ? [{ departmentId }] : []),
      ],
    },
    orderBy: { date: "asc" },
    take: 500,
    include: { department: { select: { id: true, name: true } } },
  });
  return ok({ holidays });
}

export async function saveHoliday(
  actor: ServiceActor,
  input: { date?: unknown; name?: unknown; departmentId?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const dateText = cleanText(input.date, { maxLength: LIMITS.short });
  const date = parseDateOnly(dateText);
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const departmentId =
    cleanText(input.departmentId, { maxLength: LIMITS.line }) || null;
  if (!date || !name) return fail("invalid");

  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, isActive: true },
      select: { id: true },
    });
    if (!department) return fail("invalid");
  }

  const existing = await prisma.holiday.findFirst({
    where: { date, departmentId },
    select: { id: true },
  });
  if (existing) return fail("conflict");

  const holiday = await prisma.$transaction(async (tx) => {
    const created = await tx.holiday.create({
      data: { date, name, departmentId },
    });
    await audit(tx, {
      entityType: "Holiday",
      entityId: created.id,
      action: `La til helligdag: ${name} (${toDateOnly(date)})`,
      actor: toAuditActor(actor),
      metadata: { date: toDateOnly(date), departmentId },
    });
    return created;
  });

  return ok({ id: holiday.id });
}

export async function deleteHoliday(
  actor: ServiceActor,
  holidayId: string,
): Promise<ServiceResult> {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const holiday = await prisma.holiday.findUnique({
    where: { id: holidayId },
    select: { id: true, name: true, date: true },
  });
  if (!holiday) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id: holidayId } });
    await audit(tx, {
      entityType: "Holiday",
      entityId: holidayId,
      action: `Slettet helligdag: ${holiday.name}`,
      actor: toAuditActor(actor),
      metadata: { date: toDateOnly(holiday.date) },
    });
  });

  return ok(undefined);
}

/** Dagens dato i Oslo, brukt av innstillingene når de foreslår standarddato. */
export function todayDateOnly(): string {
  return dateOnlyInOslo(new Date());
}
