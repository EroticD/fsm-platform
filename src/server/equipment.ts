// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger
// som vises via `src/lib/audit-actions.ts`. Nye enhetshandlinger er bevisst
// holdt utenfor UI-katalogene fordi de er historiske data, ikke UI-tekst.
import crypto from "node:crypto";
import type { EquipmentCategory, Prisma } from "@prisma/client";
import { EquipmentStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  addDaysUtc,
  formatDate,
  parseDateOnly,
  toDateOnly,
  todayUtc,
} from "@/lib/dates";
import { reportWorkOrderScope } from "@/lib/report-scope";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  equipmentCategoryCreateSchema,
  equipmentCategoryUpdateSchema,
  equipmentCreateSchema,
  equipmentUpdateSchema,
  meterReadingCreateSchema,
} from "@/lib/schemas/equipment";
import { notifyUser } from "@/server/notifications";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "./actor";

export const EQUIPMENT_PAGE_SIZE = 20;
export const EQUIPMENT_MAX_PAGE_SIZE = 100;
export const EQUIPMENT_TREE_LIMIT = 500;
export const EQUIPMENT_TIMELINE_LIMIT = 40;

const MAX_HIERARCHY_DEPTH = 128;
const QR_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export const EQUIPMENT_ERROR_CODES = {
  invalidInput: "equipment.errors.invalidInput",
  invalidStatus: "equipment.errors.invalidStatus",
  invalidCriticality: "equipment.errors.invalidCriticality",
  invalidDate: "equipment.errors.invalidDate",
  invalidCategory: "equipment.errors.invalidCategory",
  invalidParent: "equipment.errors.invalidParent",
  customerMismatch: "equipment.errors.customerMismatch",
  hierarchyCycle: "equipment.errors.hierarchyCycle",
  categoryCycle: "equipment.errors.categoryCycle",
  categoryInUse: "equipment.errors.categoryInUse",
  childrenInUse: "equipment.errors.childrenInUse",
  equipmentInUse: "equipment.errors.equipmentInUse",
  retired: "equipment.errors.retired",
  invalidReading: "equipment.errors.invalidReading",
  qrMissing: "equipment.errors.qrMissing",
} as const;

export type EquipmentListParams = {
  q?: string;
  status?: string;
  categoryId?: string;
  customerId?: string;
  parentId?: string | null;
  rootsOnly?: boolean;
  page?: number;
  limit?: number;
};

export type EquipmentTimelineKind =
  | "report"
  | "workOrder"
  | "meter"
  | "document";

export type EquipmentTimelineItem = {
  id: string;
  kind: EquipmentTimelineKind;
  at: Date;
  title: string;
  description: string | null;
  href: string | null;
};

function requirePermission(
  actor: ServiceActor,
  permission: "equipment.view" | "equipment.manage",
): ServiceFailure | null {
  if (!actor?.isActive || !can(actor, permission)) return fail("forbidden");
  return null;
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

export function equipmentScopeFor(
  actor: ServiceActor,
): Prisma.ProductWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (actor.role === "CUSTOMER") {
    return actor.customerId
      ? { customerId: actor.customerId, customer: { deletedAt: null } }
      : { id: { in: [] } };
  }
  return { customer: { deletedAt: null } };
}

function pageLimit(value?: number): number {
  return Math.min(
    EQUIPMENT_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(value ?? EQUIPMENT_PAGE_SIZE)),
  );
}

function statusColumn(status: string): EquipmentStatus {
  return (Object.values(EquipmentStatus) as string[]).includes(status)
    ? (status as EquipmentStatus)
    : "ACTIVE";
}

function isEquipmentStatus(value: unknown): value is EquipmentStatus {
  return (Object.values(EquipmentStatus) as string[]).includes(
    String(value),
  );
}

/** Alle etterkommere av en kategori, slik at filteret også tar med undertrær. */
async function categoryDescendants(categoryId: string): Promise<string[]> {
  const categories = await prisma.equipmentCategory.findMany({
    take: 500,
    select: { id: true, parentId: true },
  });
  const result = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (
        category.parentId &&
        result.has(category.parentId) &&
        !result.has(category.id)
      ) {
        result.add(category.id);
        changed = true;
      }
    }
  }
  return [...result];
}

/** En avgrenset, sortert liste over utstyr med søk og filtre. */
export async function listEquipment(
  actor: ServiceActor,
  params: EquipmentListParams = {},
) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = pageLimit(params.limit);
  const query = cleanText(params.q, { maxLength: LIMITS.short });
  const customerId = cleanId(params.customerId);
  const categoryId = cleanId(params.categoryId);
  const parentId =
    params.parentId === null ? null : cleanId(params.parentId);

  const and: Prisma.ProductWhereInput[] = [equipmentScopeFor(actor)];
  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    and.push({
      OR: [
        { model: contains },
        { serialNumber: contains },
        { location: contains },
        { customer: { name: contains } },
      ],
    });
  }
  if (params.status && params.status !== "ALL") {
    if (!isEquipmentStatus(params.status)) {
      return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidStatus });
    }
    and.push({ status: params.status });
  }
  if (customerId) and.push({ customerId });
  if (categoryId) {
    and.push({ categoryId: { in: await categoryDescendants(categoryId) } });
  }
  if (params.rootsOnly || params.parentId === null) and.push({ parentId: null });
  else if (parentId) and.push({ parentId });

  const where: Prisma.ProductWhereInput = { AND: and };
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ model: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customer: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        parent: { select: { id: true, model: true } },
        _count: {
          select: {
            children: true,
            meterReadings: true,
            maintenancePlans: true,
            reportUnits: true,
            workOrder: true,
          },
        },
      },
    }),
  ]);

  return ok({
    items,
    total,
    page,
    pageSize: limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  });
}

export type EquipmentListData = Extract<
  Awaited<ReturnType<typeof listEquipment>>,
  { ok: true }
>["data"];

/**
 * Hele treet i én spørring. Listesiden bruker denne når «hierarki» er slått på,
 * og detaljsiden bruker den til å bygge en foreldresti. Selve visningen er
 * begrenset til 500 enheter, som er langt over hva en normal kunde har.
 */
export async function listEquipmentForest(actor: ServiceActor) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const items = await prisma.product.findMany({
    where: equipmentScopeFor(actor),
    orderBy: [{ model: "asc" }, { id: "asc" }],
    take: EQUIPMENT_TREE_LIMIT,
    include: {
      customer: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      _count: { select: { children: true } },
    },
  });

  return ok({ items, truncated: items.length === EQUIPMENT_TREE_LIMIT });
}

export type EquipmentForestItem = Extract<
  Awaited<ReturnType<typeof listEquipmentForest>>,
  { ok: true }
>["data"]["items"][number];

export type EquipmentForestData = Extract<
  Awaited<ReturnType<typeof listEquipmentForest>>,
  { ok: true }
>["data"];

export type EquipmentTreeNode = EquipmentForestItem & {
  children: EquipmentTreeNode[];
};

export function buildEquipmentTree(
  items: readonly EquipmentForestItem[],
): EquipmentTreeNode[] {
  const nodes = new Map<string, EquipmentTreeNode>();
  for (const item of items) nodes.set(item.id, { ...item, children: [] });

  const roots: EquipmentTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export type EquipmentCategoryNode = EquipmentCategory & {
  productCount: number;
  children: EquipmentCategoryNode[];
};

/** Kategoritreet med antall enheter per node (inkludert undertrær). */
export function buildCategoryTree(
  categories: ReadonlyArray<EquipmentCategory & { productCount: number }>,
): EquipmentCategoryNode[] {
  const nodes = new Map<string, EquipmentCategoryNode>();
  for (const category of categories) {
    nodes.set(category.id, { ...category, children: [] });
  }
  const roots: EquipmentCategoryNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sum = (node: EquipmentCategoryNode): number => {
    node.productCount += node.children.reduce(
      (total, child) => total + sum(child),
      0,
    );
    return node.productCount;
  };
  for (const root of roots) sum(root);
  return roots;
}

export async function listEquipmentCategories(actor: ServiceActor) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const categories = await prisma.equipmentCategory.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
    include: { _count: { select: { products: true } } },
  });

  const flat = categories.map((category) => ({
    ...category,
    productCount: category._count.products,
  }));
  return ok({ categories: flat, tree: buildCategoryTree(flat) });
}

export async function getEquipment(actor: ServiceActor, equipmentId: string) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const id = cleanId(equipmentId);
  if (!id) return fail("not_found");

  const canViewReports = can(actor, "reports.view");
  const reportUnitWhere: Prisma.ReportUnitWhereInput = canViewReports
    ? {
        report: {
          deletedAt: null,
          workOrder: {
            ...reportWorkOrderScope(actor),
            ...(actor.role === "TECHNICIAN"
              ? { status: { not: "CANCELLED" as const } }
              : {}),
          },
        },
      }
    : { id: { in: [] } };

  const equipment = await prisma.product.findFirst({
    where: { id, ...equipmentScopeFor(actor) },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          departmentId: true,
        },
      },
      category: { select: { id: true, name: true, parentId: true } },
      parent: { select: { id: true, model: true, serialNumber: true } },
      children: {
        orderBy: [{ model: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          model: true,
          serialNumber: true,
          location: true,
          status: true,
          criticality: true,
          _count: { select: { children: true, meterReadings: true } },
        },
      },
      meterReadings: {
        orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
        take: 24,
        select: {
          id: true,
          value: true,
          readAt: true,
          source: true,
          note: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
      },
      maintenancePlans: {
        orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
        take: 50,
        include: {
          occurrences: {
            orderBy: { dueDate: "desc" },
            take: 5,
            select: {
              id: true,
              dueDate: true,
              status: true,
              workOrderId: true,
              meterValue: true,
            },
          },
        },
      },
      reportUnits: {
        where: reportUnitWhere,
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          report: {
            select: {
              id: true,
              createdAt: true,
              workOrderId: true,
              template: { select: { title: true } },
              workOrder: {
                select: {
                  id: true,
                  title: true,
                  scheduledFor: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      workOrder: {
        where: { AND: [workOrderScopeFor(actor)] },
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          title: true,
          status: true,
          scheduledFor: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          children: true,
          meterReadings: true,
          maintenancePlans: true,
          reportUnits: { where: reportUnitWhere },
          workOrder: true,
        },
      },
    },
  });
  if (!equipment) return fail("not_found");

  const uploads = await prisma.upload.findMany({
    where: { ownerType: "EQUIPMENT", ownerId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      storedName: true,
      createdAt: true,
    },
  });

  // Foreldrestien bygges fra rot til gjeldende enhet, med et hardt tak mot
  // korrupte data. En syklus ville ellers kunne henge siden.
  const ancestors: Array<{ id: string; model: string }> = [];
  let cursor: { id: string; model: string } | null = equipment.parent;
  let depth = 0;
  while (cursor && depth < MAX_HIERARCHY_DEPTH) {
    ancestors.unshift({ id: cursor.id, model: cursor.model });
    const row = await prisma.product.findFirst({
      where: { id: cursor.id },
      select: {
        id: true,
        model: true,
        parent: { select: { id: true, model: true } },
      },
    });
    cursor = row?.parent ?? null;
    depth += 1;
  }

  return ok({
    equipment,
    uploads,
    ancestors,
    canViewReports,
  });
}

export type EquipmentDetailData = Extract<
  Awaited<ReturnType<typeof getEquipment>>,
  { ok: true }
>["data"];

/**
 * En samlet tidslinje for enheten: rapporter, oppdrag, målinger og dokumenter.
 * Hver kilde er begrenset, og den sammenslåtte listen kappes til 40 rader.
 */
export async function getEquipmentHistory(
  actor: ServiceActor,
  equipmentId: string,
): Promise<ServiceResult<EquipmentTimelineItem[]>> {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const id = cleanId(equipmentId);
  if (!id) return fail("not_found");

  const equipment = await prisma.product.findFirst({
    where: { id, ...equipmentScopeFor(actor) },
    select: { id: true, meterUnit: true },
  });
  if (!equipment) return fail("not_found");

  const canViewReports = can(actor, "reports.view");
  const reportUnitWhere: Prisma.ReportUnitWhereInput = canViewReports
    ? {
        report: {
          deletedAt: null,
          workOrder: {
            ...reportWorkOrderScope(actor),
            ...(actor.role === "TECHNICIAN"
              ? { status: { not: "CANCELLED" as const } }
              : {}),
          },
        },
      }
    : { id: { in: [] } };

  const [reports, workOrders, meters, uploads] = await Promise.all([
    prisma.reportUnit.findMany({
      where: { productId: id, ...reportUnitWhere },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        status: true,
        report: {
          select: {
            id: true,
            workOrderId: true,
            template: { select: { title: true } },
            workOrder: {
              select: { id: true, title: true, scheduledFor: true },
            },
          },
        },
      },
    }),
    prisma.workOrder.findMany({
      where: { productId: id, AND: [workOrderScopeFor(actor)] },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        scheduledFor: true,
        createdAt: true,
      },
    }),
    prisma.meterReading.findMany({
      where: { productId: id },
      orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, value: true, readAt: true, source: true, note: true },
    }),
    prisma.upload.findMany({
      where: { ownerType: "EQUIPMENT", ownerId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        originalName: true,
        storedName: true,
        createdAt: true,
      },
    }),
  ]);

  const items: EquipmentTimelineItem[] = [];
  for (const unit of reports) {
    items.push({
      id: `report:${unit.id}`,
      kind: "report",
      at: unit.createdAt,
      title:
        unit.report.template?.title ||
        unit.report.workOrder.title ||
        "Servicerapport",
      description: unit.report.workOrder.scheduledFor
        ? formatDate(unit.report.workOrder.scheduledFor)
        : null,
      href: `/rapporter/${unit.report.workOrderId}`,
    });
  }
  for (const order of workOrders) {
    items.push({
      id: `workOrder:${order.id}`,
      kind: "workOrder",
      at: order.scheduledFor ?? order.createdAt,
      title: order.title,
      description: order.status,
      href: `/oppdrag/${order.id}`,
    });
  }
  for (const reading of meters) {
    items.push({
      id: `meter:${reading.id}`,
      kind: "meter",
      at: reading.readAt,
      title: `${reading.value.toString()}${equipment.meterUnit ? ` ${equipment.meterUnit}` : ""}`,
      description: reading.note,
      href: null,
    });
  }
  for (const upload of uploads) {
    items.push({
      id: `document:${upload.id}`,
      kind: "document",
      at: upload.createdAt,
      title: upload.originalName,
      description: null,
      href: `/uploads/${upload.storedName}`,
    });
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return ok(items.slice(0, EQUIPMENT_TIMELINE_LIMIT));
}

async function validateCategoryReference(
  tx: Prisma.TransactionClient,
  categoryId: string | null,
): Promise<ServiceFailure | null> {
  if (!categoryId) return null;
  const category = await tx.equipmentCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  return category
    ? null
    : fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidCategory });
}

async function validateParentReference(
  tx: Prisma.TransactionClient,
  customerId: string,
  parentId: string | null,
  productId?: string,
): Promise<ServiceFailure | null> {
  if (!parentId) return null;
  const parent = await tx.product.findFirst({
    where: { id: parentId, customer: { deletedAt: null } },
    select: { id: true, customerId: true },
  });
  if (!parent) {
    return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidParent });
  }
  if (parent.customerId !== customerId) {
    return fail("conflict", { code: EQUIPMENT_ERROR_CODES.customerMismatch });
  }

  // Vandre oppover fra den nye forelderen. Møter vi enheten selv, er flyttingen
  // en syklus. Den samme sjekken brukes av kategoritreet.
  let cursor: string | null = parent.id;
  let depth = 0;
  while (cursor && depth < MAX_HIERARCHY_DEPTH) {
    if (productId && cursor === productId) {
      return fail("conflict", { code: EQUIPMENT_ERROR_CODES.hierarchyCycle });
    }
    const row: { parentId: string | null } | null = await tx.product.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
    depth += 1;
  }
  if (cursor) {
    return fail("conflict", { code: EQUIPMENT_ERROR_CODES.hierarchyCycle });
  }
  return null;
}

function generateQrToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export type EquipmentCreateInput = {
  customerId?: unknown;
  model?: unknown;
  serialNumber?: unknown;
  location?: unknown;
  categoryId?: unknown;
  parentId?: unknown;
  installDate?: unknown;
  warrantyUntil?: unknown;
  status?: unknown;
  criticality?: unknown;
  meterUnit?: unknown;
};

export async function createEquipment(
  actor: ServiceActor,
  input: EquipmentCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const parsed = equipmentCreateSchema.safeParse({
    customerId: cleanId(input.customerId),
    model: cleanText(input.model, { maxLength: LIMITS.title }),
    serialNumber: cleanText(input.serialNumber, { maxLength: LIMITS.line }),
    location: cleanText(input.location, { maxLength: LIMITS.line }),
    categoryId: cleanId(input.categoryId),
    parentId: cleanId(input.parentId),
    installDate: cleanText(input.installDate, { maxLength: 10 }),
    warrantyUntil: cleanText(input.warrantyUntil, { maxLength: 10 }),
    status: cleanText(input.status, { maxLength: 20 }) || "ACTIVE",
    criticality: input.criticality ?? 2,
    meterUnit: cleanText(input.meterUnit, { maxLength: 20 }),
  });
  if (!parsed.success) {
    return fail("invalid", {
      code: EQUIPMENT_ERROR_CODES.invalidInput,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }

  const data = parsed.data;
  const installDate = data.installDate ? parseDateOnly(data.installDate) : null;
  const warrantyUntil = data.warrantyUntil
    ? parseDateOnly(data.warrantyUntil)
    : null;
  if (
    (data.installDate && !installDate) ||
    (data.warrantyUntil && !warrantyUntil) ||
    (installDate && warrantyUntil && warrantyUntil < installDate)
  ) {
    return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidDate });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) return fail("not_found");

      const categoryFailure = await validateCategoryReference(
        tx,
        data.categoryId ?? null,
      );
      if (categoryFailure) return categoryFailure;

      const parentFailure = await validateParentReference(
        tx,
        data.customerId,
        data.parentId ?? null,
      );
      if (parentFailure) return parentFailure;

      const created = await tx.product.create({
        data: {
          customerId: data.customerId,
          model: data.model,
          serialNumber: data.serialNumber || null,
          location: data.location || null,
          categoryId: data.categoryId ?? null,
          parentId: data.parentId ?? null,
          installDate,
          warrantyUntil,
          status: data.status,
          criticality: data.criticality,
          meterUnit: data.meterUnit || null,
          qrToken: generateQrToken(),
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "Product",
        entityId: created.id,
        action: `Opprettet utstyr: ${data.model}${data.serialNumber ? ` (SN: ${data.serialNumber})` : ""}`,
        actor: toAuditActor(actor),
        metadata: { customerId: data.customerId, parentId: data.parentId ?? null },
      });

      return ok({ id: created.id });
    });
  } catch (error) {
    console.error("Feil ved opprettelse av utstyr:", error);
    return fail("error");
  }
}

export type EquipmentUpdateInput = {
  id?: unknown;
  model?: unknown;
  serialNumber?: unknown;
  location?: unknown;
  categoryId?: unknown;
  parentId?: unknown;
  installDate?: unknown;
  warrantyUntil?: unknown;
  status?: unknown;
  criticality?: unknown;
  meterUnit?: unknown;
};

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export async function updateEquipment(
  actor: ServiceActor,
  input: EquipmentUpdateInput,
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const id = cleanId(input.id);
  if (!id) return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });

  const parsed = equipmentUpdateSchema.safeParse({
    id,
    model: hasOwn(input, "model")
      ? cleanText(input.model, { maxLength: LIMITS.title })
      : undefined,
    serialNumber: hasOwn(input, "serialNumber")
      ? cleanText(input.serialNumber, { maxLength: LIMITS.line })
      : undefined,
    location: hasOwn(input, "location")
      ? cleanText(input.location, { maxLength: LIMITS.line })
      : undefined,
    categoryId: hasOwn(input, "categoryId")
      ? cleanId(input.categoryId)
      : undefined,
    parentId: hasOwn(input, "parentId") ? cleanId(input.parentId) : undefined,
    installDate: hasOwn(input, "installDate")
      ? cleanText(input.installDate, { maxLength: 10 })
      : undefined,
    warrantyUntil: hasOwn(input, "warrantyUntil")
      ? cleanText(input.warrantyUntil, { maxLength: 10 })
      : undefined,
    status: hasOwn(input, "status")
      ? cleanText(input.status, { maxLength: 20 })
      : undefined,
    criticality: hasOwn(input, "criticality") ? input.criticality : undefined,
    meterUnit: hasOwn(input, "meterUnit")
      ? cleanText(input.meterUnit, { maxLength: 20 })
      : undefined,
  });
  if (!parsed.success) {
    return fail("invalid", {
      code: EQUIPMENT_ERROR_CODES.invalidInput,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  const data = parsed.data;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirst({
        where: { id, ...equipmentScopeFor(actor) },
        select: {
          id: true,
          model: true,
          customerId: true,
          parentId: true,
          categoryId: true,
          installDate: true,
          warrantyUntil: true,
          status: true,
          criticality: true,
          meterUnit: true,
          serialNumber: true,
          location: true,
        },
      });
      if (!current) return fail("not_found");

      const update: Prisma.ProductUpdateInput = {};
      if (data.model !== undefined) update.model = data.model;
      if (data.serialNumber !== undefined)
        update.serialNumber = data.serialNumber || null;
      if (data.location !== undefined) update.location = data.location || null;
      if (data.meterUnit !== undefined)
        update.meterUnit = data.meterUnit || null;
      if (data.status !== undefined) {
        if (!isEquipmentStatus(data.status)) {
          return fail("invalid", {
            code: EQUIPMENT_ERROR_CODES.invalidStatus,
          });
        }
        update.status = data.status;
      }
      if (data.criticality !== undefined) {
        update.criticality = data.criticality;
      }

      const installDate =
        data.installDate === undefined
          ? current.installDate
          : data.installDate
            ? parseDateOnly(data.installDate)
            : null;
      const warrantyUntil =
        data.warrantyUntil === undefined
          ? current.warrantyUntil
          : data.warrantyUntil
            ? parseDateOnly(data.warrantyUntil)
            : null;
      if (
        (data.installDate && !installDate) ||
        (data.warrantyUntil && !warrantyUntil) ||
        (installDate && warrantyUntil && warrantyUntil < installDate)
      ) {
        return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidDate });
      }
      if (data.installDate !== undefined) update.installDate = installDate;
      if (data.warrantyUntil !== undefined) update.warrantyUntil = warrantyUntil;

      if (data.categoryId !== undefined) {
        const categoryId = data.categoryId || null;
        const categoryFailure = await validateCategoryReference(tx, categoryId);
        if (categoryFailure) return categoryFailure;
        update.category = categoryId
          ? { connect: { id: categoryId } }
          : { disconnect: true };
      }

      if (data.parentId !== undefined) {
        const parentId = data.parentId || null;
        const parentFailure = await validateParentReference(
          tx,
          current.customerId,
          parentId,
          id,
        );
        if (parentFailure) return parentFailure;
        update.parent = parentId
          ? { connect: { id: parentId } }
          : { disconnect: true };
      }

      await tx.product.update({ where: { id }, data: update });
      await audit(tx, {
        entityType: "Product",
        entityId: id,
        action: `Oppdaterte utstyr: ${data.model ?? current.model}`,
        actor: toAuditActor(actor),
        metadata: { fields: Object.keys(data).filter((key) => key !== "id") },
      });
      return ok({ id });
    });
  } catch (error) {
    console.error("Feil ved oppdatering av utstyr:", error);
    return fail("error");
  }
}

/** Flytter en enhet i hierarkiet. Egen funksjon fordi den har egne feilkoder. */
export async function moveEquipment(
  actor: ServiceActor,
  equipmentId: string,
  parentId: string | null,
): Promise<ServiceResult<{ id: string }>> {
  return updateEquipment(actor, { id: equipmentId, parentId });
}

export async function deleteEquipment(
  actor: ServiceActor,
  equipmentId: string,
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanId(equipmentId);
  if (!id) return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });

  try {
    return await prisma.$transaction(async (tx) => {
      const equipment = await tx.product.findFirst({
        where: { id, ...equipmentScopeFor(actor) },
        select: {
          id: true,
          model: true,
          _count: {
            select: {
              children: true,
              workOrder: true,
              reportUnits: true,
              maintenancePlans: true,
            },
          },
        },
      });
      if (!equipment) return fail("not_found");

      const documents = await tx.upload.count({
        where: { ownerType: "EQUIPMENT", ownerId: id },
      });

      if (equipment._count.children > 0) {
        return fail("in_use", {
          code: EQUIPMENT_ERROR_CODES.childrenInUse,
          children: equipment._count.children,
        });
      }
      if (
        equipment._count.workOrder > 0 ||
        equipment._count.reportUnits > 0 ||
        equipment._count.maintenancePlans > 0 ||
        documents > 0
      ) {
        return fail("in_use", {
          code: EQUIPMENT_ERROR_CODES.equipmentInUse,
          workOrders: equipment._count.workOrder,
          reports: equipment._count.reportUnits,
          plans: equipment._count.maintenancePlans,
          documents,
        });
      }

      await tx.product.delete({ where: { id } });
      await audit(tx, {
        entityType: "Product",
        entityId: id,
        action: `Slettet utstyr: ${equipment.model}`,
        actor: toAuditActor(actor),
      });
      return ok(undefined);
    });
  } catch (error) {
    console.error("Feil ved sletting av utstyr:", error);
    return fail("error");
  }
}

export async function createEquipmentCategory(
  actor: ServiceActor,
  input: { name?: unknown; parentId?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const parsed = equipmentCategoryCreateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.short }),
    parentId: cleanId(input.parentId),
  });
  if (!parsed.success) {
    return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (parsed.data.parentId) {
        const parent = await tx.equipmentCategory.findUnique({
          where: { id: parsed.data.parentId },
          select: { id: true },
        });
        if (!parent) {
          return fail("invalid", {
            code: EQUIPMENT_ERROR_CODES.invalidCategory,
          });
        }
      }
      const created = await tx.equipmentCategory.create({
        data: {
          name: parsed.data.name,
          parentId: parsed.data.parentId ?? null,
        },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "EquipmentCategory",
        entityId: created.id,
        action: `Opprettet utstyrskategori: ${parsed.data.name}`,
        actor: toAuditActor(actor),
      });
      return ok({ id: created.id });
    });
  } catch (error) {
    console.error("Feil ved opprettelse av utstyrskategori:", error);
    return fail("error");
  }
}

async function categoryHasCycle(
  tx: Prisma.TransactionClient,
  categoryId: string,
  parentId: string | null,
): Promise<boolean> {
  let cursor = parentId;
  let depth = 0;
  while (cursor && depth < MAX_HIERARCHY_DEPTH) {
    if (cursor === categoryId) return true;
    const row = await tx.equipmentCategory.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
    depth += 1;
  }
  return cursor !== null;
}

export async function updateEquipmentCategory(
  actor: ServiceActor,
  input: { id?: unknown; name?: unknown; parentId?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const parsed = equipmentCategoryUpdateSchema.safeParse({
    id: cleanId(input.id),
    name: cleanText(input.name, { maxLength: LIMITS.short }),
    parentId: hasOwn(input, "parentId") ? cleanId(input.parentId) : undefined,
  });
  if (!parsed.success) {
    return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.equipmentCategory.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, name: true },
      });
      if (!current) return fail("not_found");

      const parentId = parsed.data.parentId ?? null;
      if (parentId) {
        const parent = await tx.equipmentCategory.findUnique({
          where: { id: parentId },
          select: { id: true },
        });
        if (!parent) {
          return fail("invalid", {
            code: EQUIPMENT_ERROR_CODES.invalidCategory,
          });
        }
        if (await categoryHasCycle(tx, current.id, parentId)) {
          return fail("conflict", {
            code: EQUIPMENT_ERROR_CODES.categoryCycle,
          });
        }
      }

      await tx.equipmentCategory.update({
        where: { id: current.id },
        data: { name: parsed.data.name, parentId },
      });
      await audit(tx, {
        entityType: "EquipmentCategory",
        entityId: current.id,
        action: `Oppdaterte utstyrskategori: ${parsed.data.name}`,
        actor: toAuditActor(actor),
      });
      return ok({ id: current.id });
    });
  } catch (error) {
    console.error("Feil ved oppdatering av utstyrskategori:", error);
    return fail("error");
  }
}

export async function deleteEquipmentCategory(
  actor: ServiceActor,
  categoryId: string,
): Promise<ServiceResult> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const id = cleanId(categoryId);
  if (!id) return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });

  try {
    return await prisma.$transaction(async (tx) => {
      const category = await tx.equipmentCategory.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          _count: { select: { children: true, products: true } },
        },
      });
      if (!category) return fail("not_found");
      if (category._count.children > 0 || category._count.products > 0) {
        return fail("in_use", {
          code: EQUIPMENT_ERROR_CODES.categoryInUse,
          children: category._count.children,
          products: category._count.products,
        });
      }
      await tx.equipmentCategory.delete({ where: { id } });
      await audit(tx, {
        entityType: "EquipmentCategory",
        entityId: id,
        action: `Slettet utstyrskategori: ${category.name}`,
        actor: toAuditActor(actor),
      });
      return ok(undefined);
    });
  } catch (error) {
    console.error("Feil ved sletting av utstyrskategori:", error);
    return fail("error");
  }
}

/** Ny QR-token. Den gamle etiketten slutter å virke umiddelbart. */
export async function rotateEquipmentQrToken(
  actor: ServiceActor,
  equipmentId: string,
): Promise<ServiceResult<{ qrToken: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const id = cleanId(equipmentId);
  if (!id) return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });

  try {
    return await prisma.$transaction(async (tx) => {
      const equipment = await tx.product.findFirst({
        where: { id, ...equipmentScopeFor(actor) },
        select: { id: true, qrToken: true },
      });
      if (!equipment) return fail("not_found");

      const qrToken = generateQrToken();
      await tx.product.update({
        where: { id },
        data: { qrToken },
      });
      await audit(tx, {
        entityType: "Product",
        entityId: id,
        action: `Rotasjon av QR-etikett${equipment.qrToken ? " (gammel etikett sperret)" : ""}`,
        actor: toAuditActor(actor),
      });
      return ok({ qrToken });
    });
  } catch (error) {
    console.error("Feil ved rotasjon av QR-token:", error);
    return fail("error");
  }
}

/** Sørger for at en enhet har en QR-token uten å rotere en eksisterende. */
export async function issueEquipmentQrToken(
  actor: ServiceActor,
  equipmentId: string,
): Promise<ServiceResult<{ qrToken: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const id = cleanId(equipmentId);
  if (!id) return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });

  return prisma.$transaction(async (tx) => {
    const equipment = await tx.product.findFirst({
      where: { id, ...equipmentScopeFor(actor) },
      select: { id: true, qrToken: true },
    });
    if (!equipment) return fail("not_found");
    if (equipment.qrToken) return ok({ qrToken: equipment.qrToken });

    const qrToken = generateQrToken();
    await tx.product.update({ where: { id }, data: { qrToken } });
    await audit(tx, {
      entityType: "Product",
      entityId: id,
      action: "Utstedte QR-etikett",
      actor: toAuditActor(actor),
    });
    return ok({ qrToken });
  });
}

/**
 * Offentlig QR-oppslag. Selve siden krever innlogging, men etiketten må kunne
 * slås opp uten å røpe om en tilfeldig token finnes. Roterte tokens gir null.
 */
export async function resolveEquipmentQrToken(
  token: string,
): Promise<{ id: string; model: string } | null> {
  const value = cleanText(token, { maxLength: 64 });
  if (!QR_TOKEN.test(value)) return null;
  return prisma.product.findFirst({
    where: { qrToken: value, customer: { deletedAt: null } },
    select: { id: true, model: true },
  });
}

export async function listMeterReadings(
  actor: ServiceActor,
  equipmentId: string,
  options: { page?: number; limit?: number } = {},
) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const id = cleanId(equipmentId);
  if (!id) return fail("not_found");

  const equipment = await prisma.product.findFirst({
    where: { id, ...equipmentScopeFor(actor) },
    select: { id: true, meterUnit: true },
  });
  if (!equipment) return fail("not_found");

  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
  const [total, items] = await Promise.all([
    prisma.meterReading.count({ where: { productId: id } }),
    prisma.meterReading.findMany({
      where: { productId: id },
      orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  return ok({
    equipment,
    items,
    total,
    page,
    pageSize: limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  });
}

export type MeterReadingInput = {
  value?: unknown;
  readAt?: unknown;
  source?: unknown;
  note?: unknown;
  visitId?: unknown;
};

/**
 * Registrerer en måling, og lar vedlikeholdstjenesten kontrollere
 * målerplanene i samme transaksjon. Da kan ikke en måling som passerer en
 * terskel bli liggende uten at oppdraget blir opprettet.
 */
export async function addMeterReading(
  actor: ServiceActor,
  equipmentId: string,
  input: MeterReadingInput,
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const id = cleanId(equipmentId);
  if (!id) return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidInput });

  const parsed = meterReadingCreateSchema.safeParse({
    value: input.value,
    readAt: cleanText(input.readAt, { maxLength: 40 }),
    source: cleanText(input.source, { maxLength: 20 }) || "MANUAL",
    note: cleanText(input.note, { maxLength: LIMITS.text }),
    visitId: cleanId(input.visitId),
  });
  if (!parsed.success) {
    return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidReading });
  }

  const readAt =
    parseDateOnly(parsed.data.readAt) ??
    (Number.isNaN(new Date(parsed.data.readAt).getTime())
      ? null
      : new Date(parsed.data.readAt));
  if (!readAt) {
    return fail("invalid", { code: EQUIPMENT_ERROR_CODES.invalidReading });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const equipment = await tx.product.findFirst({
        where: { id, ...equipmentScopeFor(actor) },
        select: {
          id: true,
          model: true,
          customerId: true,
          status: true,
          meterUnit: true,
        },
      });
      if (!equipment) return fail("not_found");
      if (equipment.status === "RETIRED") {
        return fail("conflict", { code: EQUIPMENT_ERROR_CODES.retired });
      }

      const reading = await tx.meterReading.create({
        data: {
          productId: id,
          value: parsed.data.value,
          readAt,
          source: parsed.data.source,
          note: parsed.data.note || null,
          visitId: parsed.data.visitId ?? null,
          userId: actor.id,
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "Product",
        entityId: id,
        action: `Registrerte måling: ${parsed.data.value}${equipment.meterUnit ? ` ${equipment.meterUnit}` : ""}`,
        actor: toAuditActor(actor),
        metadata: {
          readingId: reading.id,
          value: parsed.data.value,
          readAt: readAt.toISOString(),
          source: parsed.data.source,
        },
      });

      const { evaluateMeterMaintenance } = await import(
        "@/server/maintenance"
      );
      const maintenance = await evaluateMeterMaintenance(tx, {
        productId: id,
        value: parsed.data.value,
        readAt,
        actor,
      });
      if (!maintenance.ok) return maintenance;

      return ok({ id: reading.id });
    });
  } catch (error) {
    console.error("Feil ved registrering av måling:", error);
    return fail("error");
  }
}

/** Enheter med garanti som utløper innen `days` dager. */
export async function listExpiringWarranties(
  actor: ServiceActor,
  days = 30,
) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const safeDays = Math.min(365, Math.max(0, Math.floor(days)));
  const today = todayUtc();
  const until = addDaysUtc(today, safeDays);
  const items = await prisma.product.findMany({
    where: {
      ...equipmentScopeFor(actor),
      warrantyUntil: { gte: today, lte: until },
      status: { not: "RETIRED" },
    },
    orderBy: [{ warrantyUntil: "asc" }, { model: "asc" }],
    take: 100,
    select: {
      id: true,
      model: true,
      serialNumber: true,
      warrantyUntil: true,
      customer: { select: { id: true, name: true } },
    },
  });
  return ok({ items, days: safeDays, from: toDateOnly(today), to: toDateOnly(until) });
}

/**
 * Varsler kontoret én gang per enhet når garantien nærmer seg utløp.
 * `warrantyNotifiedAt` og varselens dedupe-nøkkel gjør kjøringen idempotent.
 */
export async function notifyWarrantyExpiring(
  now = new Date(),
): Promise<{ checked: number; notified: number }> {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const until = addDaysUtc(today, 30);
  const products = await prisma.product.findMany({
    where: {
      warrantyUntil: { gte: today, lte: until },
      warrantyNotifiedAt: null,
      status: { not: "RETIRED" },
      customer: { deletedAt: null },
    },
    orderBy: [{ warrantyUntil: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      model: true,
      serialNumber: true,
      warrantyUntil: true,
      customer: {
        select: { id: true, name: true, departmentId: true },
      },
    },
  });

  let notified = 0;
  for (const product of products) {
    const recipients = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: "ADMIN" },
          ...(product.customer.departmentId
            ? [
                {
                  role: { in: ["OFFICE" as const] },
                  departmentId: product.customer.departmentId,
                },
              ]
            : []),
        ],
      },
      select: { id: true },
      take: 200,
    });

    for (const recipient of recipients) {
      const result = await notifyUser({
        userId: recipient.id,
        type: "WARRANTY",
        title: "Garanti utløper snart",
        body: `${product.model}${product.serialNumber ? ` (SN: ${product.serialNumber})` : ""} hos ${product.customer.name} har garanti til ${formatDate(product.warrantyUntil)}.`,
        sourceLabel: `Utstyr: ${product.model} · ${product.customer.name}`,
        href: `/enheter/${product.id}`,
        dedupeKey: `warranty:${product.id}:${recipient.id}`,
      });
      if (result) notified += 1;
    }

    await prisma.product.updateMany({
      where: { id: product.id, warrantyNotifiedAt: null },
      data: { warrantyNotifiedAt: now },
    });
  }

  return { checked: products.length, notified };
}

/** Valgene skjemaene på /enheter trenger. Alle listene er hardt avgrenset. */
export async function getEquipmentFormOptions(actor: ServiceActor) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const [customers, categories, equipment] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true },
    }),
    prisma.equipmentCategory.findMany({
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, parentId: true },
    }),
    prisma.product.findMany({
      where: equipmentScopeFor(actor),
      orderBy: [{ model: "asc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        model: true,
        serialNumber: true,
        customerId: true,
        customer: { select: { name: true } },
      },
    }),
  ]);

  return ok({ customers, categories, equipment });
}

/** Brukes av API-et for å velge riktig HTTP-status uten å gjette. */
export function equipmentFailureStatus(failure: ServiceFailure): number {
  switch (failure.reason) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "in_use":
      return 409;
    case "rate_limited":
      return 429;
    case "error":
      return 500;
    default:
      return 422;
  }
}

export function equipmentStatusLabelKey(status: string): string {
  const key = statusColumn(status);
  return `assets.status.${key}`;
}
