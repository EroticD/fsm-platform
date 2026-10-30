// i18n-ignore-file: kundeportalens varsler og revisjonshandlinger lagres som
// data. Varselmaler lokaliseres i Phase 5B (C-23).
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDateOnly, toDateOnly, todayInOslo } from "@/lib/dates";
import { getDefaultDepartmentId } from "@/lib/departments";
import { addressHash, geocodeAddress } from "@/lib/geocode";
import { staffForDepartment } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { neutralizeUrls } from "@/lib/neutralize-urls";
import {
  LIMITS,
  cleanMarkdown,
  cleanPhone,
  cleanText,
} from "@/lib/sanitize";
import { AVAILABILITY_SLOT_MINUTES } from "@/lib/availability";
import {
  bookingDisplayStatus,
  canCustomerCancelBooking,
  canCustomerRescheduleBooking,
} from "@/lib/booking-status";
import {
  BOOKING_TIME_VALUE,
  bookingChangeDeadline as bookingChangeDeadlineAt,
  requestedWindow as requestedWindowAt,
} from "@/lib/booking-time";
import {
  assertTechnicianSlotAvailable,
  lockTechnicians,
  runSerializable,
} from "./availability";
import { notifyUser, notifyWorkOrderEvent } from "./notifications";
import { trySendBookingConfirmedSms } from "./sms-events";
import { createDefaultVisit, recomputeWorkOrderSchedule } from "./visits";
import {
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import {
  requirePortalCapability,
  resolvePortalAccess,
} from "./portal-access";

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
const BOOKING_MAX_DAYS_AHEAD = 60;
/** Bestillingshistorikken vises i sider, ikke som en stille hard grense. */
export const PORTAL_BOOKING_PAGE_SIZE = 20;
const TIME_VALUE = BOOKING_TIME_VALUE;

/**
 * Tjenestetypene kunden velger i slotvelgeren. De er bevisst korte, stabile
 * nøkler; visningsnavnet ligger i oversettelseskatalogene.
 */
export const BOOKING_SERVICE_TYPES = [
  "general",
  "maintenance",
  "repair",
  "inspection",
] as const;
export type BookingServiceType = (typeof BOOKING_SERVICE_TYPES)[number];

function isBookingServiceType(value: unknown): value is BookingServiceType {
  return (
    typeof value === "string" &&
    (BOOKING_SERVICE_TYPES as readonly string[]).includes(value)
  );
}

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
  return requestedWindowAt(schedule).startsAt;
}

/** Hele det ønskede tidsvinduet som absolutte Oslo-tidspunkter. */
function requestedWindow(schedule: BookingSchedule): {
  startsAt: Date;
  endsAt: Date;
} {
  return requestedWindowAt(schedule);
}

/** Fristen for å be om ny tid på bestillingen. */
export function bookingChangeDeadline(
  requestedDate: Date,
  requestedFrom: string,
): Date {
  return bookingChangeDeadlineAt(
    requestedDate,
    requestedFrom,
    BOOKING_CHANGE_CUTOFF_HOURS,
  );
}

/** Ønsket start må ligge minst `BOOKING_MIN_LEAD_HOURS` fram i tid. */
function hasMinimumLeadTime(schedule: BookingSchedule, now = new Date()): boolean {
  return (
    requestedStart(schedule).getTime() >=
    now.getTime() + BOOKING_MIN_LEAD_HOURS * 60 * 60_000
  );
}

/**
 * En ubekreftet forespørsel kan alltid kanselleres, uavhengig av
 * 24-timersvinduet. En bekreftet avtale kan også kanselleres, men selve
 * oppdraget avlyses bare når det ikke er i gang eller avsluttet.
 */
function canCancelBooking(status: string, workOrderStatus: string): boolean {
  return canCustomerCancelBooking(status, workOrderStatus);
}

/** Ny tid krever fortsatt at endringsfristen og ledetiden er holdt. */
function canRescheduleBooking(
  status: string,
  workOrderStatus: string,
  requestedDate: Date,
  requestedFrom: string,
  now = new Date(),
): boolean {
  return canCustomerRescheduleBooking(
    status,
    workOrderStatus,
    bookingChangeDeadline(requestedDate, requestedFrom),
    now,
  );
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
 *
 * To moduser støttes:
 * - Direkte bekreftelse: klienten har en `holdToken` (eller velger en montør)
 *   fra slotvelgeren. Timen kontrolleres på nytt, visitten opprettes med
 *   montøren og bestillingen lagres som CONFIRMED.
 * - Eldre forespørsel: ingen slot er valgt. Da lages en PENDING-forespørsel i
 *   kontorets kø, med samme oppførsel som før Phase 5A.
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
  technicianId?: unknown;
  holdToken?: unknown;
  siteId?: unknown;
  newSiteName?: unknown;
  newSiteAddress?: unknown;
  newSitePostalCode?: unknown;
  newSiteCity?: unknown;
  serviceType?: unknown;
  ip?: string;
};

export type CreateBookingResult = {
  id: string;
  reference: string;
  duplicate?: boolean;
  status: "CONFIRMED" | "PENDING";
  visitId?: string;
  technicianName?: string | null;
};

export async function createBooking(
  actor: ServiceActor,
  input: CreateBookingInput,
): Promise<ServiceResult<CreateBookingResult>> {
  const access = await requirePortalCapability(actor, "canBook");
  if (!access.ok) return access;

  const customerId = access.data.customerId;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      id: true,
      departmentId: true,
      name: true,
      address: true,
      postalCode: true,
      city: true,
    },
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

  const serviceType = isBookingServiceType(input.serviceType)
    ? input.serviceType
    : null;
  const holdToken = cleanText(input.holdToken, { maxLength: 200 });
  const technicianId = idFrom(input.technicianId ?? input.preferredTechnicianId);
  const confirmedBooking = Boolean(holdToken || technicianId);
  if (confirmedBooking && !technicianId) return fail("invalid");

  const window = requestedWindow(schedule.data);
  if (
    confirmedBooking &&
    window.endsAt.getTime() - window.startsAt.getTime() !==
      AVAILABILITY_SLOT_MINUTES * 60_000
  ) {
    return fail("invalid");
  }

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
  if (!departmentId) return fail("error");

  // Ønsket tekniker må være aktiv og jobbe i denne avdelingen.
  let preferredTechnicianName: string | null = null;
  if (technicianId) {
    const technician = await prisma.user.findFirst({
      where: {
        id: technicianId,
        ...staffForDepartment(departmentId),
      },
      select: { name: true },
    });
    if (!technician) return fail("invalid");
    preferredTechnicianName = technician.name ?? null;
  }

  const siteIdInput = idFrom(input.siteId);
  let siteSnapshot: {
    id: string | null;
    name: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
  } = {
    id: null,
    name: null,
    address: null,
    postalCode: null,
    city: null,
  };
  if (siteIdInput) {
    const site = await prisma.customerSite.findFirst({
      where: { id: siteIdInput, customerId },
      select: { id: true, name: true, address: true, postalCode: true, city: true },
    });
    if (!site) return fail("invalid");
    siteSnapshot = site;
  } else {
    const newSiteName = cleanText(input.newSiteName, {
      maxLength: LIMITS.title,
    });
    const newSiteAddress = cleanText(input.newSiteAddress, {
      maxLength: LIMITS.line,
    });
    const newSitePostalCode = cleanText(input.newSitePostalCode, {
      maxLength: LIMITS.short,
    });
    const newSiteCity = cleanText(input.newSiteCity, {
      maxLength: LIMITS.short,
    });
    if (newSiteName) {
      siteSnapshot = {
        id: null,
        name: newSiteName,
        address: newSiteAddress || null,
        postalCode: newSitePostalCode || null,
        city: newSiteCity || null,
      };
    } else if (newSiteAddress || newSitePostalCode || newSiteCity) {
      return fail("invalid");
    }
  }

  // Adressen som faktisk gjelder for bestillingen. Stedsvalget vinner over
  // kundens hovedadresse, og geokodingen bruker samme grunnlag som
  // oppdragstjenesten slik at kart og avledede felt blir konsistente.
  const bookingAddress = {
    address: siteSnapshot.address || customer.address || null,
    postalCode: siteSnapshot.postalCode || customer.postalCode || null,
    city: siteSnapshot.city || customer.city || null,
  };
  const addressQuery = [
    bookingAddress.address,
    bookingAddress.postalCode,
    bookingAddress.city,
  ]
    .filter(Boolean)
    .join(", ");
  const geoAddressHash = addressHash(addressQuery);
  const coordinates = geoAddressHash ? await geocodeAddress(addressQuery) : null;

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

  // Duplikatsjekk, åpen-grense og opprettelse må skje under samme lås. Ellers
  // kan to samtidige dobbeltklikk begge se «ingen duplikat» og begge opprette
  // et oppdrag, og åpen-grensen kan telles før den andre har skrevet.
  let outcome:
    | {
        kind: "created";
        id: string;
        reference: string;
        status: "CONFIRMED" | "PENDING";
        visitId?: string;
        technicianName?: string | null;
      }
    | {
        kind: "duplicate";
        id: string;
        reference: string;
        status: "CONFIRMED" | "PENDING";
      }
    | { kind: "conflict" }
    | { kind: "slot_unavailable" };
  try {
    outcome = await runSerializable(async (tx) => {
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
          bookingRequest: { select: { reference: true, status: true } },
        },
      });
      if (duplicate) {
        if (holdToken) {
          await tx.bookingHold.updateMany({
            where: { token: holdToken, customerId, consumedAt: null },
            data: { consumedAt: new Date() },
          });
        }
        return {
          kind: "duplicate",
          id: duplicate.id,
          reference:
            duplicate.bookingRequest?.reference ?? bookingReference(duplicate.id),
          status:
            duplicate.bookingRequest?.status === "CONFIRMED"
              ? "CONFIRMED"
              : "PENDING",
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

      if (confirmedBooking) {
        const hold = holdToken
          ? await tx.bookingHold.findFirst({
              where: {
                token: holdToken,
                customerId,
                consumedAt: null,
                expiresAt: { gt: new Date() },
              },
              select: {
                id: true,
                startsAt: true,
                endsAt: true,
                technicianId: true,
                siteId: true,
              },
            })
          : null;
        if (holdToken && !hold) {
          return { kind: "slot_unavailable" } as const;
        }
        if (
          hold &&
          (hold.technicianId !== technicianId ||
            hold.startsAt.getTime() !== window.startsAt.getTime() ||
            hold.endsAt.getTime() !== window.endsAt.getTime() ||
            (hold.siteId !== null &&
              siteSnapshot.id !== null &&
              hold.siteId !== siteSnapshot.id))
        ) {
          return { kind: "slot_unavailable" } as const;
        }

        // Låsen serialiserer alle bestillinger for samme montør. Sammen med
        // SERIALIZABLE og den nye tilgjengelighetskontrollen gir dette
        // nøyaktig én bekreftet bestilling per time.
        await lockTechnicians(tx, [technicianId]);
        const available = await assertTechnicianSlotAvailable(tx, {
          departmentId,
          technicianId,
          date: toDateOnly(schedule.data.requestedDate),
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          excludeHoldId: hold?.id,
        });
        if (!available.ok) {
          return {
            kind:
              available.reason === "not_found" ? "conflict" : "slot_unavailable",
          } as const;
        }

        // Krev reservasjonen før noe skrives. Da kan en tapt kappløp om
        // tokenet aldri etterlate et oppdrag uten booking.
        if (hold) {
          const consumed = await tx.bookingHold.updateMany({
            where: { id: hold.id, consumedAt: null },
            data: { consumedAt: new Date() },
          });
          if (consumed.count !== 1) {
            return { kind: "slot_unavailable" } as const;
          }
        }

        let bookingSiteId = siteSnapshot.id;
        if (!bookingSiteId && siteSnapshot.name) {
          const existingSites = await tx.customerSite.count({
            where: { customerId },
          });
          const site = await tx.customerSite.create({
            data: {
              customerId,
              name: siteSnapshot.name,
              address: siteSnapshot.address,
              postalCode: siteSnapshot.postalCode,
              city: siteSnapshot.city,
              isPrimary: existingSites === 0,
            },
            select: { id: true },
          });
          bookingSiteId = site.id;
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
            status: "PLANNED",
            siteId: bookingSiteId || undefined,
            address: bookingAddress.address || undefined,
            postalCode: bookingAddress.postalCode || undefined,
            city: bookingAddress.city || undefined,
            latitude: coordinates?.lat ?? null,
            longitude: coordinates?.lng ?? null,
            geoAddressHash,
            scheduledFor: schedule.data.requestedDate,
            scheduledTo: schedule.data.requestedDate,
            technicians: { connect: [] },
          },
          select: { id: true },
        });

        const visit = await tx.visit.create({
          data: {
            workOrderId: workOrder.id,
            sequence: 0,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            allDay: false,
            status: "PLANNED",
            technicians: { create: { userId: technicianId } },
          },
          select: { id: true },
        });
        await recomputeWorkOrderSchedule(tx, workOrder.id);

        const reference = bookingReference(workOrder.id);
        const booking = await tx.bookingRequest.create({
          data: {
            reference,
            workOrderId: workOrder.id,
            customerId,
            ...schedule.data,
            serviceType,
            siteId: bookingSiteId,
            visitId: visit.id,
            equipmentId: equipmentId || null,
            equipmentLabel,
            preferredTechnicianId: technicianId,
            preferredTechnicianName,
            contactName,
            contactPhone,
            status: "CONFIRMED",
            confirmedAt: new Date(),
          },
          select: { id: true, reference: true },
        });

        await tx.bookingRequestEvent.createMany({
          data: [
            {
              bookingRequestId: booking.id,
              type: "CREATED",
              requestedDate: schedule.data.requestedDate,
              requestedFrom: schedule.data.requestedFrom,
              requestedTo: schedule.data.requestedTo,
              actorName: contactName,
            },
            {
              bookingRequestId: booking.id,
              type: "CONFIRMED",
              requestedDate: schedule.data.requestedDate,
              requestedFrom: schedule.data.requestedFrom,
              requestedTo: schedule.data.requestedTo,
              message: preferredTechnicianName,
              actorName: actor.name || actor.email || "Kunde",
            },
          ],
        });

        await audit(tx, {
          entityType: "WorkOrder",
          entityId: workOrder.id,
          action: `Kunde booket bekreftet time: ${title}`,
          actor: toAuditActor(actor),
          metadata: {
            customerId,
            bookingRequestId: booking.id,
            reference: booking.reference,
            technicianId,
            startsAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
            serviceType,
            siteId: bookingSiteId,
          },
        });

        await trySendBookingConfirmedSms(
          actor,
          workOrder.id,
          {
            reference: booking.reference,
            date: toDateOnly(schedule.data.requestedDate),
            time: `${schedule.data.requestedFrom}–${schedule.data.requestedTo}`,
            technicianName: preferredTechnicianName ?? "",
          },
          tx,
        );

        return {
          kind: "created",
          id: workOrder.id,
          reference: booking.reference,
          status: "CONFIRMED",
          visitId: visit.id,
          technicianName: preferredTechnicianName,
        } as const;
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
          siteId: siteSnapshot.id || undefined,
          address: bookingAddress.address || undefined,
          postalCode: bookingAddress.postalCode || undefined,
          city: bookingAddress.city || undefined,
          latitude: coordinates?.lat ?? null,
          longitude: coordinates?.lng ?? null,
          geoAddressHash,
          scheduledFor: schedule.data.requestedDate,
          scheduledTo: schedule.data.requestedDate,
          technicians: { connect: [] },
        },
        select: { id: true },
      });

      // Bestillingen er en konkret tidsblokk i kundens ønskede vindu. Kontoret
      // kan senere flytte den på visit-nivå; `BookingRequest` beholder
      // fortsatt kundens opprinnelige ønske som snapshot.
      const defaultVisitId = await createDefaultVisit(tx, {
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
          serviceType,
          siteId: siteSnapshot.id,
          equipmentId: equipmentId || null,
          equipmentLabel,
          preferredTechnicianId: technicianId || null,
          preferredTechnicianName,
          contactName,
          contactPhone,
          visitId: defaultVisitId,
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
        status: "PENDING",
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
  if (outcome.kind === "slot_unavailable") return fail("conflict");
  if (outcome.kind === "duplicate") {
    return ok({
      id: outcome.id,
      reference: outcome.reference,
      duplicate: true,
      status: outcome.status,
    });
  }
  const created = {
    id: outcome.id,
    reference: outcome.reference,
    status: outcome.status,
    ...(outcome.visitId ? { visitId: outcome.visitId } : {}),
    ...(outcome.technicianName !== undefined
      ? { technicianName: outcome.technicianName }
      : {}),
  };

  // Varselet legges i køen (in-app + e-post sendes av jobbworkeren), slik at
  // treg SMTP ikke blokkerer bestillingen. Bare kontoret i destinasjons-
  // avdelingen varsles.
  try {
    const confirmed = created.status === "CONFIRMED";
    await notifyWorkOrderEvent(
      created.id,
      "BOOKING",
      confirmed
        ? "Ny bekreftet booking fra kundeportal"
        : "Ny bestilling fra kundeportal",
      confirmed
        ? `Kunden har booket «${neutralizeUrls(title)}» (${created.reference}) hos ${created.technicianName || "montør"}. Tid: ${toDateOnly(schedule.data.requestedDate)} kl. ${schedule.data.requestedFrom}–${schedule.data.requestedTo}.`
        : `Kunden har booket «${neutralizeUrls(title)}» (${created.reference}). Ønsket tid: ${toDateOnly(schedule.data.requestedDate)} kl. ${schedule.data.requestedFrom}–${schedule.data.requestedTo}.`,
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
  type: "CREATED" | "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "EXPIRED";
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
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
  displayStatus: "pending" | "confirmed" | "completed" | "cancelled" | "expired";
  requestedDate: string;
  requestedFrom: string;
  requestedTo: string;
  serviceType: string | null;
  siteName: string | null;
  equipmentLabel: string | null;
  preferredTechnicianName: string | null;
  contactName: string;
  contactPhone: string;
  createdAt: string;
  confirmedAt: string | null;
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
  const access = await resolvePortalAccess(actor);
  if (!access.ok) return access;

  const where = {
    customerId: access.data.customerId,
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
      serviceType: true,
      site: { select: { name: true } },
      equipmentLabel: true,
      preferredTechnicianName: true,
      contactName: true,
      contactPhone: true,
      createdAt: true,
      confirmedAt: true,
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
      serviceType: booking.serviceType,
      siteName: booking.site?.name ?? null,
      equipmentLabel: booking.equipmentLabel,
      preferredTechnicianName: booking.preferredTechnicianName,
      contactName: booking.contactName,
      contactPhone: booking.contactPhone,
      createdAt: booking.createdAt.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
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
  serviceType: string | null;
  siteId: string | null;
  visitId: string | null;
  visit: {
    id: string;
    status: string;
    technicians: Array<{ userId: string }>;
  } | null;
  workOrder: {
    id: string;
    title: string;
    status: string;
    customerId: string | null;
    departmentId: string;
    deletedAt: Date | null;
  };
};

async function ownBooking(
  actor: ServiceActor,
  bookingId: unknown,
): Promise<ServiceResult<BookingChangeRow>> {
  const access = await resolvePortalAccess(actor);
  if (!access.ok) return access;
  const id = idFrom(bookingId);
  if (!id) return fail("invalid");

  const booking = await prisma.bookingRequest.findFirst({
    where: {
      id,
      customerId: access.data.customerId,
      // Bestillingen kan henge igjen på et oppdrag som senere er flyttet til
      // en annen kunde. Den gamle kunden skal ikke kunne endre oppdraget.
      workOrder: { customerId: access.data.customerId },
    },
    select: {
      id: true,
      reference: true,
      customerId: true,
      status: true,
      requestedDate: true,
      requestedFrom: true,
      requestedTo: true,
      serviceType: true,
      siteId: true,
      visitId: true,
      visit: {
        select: {
          id: true,
          status: true,
          technicians: { select: { userId: true } },
        },
      },
      workOrder: {
        select: {
          id: true,
          title: true,
          status: true,
          customerId: true,
          departmentId: true,
          deletedAt: true,
        },
      },
    },
  });
  if (!booking) return fail("not_found");
  // Kontrollerer også raden vi faktisk fikk tilbake, slik at en fremmed
  // oppdragskunde aldri kan mutere saken selv om spørringen skulle være utdatert.
  if (booking.workOrder.customerId !== access.data.customerId) {
    return fail("not_found");
  }
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
  const access = await requirePortalCapability(actor, "canBook");
  if (!access.ok) return access;
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
          customerId: access.data.customerId,
          status: { in: ["PENDING", "CONFIRMED"] },
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
            customerId: access.data.customerId,
            status: { in: [...PORTAL_CANCELLABLE_WORK_ORDER_STATUSES] },
          },
          data: { status: "CANCELLED" },
        });
        workOrderCancelled = cancelledWorkOrder.count === 1;
      }

      // En bekreftet booking eier en konkret visitt. Når oppdraget avlyses,
      // frigjøres timen med en gang ved å kansellere visitten. En visitt som
      // alt er i gang eller fullført røres ikke.
      if (workOrderCancelled && booking.data.visitId) {
        await tx.visit.updateMany({
          where: {
            id: booking.data.visitId,
            status: { in: ["PLANNED", "ASSIGNED"] },
          },
          data: { status: "CANCELLED" },
        });
        await recomputeWorkOrderSchedule(tx, booking.data.workOrder.id);
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
          customerId: access.data.customerId,
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

/**
 * Kunden flytter en bestilling fram til endringsfristen.
 *
 * En bekreftet bestilling må velge en ny ledig time (samme slotvelger som ved
 * bestilling). En eldre PENDING-forespørsel kan fortsatt sende ønsket
 * tidsvindu uten reservasjon, slik at kontorkøen fungerer som før.
 */
export async function rescheduleBooking(
  actor: ServiceActor,
  input: {
    bookingId: unknown;
    requestedDate?: unknown;
    requestedFrom?: unknown;
    requestedTo?: unknown;
    technicianId?: unknown;
    preferredTechnicianId?: unknown;
    holdToken?: unknown;
    siteId?: unknown;
    serviceType?: unknown;
  },
): Promise<
  ServiceResult<{
    status: "rescheduled";
    reference: string;
    requestedDate: string;
    requestedFrom: string;
    requestedTo: string;
    technicianName?: string | null;
  }>
> {
  const access = await requirePortalCapability(actor, "canBook");
  if (!access.ok) return access;
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

  const technicianId = idFrom(input.technicianId ?? input.preferredTechnicianId);
  const holdToken = cleanText(input.holdToken, { maxLength: 200 });
  const confirmedChange = Boolean(holdToken || technicianId);
  if (booking.data.status === "CONFIRMED" && !confirmedChange) {
    return fail("invalid");
  }
  if (confirmedChange && !technicianId) return fail("invalid");

  const window = requestedWindow(schedule.data);
  if (
    confirmedChange &&
    window.endsAt.getTime() - window.startsAt.getTime() !==
      AVAILABILITY_SLOT_MINUTES * 60_000
  ) {
    return fail("invalid");
  }

  const serviceType = isBookingServiceType(input.serviceType)
    ? input.serviceType
    : booking.data.serviceType;
  const siteIdInput = idFrom(input.siteId);
  let siteId = booking.data.siteId;
  if (siteIdInput) {
    const site = await prisma.customerSite.findFirst({
      where: { id: siteIdInput, customerId: access.data.customerId },
      select: { id: true },
    });
    if (!site) return fail("invalid");
    siteId = site.id;
  }

  let preferredTechnicianName: string | null = null;
  if (technicianId) {
    const technician = await prisma.user.findFirst({
      where: {
        id: technicianId,
        ...staffForDepartment(booking.data.workOrder.departmentId),
      },
      select: { name: true },
    });
    if (!technician) return fail("invalid");
    preferredTechnicianName = technician.name ?? null;
  }

  const existingTechnicianIds =
    booking.data.visit?.technicians.map((technician) => technician.userId) ?? [];

  // Uendret tidsvindu (og samme montør) er ikke en endring. Da skal verken
  // historikk, varsel eller oppdragets plan røres.
  const unchanged =
    toDateOnly(booking.data.requestedDate) ===
      toDateOnly(schedule.data.requestedDate) &&
    booking.data.requestedFrom === schedule.data.requestedFrom &&
    booking.data.requestedTo === schedule.data.requestedTo &&
    (!confirmedChange ||
      (existingTechnicianIds.length === 1 &&
        existingTechnicianIds[0] === technicianId));
  if (unchanged) {
    return ok({
      status: "rescheduled",
      reference: booking.data.reference,
      requestedDate: toDateOnly(schedule.data.requestedDate),
      requestedFrom: schedule.data.requestedFrom,
      requestedTo: schedule.data.requestedTo,
      ...(preferredTechnicianName
        ? { technicianName: preferredTechnicianName }
        : {}),
    });
  }

  let outcome:
    | { kind: "moved"; technicianName?: string | null }
    | { kind: "slot_unavailable" }
    | { kind: "conflict" };
  try {
    if (confirmedChange) {
      outcome = await runSerializable(async (tx) => {
        await lockTechnicians(tx, [
          ...existingTechnicianIds,
          technicianId,
        ]);

        const hold = holdToken
          ? await tx.bookingHold.findFirst({
              where: {
                token: holdToken,
                customerId: access.data.customerId,
                consumedAt: null,
                expiresAt: { gt: new Date() },
              },
              select: {
                id: true,
                startsAt: true,
                endsAt: true,
                technicianId: true,
              },
            })
          : null;
        if (holdToken && !hold) return { kind: "slot_unavailable" } as const;
        if (
          hold &&
          (hold.technicianId !== technicianId ||
            hold.startsAt.getTime() !== window.startsAt.getTime() ||
            hold.endsAt.getTime() !== window.endsAt.getTime())
        ) {
          return { kind: "slot_unavailable" } as const;
        }

        const available = await assertTechnicianSlotAvailable(tx, {
          departmentId: booking.data.workOrder.departmentId,
          technicianId,
          date: toDateOnly(schedule.data.requestedDate),
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          excludeVisitId: booking.data.visitId ?? undefined,
          excludeHoldId: hold?.id,
        });
        if (!available.ok) {
          return {
            kind:
              available.reason === "not_found" ? "conflict" : "slot_unavailable",
          } as const;
        }

        if (hold) {
          const consumed = await tx.bookingHold.updateMany({
            where: { id: hold.id, consumedAt: null },
            data: { consumedAt: new Date() },
          });
          if (consumed.count !== 1) {
            return { kind: "slot_unavailable" } as const;
          }
        }

        await tx.bookingRequest.update({
          where: { id: booking.data.id },
          data: {
            ...schedule.data,
            serviceType,
            siteId,
            preferredTechnicianId: technicianId,
            preferredTechnicianName,
          },
        });

        if (booking.data.visitId) {
          await tx.visit.update({
            where: { id: booking.data.visitId },
            data: {
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              allDay: false,
              status: "PLANNED",
            },
          });
          await tx.visitTechnician.deleteMany({
            where: { visitId: booking.data.visitId },
          });
          await tx.visitTechnician.create({
            data: { visitId: booking.data.visitId, userId: technicianId },
          });
        } else {
          await tx.visit.create({
            data: {
              workOrderId: booking.data.workOrder.id,
              sequence: 0,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              allDay: false,
              status: "PLANNED",
              technicians: { create: { userId: technicianId } },
            },
          });
        }
        await recomputeWorkOrderSchedule(tx, booking.data.workOrder.id);
        await tx.workOrder.updateMany({
          where: {
            id: booking.data.workOrder.id,
            customerId: access.data.customerId,
            status: { in: ["OPEN", "PENDING"] },
          },
          data: { status: "PLANNED" },
        });

        await tx.bookingRequestEvent.create({
          data: {
            bookingRequestId: booking.data.id,
            type: "RESCHEDULED",
            requestedDate: schedule.data.requestedDate,
            requestedFrom: schedule.data.requestedFrom,
            requestedTo: schedule.data.requestedTo,
            message: preferredTechnicianName,
            actorName: actor.name || actor.email || "Kunde",
          },
        });

        await audit(tx, {
          entityType: "BookingRequest",
          entityId: booking.data.id,
          action: "Kunden flyttet den bekreftede bestillingen",
          actor: toAuditActor(actor),
          metadata: {
            customerId: access.data.customerId,
            workOrderId: booking.data.workOrder.id,
            reference: booking.data.reference,
            requestedDate: toDateOnly(schedule.data.requestedDate),
            requestedFrom: schedule.data.requestedFrom,
            requestedTo: schedule.data.requestedTo,
            technicianId,
          },
        });

        if (booking.data.status === "CONFIRMED") {
          await trySendBookingConfirmedSms(
            actor,
            booking.data.workOrder.id,
            {
              reference: booking.data.reference,
              date: toDateOnly(schedule.data.requestedDate),
              time: `${schedule.data.requestedFrom}–${schedule.data.requestedTo}`,
              technicianName: preferredTechnicianName ?? "",
            },
            tx,
          );
        }

        return { kind: "moved", technicianName: preferredTechnicianName } as const;
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.bookingRequest.update({
          where: { id: booking.data.id },
          data: { ...schedule.data, serviceType, siteId },
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
            customerId: access.data.customerId,
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
            take: 50,
          });

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
            customerId: access.data.customerId,
            workOrderId: booking.data.workOrder.id,
            reference: booking.data.reference,
            requestedDate: toDateOnly(schedule.data.requestedDate),
            requestedFrom: schedule.data.requestedFrom,
            requestedTo: schedule.data.requestedTo,
          },
        });
      });
      outcome = { kind: "moved" };
    }
  } catch (error) {
    console.error("Databasefeil ved ny-tid-forespørsel:", error);
    return fail("error");
  }

  if (outcome.kind === "slot_unavailable") return fail("conflict");
  if (outcome.kind === "conflict") return fail("conflict");

  try {
    await notifyWorkOrderEvent(
      booking.data.workOrder.id,
      "BOOKING",
      confirmedChange ? "Kunde flyttet bekreftet booking" : "Kunde ba om ny tid",
      confirmedChange
        ? `Bestilling ${booking.data.reference} er flyttet til ${toDateOnly(schedule.data.requestedDate)} kl. ${schedule.data.requestedFrom}–${schedule.data.requestedTo} hos ${preferredTechnicianName || "montør"}.`
        : `Bestilling ${booking.data.reference}: ønsket ny tid ${toDateOnly(schedule.data.requestedDate)} kl. ${schedule.data.requestedFrom}–${schedule.data.requestedTo}.`,
      `/oppdrag/${booking.data.workOrder.id}`,
      `booking-reschedule:${booking.data.id}:${toDateOnly(schedule.data.requestedDate)}:${schedule.data.requestedFrom}:${schedule.data.requestedTo}${technicianId ? `:${technicianId}` : ""}`,
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
    ...(preferredTechnicianName
      ? { technicianName: preferredTechnicianName }
      : {}),
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
  const access = await requirePortalCapability(actor, "canViewDocuments");
  if (!access.ok) return access;

  const page = Math.max(1, options.page ?? 1);
  // Alle avsluttede oppdrag, også de uten rapport, slik at kundeportalen har
  // én samlet historikk i stedet for to nesten like lister.
  const where = {
    customerId: access.data.customerId,
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
  const access = await resolvePortalAccess(actor);
  if (!access.ok) return access;

  const customer = await prisma.customer.findFirst({
    where: { id: access.data.customerId, deletedAt: null },
    select: { id: true, name: true, departmentId: true },
  });
  if (!customer) return fail("not_found");

  const contactId = idFrom(input.contactId);
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, customerId: access.data.customerId },
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
  const access = await requirePortalCapability(actor, "canViewDocuments");
  if (!access.ok) return access;

  const workOrderId = idFrom(input.workOrderId);
  if (!workOrderId) return fail("invalid");

  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      customerId: access.data.customerId,
      deletedAt: null,
    },
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

  if (!workOrder || workOrder.customerId !== access.data.customerId) {
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
