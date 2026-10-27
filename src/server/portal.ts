import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { toDateOnly } from "@/lib/dates";
import { getDefaultDepartmentId } from "@/lib/departments";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { notifyUser, notifyWorkOrderEvent } from "./notifications";
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

function idFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

/**
 * Kunden bestiller et nytt oppdrag.
 *
 * Autorisasjonen er serverstyrt: kunden kan bare bestille til sin egen
 * `customerId`, uansett hva klienten sender. Bestillingen rate-limites både
 * per kunde og per IP, og like bestillinger innenfor ti minutter slås sammen
 * slik at dobbeltklikk ikke gir flere oppdrag eller e-poster.
 */
export async function createBooking(
  actor: ServiceActor,
  input: { title: string; description: string; ip?: string },
): Promise<ServiceResult<{ id: string; duplicate?: boolean }>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const customerId = actor.customerId;
  const title = cleanText(input.title, { maxLength: LIMITS.title });
  if (!title) return fail("missing_fields");
  const description = cleanMarkdown(input.description);

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

  // Samme tittel og beskrivelse like etter forrige bestilling er nesten
  // alltid et dobbeltklikk. Da returneres den eksisterende saken uten ny
  // varsling eller e-post.
  const duplicate = await prisma.workOrder.findFirst({
    where: {
      customerId,
      title,
      description,
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - BOOKING_DUPLICATE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (duplicate) return ok({ id: duplicate.id, duplicate: true });

  const openBookings = await prisma.workOrder.count({
    where: { customerId, status: "OPEN", deletedAt: null },
  });
  if (openBookings >= BOOKING_OPEN_LIMIT) return fail("conflict");

  // Kundebestillinger havner i standardavdelingen, som før. Finnes ingen
  // aktiv avdeling, kan bestillingen ikke opprettes.
  const departmentId = await getDefaultDepartmentId();
  if (!departmentId) return fail("error");

  let createdId: string;
  try {
    createdId = await prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: {
          title,
          description: description || "",
          departmentId,
          customerId,
          contactId: actor.contactId || undefined,
          creatorName: actor.name || actor.email || "Kunde",
          status: "OPEN",
          technicians: { connect: [] },
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: created.id,
        action: `Kunde booket nytt oppdrag: ${title}`,
        actor: toAuditActor(actor),
        metadata: { customerId },
      });

      return created.id;
    });
  } catch (error) {
    // Transaksjonen ruller tilbake både oppdraget og revisjonsloggen.
    console.error("Databasefeil ved booking av oppdrag:", error);
    return fail("error");
  }

  // Varselet legges i køen (in-app + e-post sendes av jobbworkeren), slik at
  // treg SMTP ikke blokkerer bestillingen. Bare kontoret i destinasjons-
  // avdelingen varsles.
  try {
    await notifyWorkOrderEvent(
      createdId,
      "BOOKING",
      "Ny bestilling fra kundeportal",
      `Kunden har booket «${title}».`,
      `/oppdrag/${createdId}`,
      `booking:${createdId}`,
    );
  } catch (error) {
    console.error("Kunne ikke legge bestillingsvarsel i køen:", error);
  }

  return ok({ id: createdId });
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
  const where = {
    customerId: actor.customerId,
    deletedAt: null,
    reports: { some: { deletedAt: null } },
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
        scheduledFor: true,
        reports: {
          where: { deletedAt: null },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: {
            id: true,
            name: true,
            completedAt: true,
            isLocked: true,
            pdfUrl: true,
            customerAcknowledgedAt: true,
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

  const customer = await prisma.customer.findUnique({
    where: { id: actor.customerId },
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
        message ||
        `Kunden ${customer.name} ber om oppdatering av kontaktinformasjon.`,
      href: `/kunder/${customer.id}`,
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
        where: { deletedAt: null },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: {
          id: true,
          customerAcknowledgedAt: true,
        },
      },
    },
  });

  if (!workOrder || workOrder.customerId !== actor.customerId) {
    return fail("not_found");
  }

  const requestedReportId = idFrom(input.reportId);
  const report =
    (requestedReportId
      ? workOrder.reports.find((row) => row.id === requestedReportId)
      : workOrder.reports[0]) ?? null;
  if (!report) return fail("not_found");
  if (report.customerAcknowledgedAt) return ok(undefined);

  const comment =
    typeof input.comment === "string"
      ? input.comment.trim().slice(0, 2000) || null
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: report.id },
      data: {
        customerAcknowledgedAt: new Date(),
        customerAcknowledgedBy: actor.name || actor.email || "Kunde",
        customerAcknowledgedComment: comment,
      },
    });

    await audit(tx, {
      entityType: "Report",
      entityId: report.id,
      action: "Kunden kvitterte for rapporten",
      actor: toAuditActor(actor),
      metadata: { workOrderId },
    });
  });

  return ok(undefined);
}
