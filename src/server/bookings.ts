// i18n-ignore-file: kontorkøen lagrer revisjonstekster som data; alle
// UI-strenger oversettes i siden og komponentene.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { staffForDepartment } from "@/lib/access";
import { parseDateOnly, toDateOnly } from "@/lib/dates";
import {
  BOOKING_TIME_VALUE,
  requestedWindow,
} from "@/lib/booking-time";
import { statusKeysByCategory } from "@/lib/work-order-status";
import { notifyWorkOrderEvent } from "./notifications";
import { trySendBookingConfirmedSms } from "./sms-events";
import { enqueueBookingEmail } from "./email-outbox";
import {
  assertTechnicianSlotAvailable,
  listAvailableTechniciansForWindow,
  lockTechnicians,
  runSerializable,
} from "./availability";
import { recomputeWorkOrderSchedule } from "./visits";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

const QUEUE_PAGE_SIZE = 30;

export type BookingQueueFilter = "all" | "pending" | "confirmed" | "closed";

export type BookingQueueTechnician = { id: string; name: string | null };

export type BookingQueueItem = {
  id: string;
  reference: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
  serviceType: string | null;
  siteName: string | null;
  requestedDate: string;
  requestedFrom: string;
  requestedTo: string;
  preferredTechnicianName: string | null;
  customerName: string;
  confirmedAt: string | null;
  createdAt: string;
  workOrder: {
    id: string;
    title: string;
    status: string;
  };
  /** Alle aktive ansatte i oppdragets avdeling som kan planlegges. */
  technicians: BookingQueueTechnician[];
  /** Ansatte som er ledige i det opprinnelige tidsvinduet, når det finnes. */
  availableTechnicians: BookingQueueTechnician[];
};

export type BookingQueuePage = {
  items: BookingQueueItem[];
  total: number;
  page: number;
  totalPages: number;
};

function whereForFilter(
  filter: BookingQueueFilter,
): Prisma.BookingRequestWhereInput {
  if (filter === "pending") return { status: "PENDING" };
  if (filter === "confirmed") return { status: "CONFIRMED" };
  if (filter === "closed") {
    return { status: { in: ["CANCELLED", "EXPIRED"] } };
  }
  return {};
}

/**
 * Et konkret tidsrom kontoret har valgt for en ellers datobasert forespørsel.
 * Dato og klokkeslett tolkes alltid i Europe/Oslo, slik at nettleserens
 * tidssone ikke kan flytte planleggingen.
 */
type PlannedBookingWindow = {
  date: Date;
  dateOnly: string;
  from: string;
  to: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Leser et eksplisitt planleggingsvindu fra kontorskjemaet. Alle tre feltene
 * må være satt; en halvutfylt planlegging skal ikke falle tilbake til den
 * gamle forespørselen uten tid.
 */
function parsePlannedWindow(input: {
  date?: unknown;
  from?: unknown;
  to?: unknown;
}): ServiceResult<PlannedBookingWindow | null> {
  const dateText =
    typeof input.date === "string" ? input.date.trim().slice(0, 10) : "";
  const from = typeof input.from === "string" ? input.from.trim() : "";
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!dateText && !from && !to) return ok(null);

  const date = parseDateOnly(dateText);
  if (!date || !BOOKING_TIME_VALUE.test(from) || !BOOKING_TIME_VALUE.test(to)) {
    return fail("invalid", { code: "invalid_time" });
  }

  const window = requestedWindow({
    requestedDate: date,
    requestedFrom: from,
    requestedTo: to,
  });
  if (window.endsAt.getTime() <= window.startsAt.getTime()) {
    return fail("invalid", { code: "invalid_time" });
  }

  return ok({
    date,
    dateOnly: toDateOnly(date),
    from,
    to,
    ...window,
  });
}

/**
 * Kontorets bookingkø. Bare saker i aktørens oppdragsscope vises. For
 * ventende forespørsler beregnes ledige montører for det ønskede vinduet, slik
 * at saksbehandleren kan bekrefte uten å gjette.
 */
export async function listBookingQueue(
  actor: ServiceActor,
  options: { filter?: BookingQueueFilter; page?: number } = {},
): Promise<ServiceResult<BookingQueuePage>> {
  if (!can(actor, "workorders.view")) return fail("forbidden");

  const filter = options.filter ?? "all";
  const where: Prisma.BookingRequestWhereInput = {
    ...whereForFilter(filter),
    workOrder: { AND: [workOrderScopeFor(actor)] },
  };
  const total = await prisma.bookingRequest.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1));
  const page = Math.min(requestedPage, totalPages);

  const bookings = await prisma.bookingRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * QUEUE_PAGE_SIZE,
    take: QUEUE_PAGE_SIZE,
    select: {
      id: true,
      reference: true,
      status: true,
      serviceType: true,
      requestedDate: true,
      requestedFrom: true,
      requestedTo: true,
      preferredTechnicianName: true,
      confirmedAt: true,
      createdAt: true,
      site: { select: { name: true } },
      customer: { select: { name: true } },
      workOrder: {
        select: { id: true, title: true, status: true, departmentId: true },
      },
      visit: {
        select: {
          technicians: { select: { user: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  const items: BookingQueueItem[] = [];
  const staffByDepartment = new Map<string, BookingQueueTechnician[]>();
  for (const booking of bookings) {
    let availableTechnicians: BookingQueueTechnician[] = [];
    // Nye kundebestillinger har bare ønsket dato; kontoret planlegger tid og
    // montør i køen. Vis ikke falske ledige timer for slike saker.
    if (
      booking.status === "PENDING" &&
      booking.requestedFrom &&
      booking.requestedTo
    ) {
      const window = requestedWindow({
        requestedDate: booking.requestedDate,
        requestedFrom: booking.requestedFrom,
        requestedTo: booking.requestedTo,
      });
      availableTechnicians = await listAvailableTechniciansForWindow(
        prisma as unknown as Prisma.TransactionClient,
        {
          departmentId: booking.workOrder.departmentId,
          date: toDateOnly(booking.requestedDate),
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          leadHours: 0,
        },
      );
    }

    // Skjemaet må kunne planlegge vilkårlige tider og datoer, også når den
    // opprinnelige forespørselen bare hadde en dato. Derfor viser vi alle
    // aktive ansatte i avdelingen og lar tjenestelaget validere valget.
    let technicians: BookingQueueTechnician[] = [];
    if (booking.status === "PENDING") {
      const cached = staffByDepartment.get(booking.workOrder.departmentId);
      if (cached) {
        technicians = cached;
      } else {
        technicians = await prisma.user.findMany({
          where: staffForDepartment(booking.workOrder.departmentId),
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 200,
        });
        staffByDepartment.set(booking.workOrder.departmentId, technicians);
      }
    }

    items.push({
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      serviceType: booking.serviceType,
      siteName: booking.site?.name ?? null,
      requestedDate: toDateOnly(booking.requestedDate),
      requestedFrom: booking.requestedFrom,
      requestedTo: booking.requestedTo,
      preferredTechnicianName:
        booking.preferredTechnicianName ??
        booking.visit?.technicians
          .map((technician) => technician.user.name)
          .filter(Boolean)
          .join(", ") ??
        null,
      customerName: booking.customer.name,
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
      workOrder: {
        id: booking.workOrder.id,
        title: booking.workOrder.title,
        status: booking.workOrder.status,
      },
      technicians,
      availableTechnicians,
    });
  }

  return ok({ items, total, page, totalPages });
}

/**
 * Bekrefter en ventende forespørsel mot en ledig montør. Kontoret kan sende
 * inn et konkret tidsrom for datobestillinger; eldre forespørsler med lagret
 * tidsvindu bruker det når skjemaet ikke oppgir noe. Timen kontrolleres på nytt
 * under lås, slik at to saksbehandlere ikke kan bekrefte samme montør og tid
 * samtidig.
 */
export async function confirmBooking(
  actor: ServiceActor,
  input: {
    bookingId: unknown;
    technicianId?: unknown;
    /** Valgfritt planleggingsvindu fra kontorskjemaet, i Oslo-tid. */
    date?: unknown;
    from?: unknown;
    to?: unknown;
  },
): Promise<
  ServiceResult<{
    reference: string;
    technicianName: string | null;
    already: boolean;
  }>
> {
  if (!can(actor, "workorders.assign")) return fail("forbidden");

  const bookingId =
    typeof input.bookingId === "string" ? input.bookingId.trim().slice(0, 64) : "";
  if (!bookingId) return fail("invalid");
  const requestedTechnicianId =
    typeof input.technicianId === "string"
      ? input.technicianId.trim().slice(0, 64)
      : "";

  const parsedWindow = parsePlannedWindow(input);
  if (!parsedWindow.ok) return parsedWindow;
  const explicitWindow = parsedWindow.data;

  try {
    const result = await runSerializable(async (tx) => {
      const booking = await tx.bookingRequest.findFirst({
        where: {
          id: bookingId,
          workOrder: { AND: [workOrderScopeFor(actor)] },
        },
        select: {
          id: true,
          reference: true,
          status: true,
          requestedDate: true,
          requestedFrom: true,
          requestedTo: true,
          visitId: true,
          workOrder: {
            select: {
              id: true,
              title: true,
              status: true,
              departmentId: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!booking || booking.workOrder.deletedAt) return fail("not_found");
      if (booking.status === "CONFIRMED") {
        return ok({
          reference: booking.reference,
          technicianName: null,
          already: true,
        });
      }
      if (booking.status !== "PENDING") return fail("conflict");

      let window: PlannedBookingWindow;
      if (explicitWindow) {
        window = explicitWindow;
      } else {
        // Eldre forespørsler kan ha et lagret tidsvindu. Nye kundebestillinger
        // er datobaserte og må få dato, start og slutt fra kontorskjemaet.
        if (
          !booking.requestedFrom ||
          !booking.requestedTo ||
          !BOOKING_TIME_VALUE.test(booking.requestedFrom) ||
          !BOOKING_TIME_VALUE.test(booking.requestedTo)
        ) {
          return fail("conflict", { code: "needs_planning" });
        }
        const date = toDateOnly(booking.requestedDate);
        const requestedDate = parseDateOnly(date);
        if (!requestedDate) {
          return fail("conflict", { code: "needs_planning" });
        }
        const requested = requestedWindow({
          requestedDate,
          requestedFrom: booking.requestedFrom,
          requestedTo: booking.requestedTo,
        });
        if (requested.endsAt.getTime() <= requested.startsAt.getTime()) {
          return fail("invalid", { code: "invalid_time" });
        }
        window = {
          date: requestedDate,
          dateOnly: date,
          from: booking.requestedFrom,
          to: booking.requestedTo,
          ...requested,
        };
      }

      const candidates = requestedTechnicianId
        ? await tx.user.findMany({
            where: {
              id: requestedTechnicianId,
              ...staffForDepartment(booking.workOrder.departmentId),
            },
            select: { id: true, name: true },
            take: 1,
          })
        : await listAvailableTechniciansForWindow(tx, {
            departmentId: booking.workOrder.departmentId,
            date: window.dateOnly,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            excludeVisitId: booking.visitId ?? undefined,
            leadHours: 0,
          });
      const technician = candidates[0];
      if (!technician) return fail("conflict", { code: "no_technician" });

      await lockTechnicians(tx, [technician.id]);
      const available = await assertTechnicianSlotAvailable(tx, {
        departmentId: booking.workOrder.departmentId,
        technicianId: technician.id,
        date: window.dateOnly,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        excludeVisitId: booking.visitId ?? undefined,
        leadHours: 0,
        // Overlapp er en opptatt-markering, ikke en hard sperre. Kontoret kan
        // bevisst bekrefte to oppdrag på samme tid; fravær og arbeidstid
        // håndheves fortsatt.
        allowVisitOverlap: true,
      });
      if (!available.ok) {
        return fail("conflict", { code: "technician_unavailable" });
      }

      let visitId = booking.visitId;
      if (!visitId) {
        // Eldre PENDING-forespørsler ble laget før `visitId` ble koblet på
        // bestillingen. Har oppdraget nøyaktig én aktiv visitt, gjenbruker vi
        // den i stedet for å legge til en duplikat.
        const existingVisits = await tx.visit.findMany({
          where: { workOrderId: booking.workOrder.id },
          select: { id: true, status: true },
          orderBy: { sequence: "asc" },
          take: 2,
        });
        const reusable = existingVisits[0];
        if (
          existingVisits.length === 1 &&
          reusable &&
          !["EN_ROUTE", "ON_SITE", "DONE", "CANCELLED"].includes(
            reusable.status,
          )
        ) {
          visitId = reusable.id;
        }
      }
      if (visitId) {
        await tx.visit.update({
          where: { id: visitId },
          data: {
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            allDay: false,
            status: "PLANNED",
          },
        });
        await tx.visitTechnician.deleteMany({ where: { visitId } });
        await tx.visitTechnician.create({
          data: { visitId, userId: technician.id },
        });
      } else {
        const visit = await tx.visit.create({
          data: {
            workOrderId: booking.workOrder.id,
            sequence: 0,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            allDay: false,
            status: "PLANNED",
            technicians: { create: { userId: technician.id } },
          },
          select: { id: true },
        });
        visitId = visit.id;
      }

      await tx.bookingRequest.update({
        where: { id: booking.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          visitId,
          preferredTechnicianId: technician.id,
          preferredTechnicianName: technician.name,
        },
      });
      await tx.workOrder.updateMany({
        where: {
          id: booking.workOrder.id,
          status: { notIn: statusKeysByCategory("CLOSED") },
        },
        data: { status: "PLANNED" },
      });
      await recomputeWorkOrderSchedule(tx, booking.workOrder.id);
      await tx.bookingRequestEvent.create({
        data: {
          bookingRequestId: booking.id,
          type: "CONFIRMED",
          requestedDate: window.date,
          requestedFrom: window.from,
          requestedTo: window.to,
          message: technician.name,
          actorName: actor.name || actor.email || "Kontoret",
        },
      });
      await audit(tx, {
        entityType: "BookingRequest",
        entityId: booking.id,
        action: "Kontoret bekreftet bookingen",
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: booking.workOrder.id,
          reference: booking.reference,
          technicianId: technician.id,
          technicianName: technician.name,
          plannedDate: window.dateOnly,
          plannedFrom: window.from,
          plannedTo: window.to,
        },
      });

      await trySendBookingConfirmedSms(
        actor,
        booking.workOrder.id,
        {
          reference: booking.reference,
          date: window.dateOnly,
          time: `${window.from}–${window.to}`,
          technicianName: technician.name ?? "",
        },
        tx,
      );

      return ok({
        reference: booking.reference,
        technicianName: technician.name,
        already: false,
      });
    });

    if (result.ok && !result.data.already) {
      const booking = await prisma.bookingRequest.findUnique({
        where: { id: bookingId },
        select: {
          workOrderId: true,
          reference: true,
          customerId: true,
          requestedDate: true,
          requestedFrom: true,
          requestedTo: true,
          customer: { select: { name: true } },
          workOrder: {
            select: { title: true, contactId: true },
          },
        },
      });
      if (booking) {
        await notifyWorkOrderEvent(
          booking.workOrderId,
          "BOOKING",
          "Booking bekreftet av kontoret",
          `Bestilling ${result.data.reference} er bekreftet hos ${result.data.technicianName || "montør"}.`,
          `/oppdrag/${booking.workOrderId}`,
          `booking-confirm:${bookingId}`,
        ).catch((error) => {
          console.error("Kunne ikke varsle om bekreftet booking:", error);
        });

        await enqueueBookingEmail({
          event: "bookingConfirmed",
          bookingId,
          customerId: booking.customerId,
          contactId: booking.workOrder.contactId,
          title: booking.workOrder.title,
          customerName: booking.customer?.name,
          reference: booking.reference,
          date: booking.requestedDate,
          time:
            booking.requestedFrom && booking.requestedTo
              ? `${booking.requestedFrom}–${booking.requestedTo}`
              : null,
          technicianName: result.data.technicianName,
        });
      }
    }
    return result;
  } catch (error) {
    console.error("Databasefeil ved bekreftelse av booking:", error);
    return fail("error");
  }
}

/** Kontoret avlyser en booking. Visitten frigjøres når den ikke er i gang. */
export async function cancelBookingFromOffice(
  actor: ServiceActor,
  input: { bookingId: unknown },
): Promise<ServiceResult<{ reference: string }>> {
  if (!can(actor, "workorders.edit")) return fail("forbidden");
  const bookingId =
    typeof input.bookingId === "string" ? input.bookingId.trim().slice(0, 64) : "";
  if (!bookingId) return fail("invalid");

  try {
    const result = await runSerializable(async (tx) => {
      const booking = await tx.bookingRequest.findFirst({
        where: {
          id: bookingId,
          workOrder: { AND: [workOrderScopeFor(actor)] },
        },
        select: {
          id: true,
          reference: true,
          status: true,
          visitId: true,
          workOrder: {
            select: {
              id: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!booking || booking.workOrder.deletedAt) return fail("not_found");
      if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
        return ok({ reference: booking.reference });
      }

      await tx.bookingRequest.update({
        where: { id: booking.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      const cancellable = ["OPEN", "PENDING", "PLANNED", "WAITING"].includes(
        booking.workOrder.status,
      );
      if (cancellable) {
        await tx.workOrder.update({
          where: { id: booking.workOrder.id },
          data: { status: "CANCELLED" },
        });
        if (booking.visitId) {
          await tx.visit.updateMany({
            where: {
              id: booking.visitId,
              status: { in: ["PLANNED", "ASSIGNED"] },
            },
            data: { status: "CANCELLED" },
          });
        }
        await recomputeWorkOrderSchedule(tx, booking.workOrder.id);
      }
      await tx.bookingRequestEvent.create({
        data: {
          bookingRequestId: booking.id,
          type: "CANCELLED",
          actorName: actor.name || actor.email || "Kontoret",
        },
      });
      await audit(tx, {
        entityType: "BookingRequest",
        entityId: booking.id,
        action: "Kontoret avlyste bookingen",
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: booking.workOrder.id,
          reference: booking.reference,
        },
      });
      return ok({ reference: booking.reference });
    });

    if (result.ok) {
      const booking = await prisma.bookingRequest.findUnique({
        where: { id: bookingId },
        select: {
          workOrderId: true,
          reference: true,
          customerId: true,
          requestedDate: true,
          requestedFrom: true,
          requestedTo: true,
          customer: { select: { name: true } },
          workOrder: {
            select: { title: true, contactId: true },
          },
        },
      });
      if (booking) {
        await notifyWorkOrderEvent(
          booking.workOrderId,
          "BOOKING",
          "Booking avlyst av kontoret",
          `Bestilling ${result.data.reference} er avlyst.`,
          `/oppdrag/${booking.workOrderId}`,
          `booking-office-cancel:${bookingId}`,
        ).catch((error) => {
          console.error("Kunne ikke varsle om avlyst booking:", error);
        });

        await enqueueBookingEmail({
          event: "bookingCancelled",
          bookingId,
          customerId: booking.customerId,
          contactId: booking.workOrder.contactId,
          title: booking.workOrder.title,
          customerName: booking.customer?.name,
          reference: booking.reference,
          date: booking.requestedDate,
          time:
            booking.requestedFrom && booking.requestedTo
              ? `${booking.requestedFrom}–${booking.requestedTo}`
              : null,
        });
      }
    }
    return result;
  } catch (error) {
    console.error("Databasefeil ved avlysning av booking:", error);
    return fail("error");
  }
}
