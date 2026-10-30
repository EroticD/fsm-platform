// i18n-ignore-file: kontorkøen lagrer revisjonstekster som data; alle
// UI-strenger oversettes i siden og komponentene.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { staffForDepartment } from "@/lib/access";
import { toDateOnly } from "@/lib/dates";
import { requestedWindow } from "@/lib/booking-time";
import { notifyWorkOrderEvent } from "./notifications";
import { trySendBookingConfirmedSms } from "./sms-events";
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
  for (const booking of bookings) {
    let availableTechnicians: BookingQueueTechnician[] = [];
    if (booking.status === "PENDING") {
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
      availableTechnicians,
    });
  }

  return ok({ items, total, page, totalPages });
}

/**
 * Bekrefter en ventende forespørsel mot en ledig montør. Timen kontrolleres
 * på nytt under lås, slik at to saksbehandlere ikke kan bekrefte samme
 * montør og tid samtidig.
 */
export async function confirmBooking(
  actor: ServiceActor,
  input: { bookingId: unknown; technicianId?: unknown },
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

      const window = requestedWindow({
        requestedDate: booking.requestedDate,
        requestedFrom: booking.requestedFrom,
        requestedTo: booking.requestedTo,
      });
      const date = toDateOnly(booking.requestedDate);
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
            date,
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
        date,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        excludeVisitId: booking.visitId ?? undefined,
        leadHours: 0,
      });
      if (!available.ok) return fail("conflict");

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
          status: { in: ["OPEN", "PENDING"] },
        },
        data: { status: "PLANNED" },
      });
      await recomputeWorkOrderSchedule(tx, booking.workOrder.id);
      await tx.bookingRequestEvent.create({
        data: {
          bookingRequestId: booking.id,
          type: "CONFIRMED",
          requestedDate: booking.requestedDate,
          requestedFrom: booking.requestedFrom,
          requestedTo: booking.requestedTo,
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
        },
      });

      await trySendBookingConfirmedSms(
        actor,
        booking.workOrder.id,
        {
          reference: booking.reference,
          date: toDateOnly(booking.requestedDate),
          time: `${booking.requestedFrom}–${booking.requestedTo}`,
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
        select: { workOrderId: true },
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
        select: { workOrderId: true },
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
      }
    }
    return result;
  } catch (error) {
    console.error("Databasefeil ved avlysning av booking:", error);
    return fail("error");
  }
}
