// i18n-ignore-file: tjenestelaget lagrer revisjonstekster som data og har
// ingen egne UI-strenger. Portalen oversetter alt i komponentene.
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { staffForDepartment } from "@/lib/access";
import { getDefaultDepartmentId } from "@/lib/departments";
import {
  DEFAULT_BUSINESS_HOURS,
  osloWallTimeToUtc,
} from "@/lib/business-hours";
import {
  addDaysUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import {
  AVAILABILITY_SLOT_MINUTES,
  BOOKING_HORIZON_DAYS,
  MAX_SLOTS_PER_DAY,
  UNCONFIGURED_AVAILABILITY_POLICY,
  generateDaySlots,
  isRangeBookable,
  isWithinBookingHorizon,
  type AvailabilitySlot,
  type BlockingRange,
  type DaySlotResult,
  type MinuteWindow,
} from "@/lib/availability";
import { cleanText, LIMITS } from "@/lib/sanitize";
import {
  fail,
  ok,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Hvor lenge en valgt time holdes mens kunden fyller ut skjemaet. */
export const BOOKING_HOLD_MINUTES = 5;

/** Sikkerhetsmargin mot at to reservasjoner skapes i samme millisekund. */
export const BOOKING_HOLD_RETENTION_HOURS = 24;

/** Et kall skal ikke kunne låse en hel avdeling i mer enn noen sekunder. */
const TRANSACTION_TIMEOUT_MS = 15_000;

type DbClient = Prisma.TransactionClient;

export type PortalAvailabilitySlot = {
  technicianId: string;
  technicianName: string;
  startsAt: string;
  endsAt: string;
  date: string;
  from: string;
  to: string;
  minutes: number;
};

export type PortalAvailabilityDay = {
  date: string;
  horizonEnd: string;
  slotMinutes: number;
  maxSlotsPerDay: number;
  businessHoursConfigured: boolean;
  /** Satt når minst én montør mangler arbeidstid og standarden ble brukt. */
  unconfiguredPolicy: typeof UNCONFIGURED_AVAILABILITY_POLICY | null;
  unconfiguredTechnicianCount: number;
  technicianCount: number;
  slots: PortalAvailabilitySlot[];
};

type TechnicianContext = {
  id: string;
  name: string | null;
  availability: MinuteWindow[];
  absences: BlockingRange[];
  visits: BlockingRange[];
  holds: BlockingRange[];
};

type DayContext = {
  date: string;
  departmentId: string;
  businessHours: MinuteWindow[];
  businessHoursConfigured: boolean;
  holidays: string[];
  technicians: TechnicianContext[];
};

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function parseAvailabilityDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = parseDateOnly(text);
  return parsed ? toDateOnly(parsed) : null;
}

function dayBounds(date: string): { startsAt: Date; endsAt: Date } {
  const parsed = parseDateOnly(date);
  if (!parsed) throw new Error("Ugyldig dato");
  const next = new Date(parsed.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    startsAt: osloDayStart(date),
    endsAt: osloDayStart(toDateOnly(next)),
  };
}

function toMinuteWindow(row: {
  weekday: number;
  openMinute?: number;
  closeMinute?: number;
  startMinute?: number;
  endMinute?: number;
}): MinuteWindow {
  return {
    weekday: row.weekday,
    startMinute: row.openMinute ?? row.startMinute ?? 0,
    endMinute: row.closeMinute ?? row.endMinute ?? 0,
  };
}

async function loadDepartmentCalendar(
  client: DbClient,
  departmentId: string,
): Promise<{
  businessHours: MinuteWindow[];
  businessHoursConfigured: boolean;
  holidays: string[];
}> {
  const [hours, holidays] = await Promise.all([
    client.businessHours.findMany({
      where: { departmentId },
      orderBy: { weekday: "asc" },
      take: 7,
    }),
    client.holiday.findMany({
      where: {
        OR: [{ departmentId }, { departmentId: null }],
        date: {
          gte: new Date(Date.now() - 24 * 60 * 60_000),
          lte: new Date(Date.now() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000),
        },
      },
      select: { date: true },
      take: 500,
    }),
  ]);

  return {
    businessHours:
      hours.length > 0
        ? hours.map(toMinuteWindow)
        : DEFAULT_BUSINESS_HOURS.map(toMinuteWindow),
    businessHoursConfigured: hours.length > 0,
    holidays: holidays.map((holiday) => toDateOnly(holiday.date)).filter(Boolean),
  };
}

/**
 * Laster alt som kan blokkere én dag for de aktuelle montørene i én spørring
 * per relasjon. Intervallene er avgrenset til dagen i Oslo, men tar med
 * visiter som startet dagen før eller slutter dagen etter slik at flerdagers
 * og heldagsvisiter blokkerer riktig.
 */
async function loadTechnicianDayContext(
  client: DbClient,
  departmentId: string,
  date: string,
  technicianIds: string[],
  options: { excludeVisitId?: string; excludeHoldId?: string } = {},
): Promise<TechnicianContext[]> {
  const ids = Array.from(new Set(technicianIds.filter(Boolean))).slice(0, 200);
  if (ids.length === 0) return [];

  const { startsAt, endsAt } = dayBounds(date);
  const technicians = await client.user.findMany({
    where: { id: { in: ids }, ...staffForDepartment(departmentId) },
    select: {
      id: true,
      name: true,
      availability: {
        select: { weekday: true, startMinute: true, endMinute: true },
        take: 100,
      },
      absences: {
        where: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { startsAt: true, endsAt: true },
        take: 100,
      },
      visitAssignments: {
        where: {
          ...(options.excludeVisitId
            ? { visitId: { not: options.excludeVisitId } }
            : {}),
          visit: {
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            status: { notIn: ["DONE", "CANCELLED"] },
            workOrder: { deletedAt: null },
          },
        },
        select: {
          visit: {
            select: {
              startsAt: true,
              endsAt: true,
              allDay: true,
              status: true,
            },
          },
        },
        take: 200,
      },
      bookingHolds: {
        where: {
          ...(options.excludeHoldId
            ? { id: { not: options.excludeHoldId } }
            : {}),
          consumedAt: null,
          expiresAt: { gt: new Date() },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { startsAt: true, endsAt: true },
        take: 100,
      },
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  return technicians.map((technician) => ({
    id: technician.id,
    name: technician.name,
    availability: technician.availability.map(toMinuteWindow),
    absences: technician.absences,
    visits: technician.visitAssignments
      .map((assignment) => assignment.visit)
      .filter(
        (visit) => visit.status !== "DONE" && visit.status !== "CANCELLED",
      )
      .map((visit) => ({
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
        allDay: visit.allDay,
        status: visit.status,
      })),
    holds: technician.bookingHolds,
  }));
}

async function loadDayContext(
  client: DbClient,
  departmentId: string,
  date: string,
  technicianIds: string[],
  options: { excludeVisitId?: string; excludeHoldId?: string } = {},
): Promise<DayContext> {
  const [calendar, technicians] = await Promise.all([
    loadDepartmentCalendar(client, departmentId),
    loadTechnicianDayContext(
      client,
      departmentId,
      date,
      technicianIds,
      options,
    ),
  ]);
  return {
    date,
    departmentId,
    ...calendar,
    technicians,
  };
}

function slotForTechnician(
  context: DayContext,
  technician: TechnicianContext,
  options: {
    now?: Date;
    maxSlots?: number;
    visits?: BlockingRange[];
    holds?: BlockingRange[];
  } = {},
): DaySlotResult {
  return generateDaySlots({
    date: context.date,
    now: options.now,
    businessHours: context.businessHours.map((window) => ({
      weekday: window.weekday,
      openMinute: window.startMinute,
      closeMinute: window.endMinute,
    })),
    availability: technician.availability,
    absences: technician.absences,
    visits: options.visits ?? technician.visits,
    holds: options.holds ?? technician.holds,
    holidays: context.holidays,
    maxSlots: options.maxSlots,
  });
}

/**
 * Tilgjengelighet for én dato i kundeportalen. Kunden ser bare montører i sin
 * egen avdeling, og aldri hva andre kunder har bestilt – bare ledige timer.
 */
export async function getCustomerAvailability(
  actor: ServiceActor,
  input: { date?: unknown; now?: Date } = {},
): Promise<ServiceResult<PortalAvailabilityDay>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const date = parseAvailabilityDate(input.date);
  if (!date) return fail("invalid");
  const now = input.now ?? new Date();
  if (!isWithinBookingHorizon(date, now)) return fail("invalid");

  const customer = await prisma.customer.findFirst({
    where: { id: actor.customerId, deletedAt: null },
    select: { id: true, departmentId: true },
  });
  if (!customer) return fail("forbidden");
  const departmentId =
    customer.departmentId ?? (await getDefaultDepartmentId());
  if (!departmentId) return fail("error");

  const technicians = await prisma.user.findMany({
    where: { ...staffForDepartment(departmentId), isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  const context = await loadDayContext(
    prisma as unknown as DbClient,
    departmentId,
    date,
    technicians.map((technician) => technician.id),
  );

  const slots: PortalAvailabilitySlot[] = [];
  let unconfiguredTechnicianCount = 0;
  for (const technician of context.technicians) {
    const result = slotForTechnician(context, technician, {
      now,
      maxSlots: MAX_SLOTS_PER_DAY,
    });
    if (!result.availabilityConfigured) unconfiguredTechnicianCount += 1;
    for (const slot of result.slots) {
      slots.push(toPortalSlot(slot, technician));
    }
  }

  slots.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.technicianName.localeCompare(b.technicianName),
  );

  return ok({
    date,
    horizonEnd: toDateOnly(
      addDaysUtc(parseDateOnly(date)!, BOOKING_HORIZON_DAYS),
    ),
    slotMinutes: AVAILABILITY_SLOT_MINUTES,
    maxSlotsPerDay: MAX_SLOTS_PER_DAY,
    businessHoursConfigured: context.businessHoursConfigured,
    unconfiguredPolicy:
      unconfiguredTechnicianCount > 0
        ? UNCONFIGURED_AVAILABILITY_POLICY
        : null,
    unconfiguredTechnicianCount,
    technicianCount: context.technicians.length,
    slots,
  });
}

function toPortalSlot(
  slot: AvailabilitySlot,
  technician: TechnicianContext,
): PortalAvailabilitySlot {
  return {
    technicianId: technician.id,
    technicianName: technician.name ?? "",
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    date: slot.date,
    from: slot.from,
    to: slot.to,
    minutes: slot.minutes,
  };
}

/** Låsenavn per montør. Sortert rekkefølge hindrer deadlock mellom kall. */
export async function lockTechnicians(
  tx: DbClient,
  technicianIds: readonly string[],
): Promise<void> {
  const ids = Array.from(new Set(technicianIds.filter(Boolean))).sort();
  for (const id of ids) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('booking-technician'), hashtext(${id}))`;
  }
}

function serializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const message =
    "message" in error ? String((error as { message?: unknown }).message) : "";
  return /could not serialize|deadlock detected|40001|40P01/i.test(message);
}

/**
 * Kjører en interaktiv transaksjon med SERIALIZABLE og prøver på nytt ved
 * serialiseringskonflikt. Kombinert med advisory-låsen per montør gir dette
 * «nøyaktig én» ved samtidige bestillinger av samme time.
 */
export async function runSerializable<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const attempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: TRANSACTION_TIMEOUT_MS,
      });
    } catch (error) {
      lastError = error;
      if (!serializationFailure(error) || attempt === attempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 10 * attempt + Math.floor(Math.random() * 20)),
      );
    }
  }
  throw lastError;
}

/**
 * Kontrollerer at en montør faktisk kan ta en konkret tidsblokk. Brukes både
 * av kundeportalen (direkte bekreftelse) og av kontorets bekreftelseskø.
 */
export async function assertTechnicianSlotAvailable(
  client: DbClient,
  input: {
    departmentId: string;
    technicianId: string;
    date: string;
    startsAt: Date;
    endsAt: Date;
    now?: Date;
    excludeVisitId?: string;
    excludeHoldId?: string;
    leadHours?: number;
  },
): Promise<
  | { ok: true; technician: TechnicianContext }
  | { ok: false; reason: "invalid" | "not_found" | "conflict" }
> {
  const context = await loadDayContext(
    client,
    input.departmentId,
    input.date,
    [input.technicianId],
    {
      excludeVisitId: input.excludeVisitId,
      excludeHoldId: input.excludeHoldId,
    },
  );
  const technician = context.technicians.find(
    (candidate) => candidate.id === input.technicianId,
  );
  if (!technician) return { ok: false, reason: "not_found" };

  const available = isRangeBookable({
    date: input.date,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    now: input.now,
    businessHours: context.businessHours.map((window) => ({
      weekday: window.weekday,
      openMinute: window.startMinute,
      closeMinute: window.endMinute,
    })),
    availability: technician.availability,
    absences: technician.absences,
    visits: technician.visits,
    holds: technician.holds,
    holidays: context.holidays,
    leadHours: input.leadHours,
  });
  return available
    ? { ok: true, technician }
    : { ok: false, reason: "conflict" };
}

/**
 * Ledige montører for et vilkårlig tidsvindu. Kontorkøen bruker dette til å
 * tilby bare montører som faktisk kan ta hele den ønskede tiden.
 */
export async function listAvailableTechniciansForWindow(
  client: DbClient,
  input: {
    departmentId: string;
    date: string;
    startsAt: Date;
    endsAt: Date;
    now?: Date;
    excludeVisitId?: string;
    leadHours?: number;
  },
): Promise<Array<{ id: string; name: string | null }>> {
  const technicians = await client.user.findMany({
    where: { ...staffForDepartment(input.departmentId), isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
  if (technicians.length === 0) return [];

  const context = await loadDayContext(
    client,
    input.departmentId,
    input.date,
    technicians.map((technician) => technician.id),
    { excludeVisitId: input.excludeVisitId },
  );
  const byId = new Map(
    context.technicians.map((technician) => [technician.id, technician]),
  );
  return technicians.filter((technician) => {
    const row = byId.get(technician.id);
    if (!row) return false;
    return isRangeBookable({
      date: input.date,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      now: input.now,
      businessHours: context.businessHours.map((window) => ({
        weekday: window.weekday,
        openMinute: window.startMinute,
        closeMinute: window.endMinute,
      })),
      availability: row.availability,
      absences: row.absences,
      visits: row.visits,
      holds: row.holds,
      holidays: context.holidays,
      leadHours: input.leadHours,
    });
  });
}

/**
 * Frigjør en reservasjon kunden selv har valgt bort. Selve raden slettes, slik
 * at timen blir ledig umiddelbart i stedet for å vente på utløp.
 */
export async function releaseBookingHold(
  actor: ServiceActor,
  token: unknown,
): Promise<ServiceResult> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }
  const cleanToken = cleanText(token, { maxLength: 200 });
  if (!cleanToken) return fail("invalid");
  await prisma.bookingHold.deleteMany({
    where: {
      token: cleanToken,
      customerId: actor.customerId,
      consumedAt: null,
    },
  });
  return ok(undefined);
}

export type BookingHoldResult = {
  token: string;
  expiresAt: string;
  date: string;
  from: string;
  to: string;
  technicianId: string;
  technicianName: string;
  siteId: string | null;
};

/**
 * Reserverer en ledig halvtime i fem minutter. Samme kunde og samme time får
 * tilbake den eksisterende reservasjonen, slik at et dobbeltklikk ikke gir to
 * tokens. Andre kunder får `conflict` når timen allerede er holdt.
 */
export async function holdBookingSlot(
  actor: ServiceActor,
  input: {
    date?: unknown;
    from?: unknown;
    to?: unknown;
    technicianId?: unknown;
    siteId?: unknown;
  },
): Promise<ServiceResult<BookingHoldResult>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const date = parseAvailabilityDate(input.date);
  const from = String(input.from ?? "").trim();
  const to = String(input.to ?? "").trim();
  const technicianId = cleanId(input.technicianId);
  const siteId = cleanId(input.siteId) || null;
  if (!date || !technicianId || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return fail("invalid");
  }
  const now = new Date();
  if (!isWithinBookingHorizon(date, now)) return fail("invalid");

  const customer = await prisma.customer.findFirst({
    where: { id: actor.customerId, deletedAt: null },
    select: { id: true, departmentId: true },
  });
  if (!customer) return fail("forbidden");
  const departmentId =
    customer.departmentId ?? (await getDefaultDepartmentId());
  if (!departmentId) return fail("error");

  if (siteId) {
    const site = await prisma.customerSite.findFirst({
      where: { id: siteId, customerId: customer.id },
      select: { id: true },
    });
    if (!site) return fail("invalid");
  }

  const [hours, minutes] = from.split(":").map(Number);
  const [endHours, endMinutes] = to.split(":").map(Number);
  const startsAt = osloWallTimeToUtc(date, hours * 60 + minutes);
  const endsAt = osloWallTimeToUtc(date, endHours * 60 + endMinutes);
  if (endsAt.getTime() - startsAt.getTime() !== AVAILABILITY_SLOT_MINUTES * 60_000) {
    return fail("invalid");
  }

  try {
    const result = await runSerializable(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('booking-hold-customer'), hashtext(${customer.id}))`;
      await lockTechnicians(tx, [technicianId]);
      const context = await loadDayContext(
        tx,
        departmentId,
        date,
        [technicianId],
      );
      const technician = context.technicians.find(
        (candidate) => candidate.id === technicianId,
      );
      if (!technician) return fail("not_found");

      const existing = await tx.bookingHold.findFirst({
        where: {
          customerId: customer.id,
          technicianId,
          startsAt,
          endsAt,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        select: { token: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        return ok({
          token: existing.token,
          expiresAt: existing.expiresAt.toISOString(),
          date,
          from,
          to,
          technicianId,
          technicianName: technician.name ?? "",
          siteId,
        });
      }

      const available = isRangeBookable({
        date,
        startsAt,
        endsAt,
        now,
        businessHours: context.businessHours.map((window) => ({
          weekday: window.weekday,
          openMinute: window.startMinute,
          closeMinute: window.endMinute,
        })),
        availability: technician.availability,
        absences: technician.absences,
        visits: technician.visits,
        holds: technician.holds,
        holidays: context.holidays,
      });
      if (!available) return fail("conflict");

      // En kunde skal bare ha én aktiv reservasjon om gangen. Når hun bytter
      // time, frigjøres den forrige umiddelbart i stedet for å blokkere en
      // annen montør i fem minutter.
      await tx.bookingHold.deleteMany({
        where: {
          customerId: customer.id,
          OR: [
            { consumedAt: null },
            {
              consumedAt: {
                lt: new Date(
                  now.getTime() -
                    BOOKING_HOLD_RETENTION_HOURS * 60 * 60_000,
                ),
              },
            },
          ],
        },
      });

      const hold = await tx.bookingHold.create({
        data: {
          token: randomBytes(24).toString("base64url"),
          customerId: customer.id,
          siteId,
          technicianId,
          startsAt,
          endsAt,
          expiresAt: new Date(now.getTime() + BOOKING_HOLD_MINUTES * 60_000),
        },
        select: { token: true, expiresAt: true },
      });

      return ok({
        token: hold.token,
        expiresAt: hold.expiresAt.toISOString(),
        date,
        from,
        to,
        technicianId,
        technicianName: technician.name ?? "",
        siteId,
      });
    });
    return result;
  } catch (error) {
    console.error("Databasefeil ved reservasjon av bookingtime:", error);
    return fail("error");
  }
}
