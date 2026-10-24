import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { toDateOnly } from "@/lib/dates";
import { notifyUser } from "./notifications";
import {
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

const PAGE_SIZE = 20;

function idFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
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
    reports: { some: {} },
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
          orderBy: { completedAt: "desc" },
          take: 1,
          select: {
            id: true,
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

  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      customerId: true,
      reports: {
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
