import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { osloDayStart, parseDateOnly, toDateOnly, todayInOslo } from "@/lib/dates";
import { getDefaultDepartmentId } from "@/lib/departments";
import { staffForDepartment } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { neutralizeUrls } from "@/lib/neutralize-urls";
import {
  LIMITS,
  cleanMarkdown,
  cleanPhone,
  cleanText,
} from "@/lib/sanitize";
import { notifyUser, notifyWorkOrderEvent } from "./notifications";
import { createDefaultVisit, recomputeWorkOrderSchedule } from "./visits";
import {
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

const PAGE_SIZE = 20;

/** Kundebestillinger: maks fem per time, og ti per IP. */
const BOOKING_WINDOW_MS = 60 * 60_000;
const BOOKING_CUSTOMER_LIMIT = 5;
const BOOKING_IP_LIMIT = 10;
/** Maks antall åpne bestillinger kunden kan ha liggende samtidig. */
const BOOKING_OPEN_LIMIT = 5;
/** Like bestillinger innenfor dette vinduet regnes som samme hendelse. */
const BOOKING_DUPLICATE_WINDOW_MS = 10 * 60_000;
/** Endring av tid er en egen, avgrenset handling per kunde og bestilling. */
const BOOKING_RESCHEDULE_WINDOW_MS = 15 * 60_000;
const BOOKING_RESCHEDULE_LIMIT = 5;
/** Kunden kan be om ny tid til denne grensen før ønsket start. */
export const BOOKING_CHANGE_CUTOFF_HOURS = 24;
/** Minste ledetid fra forespørselen sendes til ønsket start. */
export const BOOKING_MIN_LEAD_HOURS = 24;
/** Hvor langt fram i tid en bestilling kan gjelde. */
const BOOKING_MAX_DAYS_AHEAD = 365;
/** Bestillingshistorikken vises i sider, ikke som en stille hard grense. */
export const PORTAL_BOOKING_PAGE_SIZE = 20;
const TIME_VALUE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Statusene som regnes som bekreftet av kontoret. Åpne forespørsler
 * (OPEN/PENDING) skal bare vises under «Dine bestillinger», ikke som
 * kommende oppdrag.
 */
export const PORTAL_CONFIRMED_WORK_ORDER_STATUSES = [
  "PLANNED",
  "WAITING",
  "IN_PROGRESS",
] as const;

/**
 * Oppdragsstatusene kundens kansellering kan avlyse direkte. Et oppdrag som
 * allerede er i gang (IN_PROGRESS) eller avsluttet skal ikke skjules som
 * kansellert; da varsles kontoret i stedet.
 */
export const PORTAL_CANCELLABLE_WORK_ORDER_STATUSES = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
] as const;

/**
 * Kommende-oppdrag-spørringen. Bare bekreftede statuser tas med, og et
 * oppdrag må fortsatt være aktivt i dag eller senere for å regnes som
 * kommende. Flerdagersoppdrag som startet tidligere, men varer i dag eller
 * senere, beholdes.
 */
export function portalUpcomingWhere(
  customerId: string,
  today: Date,
): Prisma.WorkOrderWhereInput {
  return {
    customerId,
    deletedAt: null,
    status: { in: [...PORTAL_CONFIRMED_WORK_ORDER_STATUSES] },
    OR: [
      { scheduledFor: { gte: today } },
      { scheduledTo: { gte: today } },
    ],
  };
}

function idFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

type BookingSchedule = {
  requestedDate: Date;
  requestedFrom: string;
  requestedTo: string;
};

/** Validerer ønsket dato og tidsvindu. Datoen er en ren kalenderdato. */
function parseBookingSchedule(input: {
  requestedDate?: unknown;
  requestedFrom?: unknown;
  requestedTo?: unknown;
}): ServiceResult<BookingSchedule> {
  const dateText = String(input.requestedDate ?? "").trim();
  const from = String(input.requestedFrom ?? "").trim();
  const to = String(input.requestedTo ?? "").trim();

  if (!dateText || !from || !to) return fail("missing_fields");

  const requestedDate = parseDateOnly(dateText);
  if (!requestedDate) return fail("invalid");
  if (!TIME_VALUE.test(from) || !TIME_VALUE.test(to) || from >= to) {
    return fail("invalid");
  }

  const today = parseDateOnly(todayInOslo());
  if (!today || requestedDate < today) return fail("invalid");

  const latest = new Date(today.getTime());
  latest.setUTCDate(latest.getUTCDate() + BOOKING_MAX_DAYS_AHEAD);
  if (requestedDate > latest) return fail("invalid");

  return ok({ requestedDate, requestedFrom: from, requestedTo: to });
}

/** Tidspunktet ønsket tidsvindu starter, i Oslo-tid. */
function requestedStart(schedule: BookingSchedule): Date {
  const [hours, minutes] = schedule.requestedFrom.split(":").map(Number);
  return new Date(
    osloDayStart(toDateOnly(schedule.requestedDate)).getTime() +
      (hours * 60 + minutes) * 60_000,
  );
}

/** Hele det ønskede tidsvinduet som absolutte Oslo-tidspunkter. */
function requestedWindow(schedule: BookingSchedule): {
  startsAt: Date;
  endsAt: Date;
} {
  const [hours, minutes] = schedule.requestedTo.split(":").map(Number);
  return {
    startsAt: requestedStart(schedule),
    endsAt: new Date(
      osloDayStart(toDateOnly(schedule.requestedDate)).getTime() +
        (hours * 60 + minutes) * 60_000,
    ),
  };
}

/** Fristen for å be om ny tid på bestillingen. */
export function bookingChangeDeadline(
  requestedDate: Date,
  requestedFrom: string,
): Date {
  const [hours, minutes] = requestedFrom.split(":").map(Number);
  return new Date(
    osloDayStart(toDateOnly(requestedDate)).getTime() +
      (hours * 60 + minutes) * 60_000 -
      BOOKING_CHANGE_CUTOFF_HOURS * 60 * 60_000,
  );
}

/** Ønsket start må ligge minst `BOOKING_MIN_LEAD_HOURS` fram i tid. */
function hasMinimumLeadTime(schedule: BookingSchedule, now = new Date()): boolean {
  return (
    requestedStart(schedule).getTime() >=
    now.getTime() + BOOKING_MIN_LEAD_HOURS * 60 * 60_000
  );
}

function isClosedWorkOrderStatus(status: string): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/**
 * En ubekreftet forespørsel kan alltid kanselleres, uavhengig av
 * 24-timersvinduet. Et bekreftet oppdrag kan også kanselleres, men selve
 * oppdraget avlyses bare når det ikke er i gang eller avsluttet.
 */
function canCancelBooking(status: string, workOrderStatus: string): boolean {
  if (status !== "PENDING") return false;
  return !isClosedWorkOrderStatus(workOrderStatus);
}

/** Ny tid krever fortsatt at endringsfristen og ledetiden er holdt. */
function canRescheduleBooking(
  status: string,
  workOrderStatus: string,
  requestedDate: Date,
  requestedFrom: string,
  now = new Date(),
): boolean {
  if (status !== "PENDING") return false;
  if (isClosedWorkOrderStatus(workOrderStatus)) return false;
  if (workOrderStatus === "IN_PROGRESS") return false;
  return now.getTime() < bookingChangeDeadline(requestedDate, requestedFrom).getTime();
}

/** Kort referanse kunden kan oppgi til kontoret. */
function bookingReference(workOrderId: string, now = new Date()): string {
  const day = toDateOnly(now).slice(2).replace(/-/g, "");
  return `B-${day}-${workOrderId.slice(-6).toUpperCase()}`;
}

/**
 * Kunden bestiller et nytt oppdrag.
 *
 * Autorisasjonen er serverstyrt: kunden kan bare bestille til sin egen
 * `customerId`, uansett hva klienten sender. Bestillingen rate-limites både
 * per kunde og per IP, og like bestillinger innenfor ti minutter slås sammen
 * slik at dobbeltklikk ikke gir flere oppdrag eller e-poster.
 */
export type CreateBookingInput = {
  title: string;
  description: string;
  requestedDate?: unknown;
  requestedFrom?: unknown;
  requestedTo?: unknown;
  equipmentId?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  preferredTechnicianId?: unknown;
  ip?: string;
};

export type CreateBookingResult = {
  id: string;
  reference: string;
  duplicate?: boolean;
};

export async function createBooking(
  actor: ServiceActor,
  input: CreateBookingInput,
): Promise<ServiceResult<CreateBookingResult>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const customerId = actor.customerId;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, departmentId: true },
  });
  if (!customer) return fail("forbidden");

  const title = cleanText(input.title, { maxLength: LIMITS.title });
  if (!title) return fail("missing_fields");
  const description = cleanMarkdown(input.description);

  const schedule = parseBookingSchedule(input);
  if (!schedule.ok) return schedule;
  if (!hasMinimumLeadTime(schedule.data)) {
    return fail("invalid");
  }

  const contactName = cleanText(input.contactName, {
    maxLength: LIMITS.short,
  });
  const contactPhone = cleanPhone(input.contactPhone);
  if (!contactName || contactPhone.length < 5) return fail("missing_fields");

  // Utstyret må tilhøre kunden. Klienten kan ikke velge fritt blant enheter.
  const equipmentId = idFrom(input.equipmentId);
  let equipmentLabel: string | null = null;
  if (equipmentId) {
    const product = await prisma.product.findFirst({
      where: { id: equipmentId, customerId },
      select: { model: true, serialNumber: true },
    });
    if (!product) return fail("invalid");
    equipmentLabel = product.serialNumber
      ? `${product.model} · SN ${product.serialNumber}`
      : product.model;
  }

  // Bestillingen havner i kundens avdeling, med standardavdelingen som
  // fallback. Det er samme avdeling som tilgjengelighetsoversikten viser.
  const departmentId = customer.departmentId ?? (await getDefaultDepartmentId());

  // Ønsket tekniker må være aktiv og jobbe i denne avdelingen.
  const preferredTechnicianId = idFrom(input.preferredTechnicianId);
  let preferredTechnicianName: string | null = null;
  if (preferredTechnicianId) {
    const technician = departmentId
      ? await prisma.user.findFirst({
          where: {
            id: preferredTechnicianId,
            ...staffForDepartment(departmentId),
          },
          select: { name: true },
        })
      : null;
    if (!technician) return fail("invalid");
    preferredTechnicianName = technician.name ?? null;
  }

  const customerLimit = await allowRequestDb(
    `booking:customer:${customerId}`,
    BOOKING_CUSTOMER_LIMIT,
    BOOKING_WINDOW_MS,
  );
  if (!customerLimit.allowed) return fail("rate_limited");

  if (input.ip) {
    const ipLimit = await allowRequestDb(
      `booking:ip:${input.ip}`,
      BOOKING_IP_LIMIT,
      BOOKING_WINDOW_MS,
    );
    if (!ipLimit.allowed) return fail("rate_limited");
  }

  // Finnes ingen aktiv avdeling, kan bestillingen ikke opprettes.
  if (!departmentId) return fail("error");

  // Duplikatsjekk, åpen-grense og opprettelse må skje under samme lås. Ellers
  // kan to samtidige dobbeltklikk begge se «ingen duplikat» og begge opprette
  // et oppdrag, og åpen-grensen kan telles før den andre har skrevet.
  let outcome:
    | { kind: "created"; id: string; reference: string }
    | { kind: "duplicate"; id: string; reference: string }
    | { kind: "conflict" };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // Låsen er per kunde og slippes automatisk ved commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${customerId}`}))`;

      // Samme tittel, beskrivelse og ønsket tid like etter forrige bestilling
      // er nesten alltid et dobbeltklikk. Da returneres den eksisterende saken
      // uten ny varsling eller e-post.
      const duplicate = await tx.workOrder.findFirst({
        where: {
          customerId,
          title,
          description,
          deletedAt: null,
          createdAt: { gte: new Date(Date.now() - BOOKING_DUPLICATE_WINDOW_MS) },
          bookingRequest: {
            is: {
              requestedDate: schedule.data.requestedDate,
              requestedFrom: schedule.data.requestedFrom,
              requestedTo: schedule.data.requestedTo,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          bookingRequest: { select: { reference: true } },
        },
      });
      if (duplicate) {
        return {
          kind: "duplicate",
          id: duplicate.id,
          reference:
            duplicate.bookingRequest?.reference ?? bookingReference(duplicate.id),
        } as const;
      }

      // Grensen gjelder alle saker som ikke er avsluttet – ikke bare OPEN.
      // Et bestilt oppdrag kan stå i PENDING/PLANNED uten å være ferdig.
      const openBookings = await tx.workOrder.count({
        where: {
          customerId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          deletedAt: null,
        },
      });
      if (openBookings >= BOOKING_OPEN_LIMIT) {
        return { kind: "conflict" } as const;
      }

      const workOrder = await tx.workOrder.create({
        data: {
          title,
          description: description || "",
          departmentId,
          customerId,
          productId: equipmentId || undefined,
          contactId: actor.contactId || undefined,
          creatorName: actor.name || actor.email || "Kunde",
          status: "OPEN",
          scheduledFor: schedule.data.requestedDate,
          scheduledTo: schedule.data.requestedDate,
          technicians: { connect: [] },
        },
        select: { id: true },
      });

      // Bestillingen er en konkret tidsblokk i kundens ønskede vindu. Kontoret
      // kan senere flytte den på visit-nivå; `BookingRequest` beholder
      // fortsatt kundens opprinnelige ønske som snapshot.
      const window = requestedWindow(schedule.data);
      await createDefaultVisit(tx, {
        workOrderId: workOrder.id,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        allDay: false,
      });
      await recomputeWorkOrderSchedule(tx, workOrder.id);

      const reference = bookingReference(workOrder.id);
      const booking = await tx.bookingRequest.create({
        data: {
          reference,
          workOrderId: workOrder.id,
          customerId,
          ...schedule.data,
          equipmentId: equipmentId || null,
          equipmentLabel,
          preferredTechnicianId: preferredTechnicianId || null,
          preferredTechnicianName,
          contactName,
          contactPhone,
        },
        select: { id: true, reference: true },
      });

      await tx.bookingRequestEvent.create({
        data: {
          bookingRequestId: booking.id,
          type: "CREATED",
          requestedDate: schedule.data.requestedDate,
          requestedFrom: schedule.data.requestedFrom,
          requestedTo: schedule.data.requestedTo,
          actorName: contactName,
        },
      });

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrder.id,
        action: `Kunde booket nytt oppdrag: ${title}`,
        actor: toAuditActor(actor),
        metadata: {
          customerId,
          bookingRequestId: booking.id,
          reference: booking.reference,
        },
      });

      return {
        kind: "created",
        id: workOrder.id,
        reference: booking.reference,
      } as const;
    });
  } catch (error) {
    // Transaksjonen ruller tilbake både oppdraget og revisjonsloggen.
    // creatorName kan være brukerens e-post, så rå Prisma-feil logges ikke.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "ukjent";
    console.error(`Databasefeil ved booking av oppdrag (Prisma ${code})`);
    return fail("error");
  }

  if (outcome.kind === "conflict") return fail("conflict");
  if (outcome.kind === "duplicate") {
    return ok({
      id: outcome.id,
      reference: outcome.reference,
      duplicate: true,
    });
  }
  const created = { id: outcome.id, reference: outcome.reference };

  // Varselet legges i køen (in-app + e-post sendes av jobbworkeren), slik at
  // treg SMTP ikke blokkerer bestillingen. Bare kontoret i destinasjons-
  // avdelingen varsles.
  try {
    await notifyWorkOrderEvent(
      created.id,
      "BOOKING",
      "Ny bestilling fra kundeportal",
      `Kunden har booket «${neutralizeUrls(title)}» (${created.reference}). Ønsket tid: ${toDateOnly(schedule.data.requestedDate)} kl. ${schedule.data.requestedFrom}–${schedule.data.requestedTo}.`,
      `/oppdrag/${created.id}`,
      `booking:${created.id}`,
    );
  } catch (error) {
    console.error("Kunne ikke legge bestillingsvarsel i køen:", error);
  }

  return ok(created);
}

export type PortalBookingEvent = {
  id: string;
  type: "CREATED" | "RESCHEDULED" | "CANCELLED";
  message: string | null;
  requestedDate: string | null;
  requestedFrom: string | null;
  requestedTo: string | null;
  actorName: string | null;
  createdAt: string;
};

export type PortalBooking = {
  id: string;
  reference: string;
  status: "PENDING" | "CANCELLED";
  displayStatus: "pending" | "confirmed" | "completed" | "cancelled";
  requestedDate: string;
  requestedFrom: string;
  requestedTo: string;
  equipmentLabel: string | null;
  preferredTechnicianName: string | null;
  contactName: string;
  contactPhone: string;
  createdAt: string;
  canCancel: boolean;
  canReschedule: boolean;
  changeDeadline: string;
  workOrder: {
    id: string;
    title: string;
    status: string;
    scheduledFor: string | null;
    scheduledTo: string | null;
  };
  events: PortalBookingEvent[];
};

export type PortalBookingPage = {
  items: PortalBooking[];
  total: number;
  page: number;
  totalPages: number;
};

function bookingDisplayStatus(
  bookingStatus: string,
  workOrderStatus: string,
): PortalBooking["displayStatus"] {
  if (bookingStatus === "CANCELLED" || workOrderStatus === "CANCELLED") {
    return "cancelled";
  }
  if (workOrderStatus === "COMPLETED") return "completed";
  if (workOrderStatus === "OPEN" || workOrderStatus === "PENDING") return "pending";
  return "confirmed";
}

/**
 * Kundens egne bestillinger med status og historikk. Spørringen er alltid
 * avgrenset til aktørens `customerId`; en kunde kan ikke se andres saker.
 * Historikken pagineres med en synlig total, slik at listen ikke stopper
 * stille etter en fast radgrense.
 */
export async function getPortalBookingRequests(
  actor: ServiceActor,
  options: { page?: number } = {},
): Promise<ServiceResult<PortalBookingPage>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const where = {
    customerId: actor.customerId,
    workOrder: { deletedAt: null },
  };
  const total = await prisma.bookingRequest.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PORTAL_BOOKING_PAGE_SIZE));
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1));
  const page = Math.min(requestedPage, totalPages);

  const bookings = await prisma.bookingRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PORTAL_BOOKING_PAGE_SIZE,
    take: PORTAL_BOOKING_PAGE_SIZE,
    select: {
      id: true,
      reference: true,
      status: true,
      requestedDate: true,
      requestedFrom: true,
      requestedTo: true,
      equipmentLabel: true,
      preferredTechnicianName: true,
      contactName: true,
      contactPhone: true,
      createdAt: true,
      workOrder: {
        select: {
          id: true,
          title: true,
          status: true,
          scheduledFor: true,
          scheduledTo: true,
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          message: true,
          requestedDate: true,
          requestedFrom: true,
          requestedTo: true,
          actorName: true,
          createdAt: true,
        },
      },
    },
  });

  return ok({
    total,
    page,
    totalPages,
    items: bookings.map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      displayStatus: bookingDisplayStatus(booking.status, booking.workOrder.status),
      requestedDate: toDateOnly(booking.requestedDate),
      requestedFrom: booking.requestedFrom,
      requestedTo: booking.requestedTo,
      equipmentLabel: booking.equipmentLabel,
      preferredTechnicianName: booking.preferredTechnicianName,
      contactName: booking.contactName,
      contactPhone: booking.contactPhone,
      createdAt: booking.createdAt.toISOString(),
      canCancel: canCancelBooking(booking.status, booking.workOrder.status),
      canReschedule: canRescheduleBooking(
        booking.status,
        booking.workOrder.status,
        booking.requestedDate,
        booking.requestedFrom,
      ),
      changeDeadline: bookingChangeDeadline(
        booking.requestedDate,
        booking.requestedFrom,
      ).toISOString(),
      workOrder: {
        id: booking.workOrder.id,
        title: booking.workOrder.title,
        status: booking.workOrder.status,
        scheduledFor: booking.workOrder.scheduledFor
          ? toDateOnly(booking.workOrder.scheduledFor)
          : null,
        scheduledTo: booking.workOrder.scheduledTo
          ? toDateOnly(booking.workOrder.scheduledTo)
          : null,
      },
      events: booking.events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        requestedDate: event.requestedDate ? toDateOnly(event.requestedDate) : null,
        requestedFrom: event.requestedFrom,
        requestedTo: event.requestedTo,
        actorName: event.actorName,
        createdAt: event.createdAt.toISOString(),
      })),
    })),
  });
}

type BookingChangeRow = {
  id: string;
  reference: string;
  customerId: string;
  status: string;
  requestedDate: Date;
  requestedFrom: string;
  requestedTo: string;
  workOrder: {
    id: string;
    title: string;
    status: string;
    customerId: string | null;
    deletedAt: Date | null;
  };
};

async function ownBooking(
  actor: ServiceActor,
  bookingId: unknown,
): Promise<ServiceResult<BookingChangeRow>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }
  const id = idFrom(bookingId);
  if (!id) return fail("invalid");

  const booking = await prisma.bookingRequest.findFirst({
    where: {
      id,
      customerId: actor.customerId,
      // Bestillingen kan henge igjen på et oppdrag som senere er flyttet til
      // en annen kunde. Den gamle kunden skal ikke kunne endre oppdraget.
      workOrder: { customerId: actor.customerId },
    },
    select: {
      id: true,
      reference: true,
      customerId: true,
      status: true,
      requestedDate: true,
      requestedFrom: true,
      requestedTo: true,
      workOrder: {
        select: {
          id: true,
          title: true,
          status: true,
          customerId: true,
          deletedAt: true,
        },
      },
    },
  });
  if (!booking) return fail("not_found");
  // Kontrollerer også raden vi faktisk fikk tilbake, slik at en fremmed
  // oppdragskunde aldri kan mutere saken selv om spørringen skulle være utdatert.
  if (booking.workOrder.customerId !== actor.customerId) return fail("not_found");
  return ok(booking);
}

/** Kunden kansellerer sin egen bestilling. */
export async function cancelBooking(
  actor: ServiceActor,
  input: { bookingId: unknown },
): Promise<
  ServiceResult<{
    status: "cancelled";
    reference: string;
    /** Oppdraget ble samtidig satt til CANCELLED. */
    workOrderCancelled: boolean;
    /** Oppdraget var allerede i gang, så bare forespørselen ble kansellert. */
    visitInProgress: boolean;
  }>
> {
  const booking = await ownBooking(actor, input.bookingId);
  if (!booking.ok) return booking;

  const workOrderStatus = booking.data.workOrder.status;
  const visitInProgress = workOrderStatus === "IN_PROGRESS";
  if (booking.data.status === "CANCELLED") {
    return ok({
      status: "cancelled",
      reference: booking.data.reference,
      workOrderCancelled: false,
      visitInProgress,
    });
  }
  if (booking.data.workOrder.deletedAt) return fail("not_found");
  // En forespørsel kan alltid kanselleres, også innenfor 24-timersvinduet.
  // Bare et avsluttet oppdrag er stengt for kansellering.
  if (!canCancelBooking(booking.data.status, workOrderStatus)) {
    return fail("invalid");
  }

  const shouldCancelWorkOrder = (
    PORTAL_CANCELLABLE_WORK_ORDER_STATUSES as readonly string[]
  ).includes(workOrderStatus);

  let outcome: {
    changed: boolean;
    workOrderCancelled: boolean;
    visitInProgress: boolean;
  } = {
    changed: false,
    workOrderCancelled: false,
    visitInProgress,
  };

  try {
    outcome = await prisma.$transaction(async (tx) => {
      const updated = await tx.bookingRequest.updateMany({
        where: {
          id: booking.data.id,
          customerId: actor.customerId!,
          status: "PENDING",
        },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (updated.count !== 1) {
        return {
          changed: false,
          workOrderCancelled: false,
          visitInProgress,
        } as const;
      }

      // Et oppdrag som ikke er i gang eller avsluttet, avlyses i samme
      // transaksjon som forespørselen. IN_PROGRESS skal fortsatt være synlig
      // som pågående arbeid; kontoret varsles i stedet.
      let workOrderCancelled = false;
      if (shouldCancelWorkOrder) {
        const cancelledWorkOrder = await tx.workOrder.updateMany({
          where: {
            id: booking.data.workOrder.id,
            customerId: actor.customerId!,
            status: { in: [...PORTAL_CANCELLABLE_WORK_ORDER_STATUSES] },
          },
          data: { status: "CANCELLED" },
        });
        workOrderCancelled = cancelledWorkOrder.count === 1;
      }

      await tx.bookingRequestEvent.create({
        data: {
          bookingRequestId: booking.data.id,
          type: "CANCELLED",
          message: workOrderCancelled
            ? null
            : "Oppdraget var allerede i gang eller avsluttet; kontoret er varslet.",
          actorName: actor.name || actor.email || "Kunde",
        },
      });

      await audit(tx, {
        entityType: "BookingRequest",
        entityId: booking.data.id,
        action: "Kunden kansellerte bestillingen",
        actor: toAuditActor(actor),
        metadata: {
          customerId: actor.customerId,
          workOrderId: booking.data.workOrder.id,
          reference: booking.data.reference,
          workOrderCancelled,
        },
      });

      return {
        changed: true,
        workOrderCancelled,
        visitInProgress: !workOrderCancelled && visitInProgress,
      } as const;
    });
  } catch (error) {
    console.error("Databasefeil ved kansellering av bestilling:", error);
    return fail("error");
  }

  if (!outcome.changed) {
    // En samtidig forespørsel vant race-en og har allerede kansellert saken.
    return ok({
      status: "cancelled",
      reference: booking.data.reference,
      workOrderCancelled: outcome.workOrderCancelled,
      visitInProgress: outcome.visitInProgress,
    });
  }

  const title = outcome.workOrderCancelled
    ? "Kunde kansellerte bestilling"
    : outcome.visitInProgress
      ? "Kunde kansellerte – oppdraget er i gang"
      : "Kunde kansellerte bestilling";
  const body = outcome.workOrderCancelled
    ? `Bestilling ${booking.data.reference} er kansellert av kunden. Oppdraget er også satt til kansellert.`
    : outcome.visitInProgress
      ? `Bestilling ${booking.data.reference} er markert som kansellert av kunden, men oppdraget er allerede i gang. Avtalen er ikke automatisk avlyst – kontoret må følge opp.`
      : `Bestilling ${booking.data.reference} er kansellert av kunden.`;

  try {
    await notifyWorkOrderEvent(
      booking.data.workOrder.id,
      "BOOKING",
      title,
      body,
      `/oppdrag/${booking.data.workOrder.id}`,
      `booking-cancel:${booking.data.id}`,
    );
  } catch (error) {
    console.error("Kunne ikke varsle om kansellert bestilling:", error);
  }

  return ok({
    status: "cancelled",
    reference: booking.data.reference,
    workOrderCancelled: outcome.workOrderCancelled,
    visitInProgress: outcome.visitInProgress,
  });
}

/** Kunden ber om et nytt tidsvindu fram til endringsfristen. */
export async function rescheduleBooking(
  actor: ServiceActor,
  input: {
    bookingId: unknown;
    requestedDate?: unknown;
    requestedFrom?: unknown;
    requestedTo?: unknown;
  },
): Promise<
  ServiceResult<{
    status: "rescheduled";
    reference: string;
    requestedDate: string;
    requestedFrom: string;
    requestedTo: string;
  }>
> {
  const booking = await ownBooking(actor, input.bookingId);
  if (!booking.ok) return booking;

  // Endring av tid utløser varsler til kontoret. Begrens antallet per kunde og
  // bestilling, slik at en gjentatt forespørsel ikke kan fylle varselkøen.
  const limit = await allowRequestDb(
    `booking-reschedule:${actor.id}:${booking.data.id}`,
    BOOKING_RESCHEDULE_LIMIT,
    BOOKING_RESCHEDULE_WINDOW_MS,
  );
  if (!limit.allowed) return fail("rate_limited");

  if (booking.data.workOrder.deletedAt) return fail("not_found");
  if (
    !canRescheduleBooking(
      booking.data.status,
      booking.data.workOrder.status,
      booking.data.requestedDate,
      booking.data.requestedFrom,
    )
  ) {
    return fail("deadline_passed");
  }

  const schedule = parseBookingSchedule(input);
  if (!schedule.ok) return schedule;

  // Ny tid må også ha minst like lang ledetid som en ny forespørsel.
  if (!hasMinimumLeadTime(schedule.data)) {
    return fail("invalid");
  }

  // Uendret tidsvindu er ikke en endring. Da skal verken historikk, varsel
  // eller oppdragets plan røres.
  const unchanged =
    toDateOnly(booking.data.requestedDate) ===
      toDateOnly(schedule.data.requestedDate) &&
    booking.data.requestedFrom === schedule.data.requestedFrom &&
    booking.data.requestedTo === schedule.data.requestedTo;
  if (unchanged) {
    return ok({
      status: "rescheduled",
      reference: booking.data.reference,
      requestedDate: toDateOnly(schedule.data.requestedDate),
      requestedFrom: schedule.data.requestedFrom,
      requestedTo: schedule.data.requestedTo,
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bookingRequest.update({
        where: { id: booking.data.id },
        data: schedule.data,
      });

      await tx.bookingRequestEvent.create({
        data: {
          bookingRequestId: booking.data.id,
          type: "RESCHEDULED",
          requestedDate: schedule.data.requestedDate,
          requestedFrom: schedule.data.requestedFrom,
          requestedTo: schedule.data.requestedTo,
          actorName: actor.name || actor.email || "Kunde",
        },
      });

      // Bare en ubekreftet sak flyttes direkte. En planlagt sak beholder
      // planen til kontoret har bekreftet den nye tiden.
      const moved = await tx.workOrder.updateMany({
        where: {
          id: booking.data.workOrder.id,
          customerId: actor.customerId!,
          status: "OPEN",
        },
        data: {
          scheduledFor: schedule.data.requestedDate,
          scheduledTo: schedule.data.requestedDate,
        },
      });

      if (moved.count > 0) {
        const visits = await tx.visit.findMany({
          where: { workOrderId: booking.data.workOrder.id },
          select: { id: true, status: true },
          orderBy: { sequence: "asc" },
        });
        const window = requestedWindow(schedule.data);

        if (visits.length === 1) {
          await tx.visit.update({
            where: { id: visits[0].id },
            data: {
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              allDay: false,
            },
          });
        } else if (visits.length === 0) {
          await createDefaultVisit(tx, {
            workOrderId: booking.data.workOrder.id,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            allDay: false,
          });
        }

        // En bestilling har alltid én standardvisitt. Skulle raden likevel ha
        // flere (visit-nivå har tatt over), røres de ikke her.
        if (visits.length <= 1) {
          await recomputeWorkOrderSchedule(tx, booking.data.workOrder.id);
        }
      }

      await audit(tx, {
        entityType: "BookingRequest",
        entityId: booking.data.id,
        action: "Kunden ba om ny tid",
        actor: toAuditActor(actor),
        metadata: {
          customerId: actor.customerId,
          workOrderId: booking.data.workOrder.id,
          reference: booking.data.reference,
          requestedDate: toDateOnly(schedule.data.requestedDate),
          requestedFrom: schedule.data.requestedFrom,
          requestedTo: schedule.data.requestedTo,
        },
      });
    });
  } catch (error) {
    console.error("Databasefeil ved ny-tid-forespørsel:", error);
    return fail("error");
  }

  try {
    await notifyWorkOrderEvent(
      booking.data.workOrder.id,
      "BOOKING",
      "Kunde ba om ny tid",
      `Bestilling ${booking.data.reference}: ønsket ny tid ${toDateOnly(schedule.data.requestedDate)} kl. ${schedule.data.requestedFrom}–${schedule.data.requestedTo}.`,
      `/oppdrag/${booking.data.workOrder.id}`,
      `booking-reschedule:${booking.data.id}:${toDateOnly(schedule.data.requestedDate)}:${schedule.data.requestedFrom}:${schedule.data.requestedTo}`,
    );
  } catch (error) {
    console.error("Kunne ikke varsle om ny-tid-forespørsel:", error);
  }

  return ok({
    status: "rescheduled",
    reference: booking.data.reference,
    requestedDate: toDateOnly(schedule.data.requestedDate),
    requestedFrom: schedule.data.requestedFrom,
    requestedTo: schedule.data.requestedTo,
  });
}

/**
 * Rapporthistorikk for kundeportalen. Begrenset per side, og bare for
 * innloggede CUSTOMER-brukere med kundetilknytning.
 */
export async function getPortalReportHistory(
  actor: ServiceActor,
  options: { page?: number } = {},
): Promise<ServiceResult<unknown>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const page = Math.max(1, options.page ?? 1);
  // Alle avsluttede oppdrag, også de uten rapport, slik at kundeportalen har
  // én samlet historikk i stedet for to nesten like lister.
  const where = {
    customerId: actor.customerId,
    deletedAt: null,
    status: { in: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] },
  };

  const [items, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      orderBy: { scheduledFor: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        orderNumber: true,
        scheduledFor: true,
        reports: {
          where: { deletedAt: null },
          orderBy: { completedAt: "desc" },
          // Alle rapporter for oppdraget, ikke bare den nyeste. Kunden skal
          // kunne se og kvittere for hver enkelt rapport.
          select: {
            id: true,
            name: true,
            templateTitle: true,
            reportNumber: true,
            requiresUnits: true,
            completedAt: true,
            isLocked: true,
            revision: true,
            pdfUrl: true,
            customerAcknowledgedAt: true,
            customerAcknowledgedBy: true,
            customerAcknowledgedComment: true,
          },
        },
      },
    }),
    prisma.workOrder.count({ where }),
  ]);

  return ok({
    items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

/**
 * Kunden ber kontoret oppdatere kontaktinformasjonen sin. Selve endringen
 * gjøres av kontoret; kunden får ikke skrive til kundekortet direkte.
 */
export async function requestContactUpdate(
  actor: ServiceActor,
  input: { contactId?: unknown; message?: unknown },
): Promise<ServiceResult<{ notified: number }>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const customer = await prisma.customer.findFirst({
    where: { id: actor.customerId, deletedAt: null },
    select: { id: true, name: true, departmentId: true },
  });
  if (!customer) return fail("not_found");

  const contactId = idFrom(input.contactId);
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, customerId: actor.customerId },
      select: { id: true, name: true },
    });
    if (!contact) return fail("not_found");
  }

  const message =
    typeof input.message === "string"
      ? input.message.trim().slice(0, 2000)
      : "";
  const office = await prisma.user.findMany({
    where: {
      departmentId: customer.departmentId,
      role: { in: ["ADMIN", "OFFICE"] },
      isActive: true,
    },
    select: { id: true },
    take: 50,
  });

  let notified = 0;
  for (const user of office) {
    const result = await notifyUser({
      userId: user.id,
      type: "CONTACT_UPDATE",
      title: "Kunde ber om oppdatert kontaktinformasjon",
      body:
        neutralizeUrls(message) ||
        `Kunden ${neutralizeUrls(customer.name)} ber om oppdatering av kontaktinformasjon.`,
      href: `/kunder/${customer.id}`,
      sourceLabel: `Kunde: ${customer.name}`,
      dedupeKey: `contact-update:${customer.id}:${toDateOnly(new Date())}:${user.id}`,
    });
    if (result) notified += 1;
  }

  return ok({ notified });
}

/**
 * Kunden kvitterer for at en signert rapport er mottatt. Kvitteringen er
 * idempotent og logges i samme transaksjon som oppdateringen.
 */
export async function acknowledgeReport(
  actor: ServiceActor,
  input: { workOrderId?: unknown; reportId?: unknown; comment?: unknown },
): Promise<ServiceResult> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const workOrderId = idFrom(input.workOrderId);
  if (!workOrderId) return fail("invalid");

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, customerId: actor.customerId, deletedAt: null },
    select: {
      id: true,
      customerId: true,
      reports: {
        // Alle rapportene hentes, ikke bare den nyeste: en kunde kan kvittere
        // for en bestemt rapport i historikken. Slettede rapporter filtreres
        // bort og kan derfor aldri kvitteres.
        where: { deletedAt: null },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          isLocked: true,
          customerAcknowledgedAt: true,
        },
      },
    },
  });

  if (!workOrder || workOrder.customerId !== actor.customerId) {
    return fail("not_found");
  }

  const requestedReportId = idFrom(input.reportId);
  const report = requestedReportId
    ? (workOrder.reports.find((row) => row.id === requestedReportId) ?? null)
    : (workOrder.reports.find((row) => row.isLocked) ?? null);

  // Bare en signert (låst) rapport er et ferdig dokument kunden kan kvittere
  // for. En opplåst rapport er under retting, og en slettet rapport finnes
  // ikke i listen.
  if (!report || !report.isLocked) return fail("not_found");
  if (report.customerAcknowledgedAt) return ok(undefined);

  const comment =
    typeof input.comment === "string"
      ? input.comment.trim().slice(0, 2000) || null
      : null;

  // Atomisk kvittering: bare den første samtidige forespørselen får count = 1.
  // Da kan det aldri skrives to revisjonsrader for samme kvittering.
  await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: {
        id: report.id,
        deletedAt: null,
        isLocked: true,
        customerAcknowledgedAt: null,
      },
      data: {
        customerAcknowledgedAt: new Date(),
        customerAcknowledgedBy: actor.name || actor.email || "Kunde",
        customerAcknowledgedComment: comment,
      },
    });

    if (updated.count !== 1) return;

    await audit(tx, {
      entityType: "Report",
      entityId: report.id,
      action: "Kunden kvitterte for rapporten",
      actor: toAuditActor(actor),
      metadata: { workOrderId, reportId: report.id },
    });
  });

  return ok(undefined);
}
