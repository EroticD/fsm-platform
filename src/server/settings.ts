import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { isSafeLogoUrl } from "@/lib/logo";
import { LIMITS, cleanColor, cleanStatus, cleanText, cleanUrl } from "@/lib/sanitize";
import {
  can,
  fail,
  isAdminActor,
  ok,
  staffScopeFor,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Fanene i innstillinger som krever en administrasjonsrettighet. */
export function canUseSettings(actor: ServiceActor): boolean {
  return (
    isAdminActor(actor) ||
    can(actor, "settings.manage") ||
    can(actor, "users.view") ||
    can(actor, "templates.manage") ||
    can(actor, "documents.manage") ||
    can(actor, "audit.view") ||
    can(actor, "reports.view")
  );
}

/**
 * Merkevare, maler, tags, avdelinger og roller for innstillingssiden.
 * Avdelinger og roller vises bare til administrator, som før.
 */
export async function getSettingsOverview(actor: ServiceActor) {
  if (!canUseSettings(actor)) return fail("forbidden");

  const isAdmin = isAdminActor(actor);
  const [branding, templates, tags, documentTags] = await Promise.all([
    prisma.branding.findFirst(),
    prisma.template.findMany({ orderBy: { title: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.documentTag.findMany({ orderBy: { name: "asc" } }),
  ]);

  const departments = isAdmin
    ? await prisma.department.findMany({
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        include: {
          _count: { select: { users: true, workOrders: true, contracts: true } },
        },
      })
    : [];
  const departmentRows = departments.map((department) => ({
    id: department.id,
    name: department.name,
    description: department.description,
    phone: department.phone,
    email: department.email,
    address: department.address,
    city: department.city,
    postalCode: department.postalCode,
    isActive: department.isActive,
    isDefault: department.isDefault,
    users: department._count.users,
    workOrders: department._count.workOrders,
    contracts: department._count.contracts,
  }));

  const roles = isAdmin
    ? await prisma.role.findMany({
        orderBy: [{ isSystem: "desc" }, { label: "asc" }],
        include: { _count: { select: { users: true } } },
      })
    : [];
  const roleRows = roles.map((role) => ({
    key: role.key,
    label: role.label,
    description: role.description,
    permissions: role.permissions,
    isSystem: role.isSystem,
    users: role._count.users,
  }));

  return ok({ branding, templates, tags, documentTags, departmentRows, roleRows });
}

export type SettingsOverviewResult = Awaited<
  ReturnType<typeof getSettingsOverview>
>;
export type SettingsOverviewData = Extract<
  SettingsOverviewResult,
  { ok: true }
>["data"];

export type AuditLogParams = {
  search: string;
  dateFrom: string;
  dateTo: string;
  page: number;
};

/** Aktivitetsloggen er bare for brukere med `audit.view`. */
export async function getAuditLogPage(
  actor: ServiceActor,
  params: AuditLogParams,
) {
  if (!can(actor, "audit.view")) return fail("forbidden");

  const pageSize = 50;
  const page = Math.max(1, params.page);
  const where: Prisma.AuditLogWhereInput = {};

  const searchQuery = params.search.trim();
  if (searchQuery) {
    where.OR = [
      { action: { contains: searchQuery, mode: "insensitive" } },
      { userName: { contains: searchQuery, mode: "insensitive" } },
      { entityType: { contains: searchQuery, mode: "insensitive" } },
    ];
  }

  if (params.dateFrom) {
    where.createdAt = { gte: new Date(params.dateFrom) };
  }
  if (params.dateTo) {
    where.createdAt = {
      ...(typeof where.createdAt === "object" && where.createdAt !== null
        ? where.createdAt
        : {}),
      lte: new Date(`${params.dateTo}T23:59:59`),
    };
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return ok({ logs, total, page, pageSize });
}

export type StatisticsParams = {
  dateFrom: string;
  dateTo: string;
  status: string;
  customer: string;
  technician: string;
};

/**
 * Oppdragsstatistikk, alltid avdelingssperret. Tallene regnes ut i databasen
 * med count/groupBy i stedet for å laste alle oppdragene.
 */
export async function getStatistics(
  actor: ServiceActor,
  params: StatisticsParams,
) {
  if (!can(actor, "reports.view")) return fail("forbidden");

  const statusFilter = cleanStatus(params.status);
  const customerFilter = params.customer;
  const technicianFilter = params.technician;

  const statsWhere: Prisma.WorkOrderWhereInput = {
    ...workOrderScopeFor(actor),
  };
  if (params.dateFrom) {
    statsWhere.scheduledFor = { gte: new Date(params.dateFrom) };
  }
  if (params.dateTo) {
    statsWhere.scheduledFor = {
      ...(typeof statsWhere.scheduledFor === "object" &&
      statsWhere.scheduledFor !== null &&
      !(statsWhere.scheduledFor instanceof Date)
        ? statsWhere.scheduledFor
        : {}),
      lte: new Date(`${params.dateTo}T23:59:59`),
    };
  }
  if (statusFilter) statsWhere.status = statusFilter as WorkStatus;
  if (customerFilter) statsWhere.customerId = customerFilter;
  if (technicianFilter) {
    statsWhere.technicians = { some: { id: technicianFilter } };
  }

  // Kunder og montører for filteret. Begge listene er små og avgrensede.
  const [statsCustomers, statsTechnicians, totalWorkOrders, statusGroups, customerCounts] =
    await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        take: 50,
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: staffScopeFor(actor),
        orderBy: { name: "asc" },
        take: 200,
        select: {
          id: true,
          name: true,
          _count: { select: { workOrders: { where: statsWhere } } },
        },
      }),
      prisma.workOrder.count({ where: statsWhere }),
      prisma.workOrder.groupBy({
        by: ["status"],
        where: statsWhere,
        _count: { _all: true },
      }),
      prisma.customer.findMany({
        where: { deletedAt: null, workOrder: { some: statsWhere } },
        orderBy: { name: "asc" },
        take: 100,
        select: {
          id: true,
          name: true,
          _count: { select: { workOrder: { where: statsWhere } } },
        },
      }),
    ]);

  const byStatus = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  ) as Record<string, number>;

  const byTechnician: Record<string, number> = {};
  for (const technician of statsTechnicians) {
    const count = technician._count.workOrders;
    if (count > 0) byTechnician[technician.name || "Ukjent"] = count;
  }

  const byCustomer: Record<string, number> = {};
  for (const customer of customerCounts) {
    const count = customer._count.workOrder;
    if (count > 0) byCustomer[customer.name || "Uten kunde"] = count;
  }

  // Månedlig trend: seks avgrensede count-spørringer i stedet for å hente alle
  // oppdragene. Datofilteret fra skjemaet gjelder også for trenden.
  const trendAnchor = params.dateTo
    ? new Date(`${params.dateTo}T23:59:59`)
    : new Date();
  const trendMonths = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(
      trendAnchor.getFullYear(),
      trendAnchor.getMonth() - 5 + index,
      1,
    );
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    return { start, end, key };
  });
  const trendCounts = await Promise.all(
    trendMonths.map(({ start, end }) =>
      prisma.workOrder.count({
        where: { AND: [statsWhere, { scheduledFor: { gte: start, lt: end } }] },
      }),
    ),
  );
  const monthlyTrend: Record<string, number> = {};
  trendMonths.forEach(({ key }, index) => {
    monthlyTrend[key] = trendCounts[index];
  });

  return ok({
    statsCustomers,
    statsTechnicians,
    totalWorkOrders,
    byStatus,
    byTechnician,
    byCustomer,
    monthlyTrend,
  });
}

// ---------------------------------------------------------------------------
// Merkevare
// ---------------------------------------------------------------------------

export type BrandingInput = {
  companyName?: unknown;
  primaryColor?: unknown;
  logoUrl?: unknown;
};

export async function saveBranding(
  actor: ServiceActor,
  input: BrandingInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "settings.manage")) return fail("forbidden");

  const companyName = cleanText(input.companyName, {
    maxLength: LIMITS.title,
  });
  const primaryColor = cleanColor(input.primaryColor) || "#2563eb";
  const logoUrl = cleanUrl(input.logoUrl);

  // Bare logoer som er lastet opp gjennom appen. Eksterne URL-er kan peke på
  // interne tjenere og er en SSRF-risiko i PDF- og e-postgenerering.
  if (logoUrl && !isSafeLogoUrl(logoUrl)) return fail("invalid_logo");

  const existing = await prisma.branding.findFirst();

  const branding = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.branding.update({
          where: { id: existing.id },
          data: { companyName, primaryColor, logoUrl: logoUrl || null },
        })
      : await tx.branding.create({
          data: { companyName, primaryColor, logoUrl: logoUrl || null },
        });

    await audit(tx, {
      entityType: "Branding",
      entityId: saved.id,
      action: `Oppdaterte merkevareinnstillinger: ${companyName}`,
      actor: toAuditActor(actor),
    });

    return saved;
  });

  return ok({ id: branding.id });
}

// ---------------------------------------------------------------------------
// Sjekklistemaler
// ---------------------------------------------------------------------------

export async function createTemplate(
  actor: ServiceActor,
  input: { title?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "templates.manage")) return fail("forbidden");

  const title = cleanText(input.title, { maxLength: LIMITS.title });
  if (!title) return fail("invalid");

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.template.create({
      data: { title, fieldsJson: "[]" },
    });
    await audit(tx, {
      entityType: "Template",
      entityId: created.id,
      action: `Opprettet sjekkliste: ${title}`,
      actor: toAuditActor(actor),
    });
    return created;
  });

  return ok({ id: template.id });
}

export async function deleteTemplate(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.template.delete({ where: { id } });
    await audit(tx, {
      entityType: "Template",
      entityId: id,
      action: `Slettet sjekkliste: ${template.title}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Oppdrags-tags
// ---------------------------------------------------------------------------

export async function createTag(
  actor: ServiceActor,
  input: { name?: unknown; color?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "templates.manage")) return fail("forbidden");

  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const color = cleanColor(input.color) || "#3b82f6";
  if (!name) return fail("invalid");

  const tag = await prisma.$transaction(async (tx) => {
    const created = await tx.tag.create({ data: { name, color } });
    await audit(tx, {
      entityType: "Tag",
      entityId: created.id,
      action: `Opprettet tag: ${name}`,
      actor: toAuditActor(actor),
    });
    return created;
  });
  return ok({ id: tag.id });
}

export async function updateTag(
  actor: ServiceActor,
  input: { id?: unknown; name?: unknown; color?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "templates.manage")) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const color = cleanColor(input.color) || "#3b82f6";
  if (!id || !name) return fail("invalid");

  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.tag.update({ where: { id }, data: { name, color } });
    await audit(tx, {
      entityType: "Tag",
      entityId: id,
      action: `Oppdaterte tag: ${existing.name} -> ${name}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

export async function deleteTag(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.tag.delete({ where: { id } });
    await audit(tx, {
      entityType: "Tag",
      entityId: id,
      action: `Slettet tag: ${tag.name}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Dokument-tags
// ---------------------------------------------------------------------------

export async function createDocumentTag(
  actor: ServiceActor,
  input: { name?: unknown; color?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const color = cleanColor(input.color) || "#3b82f6";
  if (!name) return fail("invalid");

  const tag = await prisma.$transaction(async (tx) => {
    const created = await tx.documentTag.create({ data: { name, color } });
    await audit(tx, {
      entityType: "DocumentTag",
      entityId: created.id,
      action: `Opprettet dokument-tag: ${name}`,
      actor: toAuditActor(actor),
    });
    return created;
  });
  return ok({ id: tag.id });
}

export async function updateDocumentTag(
  actor: ServiceActor,
  input: { id?: unknown; name?: unknown; color?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const color = cleanColor(input.color) || "#3b82f6";
  if (!id || !name) return fail("invalid");

  const existing = await prisma.documentTag.findUnique({ where: { id } });
  if (!existing) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.documentTag.update({ where: { id }, data: { name, color } });
    await audit(tx, {
      entityType: "DocumentTag",
      entityId: id,
      action: `Oppdaterte dokument-tag: ${existing.name} -> ${name}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

export async function deleteDocumentTag(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const tag = await prisma.documentTag.findUnique({ where: { id } });
  if (!tag) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.documentTag.delete({ where: { id } });
    await audit(tx, {
      entityType: "DocumentTag",
      entityId: id,
      action: `Slettet dokument-tag: ${tag.name}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}
