// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger
// som historiske driftsdata, ikke UI-tekst.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cleanText, LIMITS } from "@/lib/sanitize";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "@/server/actor";
import { requireModule } from "@/server/modules";
import {
  decimalToNumber,
  nextStockQuantity,
  suggestedPurchaseQuantity,
} from "@/lib/inventory";
import {
  calculateLineTotal,
  calculatePurchaseOrderTotals,
  canCancelPurchaseOrder,
  canOrderPurchaseOrder,
  canReceivePurchaseOrder,
  isPurchaseOrderStatus,
  parseQuantity,
  parseUnitCost,
  quantityRemaining,
  receiptStatusAfter,
  type PurchaseOrderStatusValue,
} from "@/lib/purchasing";
import { lockStockLevel } from "@/server/inventory";
import type { ErrorCode } from "@/lib/error-codes";

/**
 * Innkjøp (OPS-05 residual).
 *
 * En innkjøpsordre er et utkast til den bestilles. Varemottak er den eneste
 * handlingen som flytter fysisk beholdning: den øker `StockLevel` på
 * mottakslokasjonen og skriver en `StockMovement` av typen `IN`, alt i samme
 * transaksjon som linje- og ordrestatus. Radlås på ordren serialiserer
 * samtidige mottak, slik at to brukere aldri kan motta mer enn bestilt.
 *
 * Avdelingssperren følger mottakslokasjonen (og dermed leverandøren ordren ble
 * opprettet mot). Administrator ser alle avdelinger.
 */

export const PURCHASING_ERROR_CODES = {
  invalidSupplier: "purchasing.invalidSupplier",
  duplicateSupplier: "purchasing.duplicateSupplier",
  invalidOrder: "purchasing.invalidOrder",
  invalidLine: "purchasing.invalidLine",
  duplicateLine: "purchasing.duplicateLine",
  invalidTransition: "purchasing.invalidTransition",
  overReceipt: "purchasing.overReceipt",
  nothingToOrder: "purchasing.nothingToOrder",
} as const satisfies Record<string, ErrorCode>;

const MAX_LINE_QUANTITY = 1_000_000;

function hasValue(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function requireView(actor: ServiceActor): ServiceFailure | null {
  if (!actor?.isActive || !can(actor, "equipment.view")) return fail("forbidden");
  return null;
}

function requireManage(actor: ServiceActor): ServiceFailure | null {
  if (!actor?.isActive || !can(actor, "equipment.manage")) {
    return fail("forbidden");
  }
  return null;
}

/** Leverandører uten avdeling er felles; øvrige følger egen avdeling. */
export function supplierScope(actor: ServiceActor): Prisma.SupplierWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (isAdminActor(actor)) return {};
  if (!actor.departmentId) return { id: { in: [] } };
  return {
    OR: [{ departmentId: actor.departmentId }, { departmentId: null }],
  };
}

/** Innkjøpsordrer er låst til avdelingen de ble opprettet i. */
export function purchaseOrderScope(
  actor: ServiceActor,
): Prisma.PurchaseOrderWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (isAdminActor(actor)) return {};
  if (!actor.departmentId) return { id: { in: [] } };
  return { departmentId: actor.departmentId };
}

function locationScope(actor: ServiceActor): Prisma.InventoryLocationWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (isAdminActor(actor)) return {};
  if (!actor.departmentId) return { id: { in: [] } };
  return { departmentId: actor.departmentId };
}

function parseDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
    SELECT nextval('"PurchaseOrder_number_seq"') AS value
  `;
  const sequence = Number(rows[0]?.value ?? 0);
  const year = new Date().getUTCFullYear();
  return `PO-${year}-${String(sequence).padStart(5, "0")}`;
}

/** Låser ordren slik at bestilling, avbestilling og mottak serialiseres. */
async function lockPurchaseOrder(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE
  `;
  return rows.length > 0;
}

const orderInclude = {
  supplier: { select: { id: true, name: true, email: true, departmentId: true } },
  location: { select: { id: true, name: true, departmentId: true, isActive: true } },
  lines: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      inventoryItemId: true,
      orderedQuantity: true,
      receivedQuantity: true,
      unitCost: true,
      sortOrder: true,
      inventoryItem: { select: { sku: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type OrderWithLines = Prisma.PurchaseOrderGetPayload<{
  include: typeof orderInclude;
}>;

async function findAccessibleOrder(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  id: string,
): Promise<OrderWithLines | null> {
  return tx.purchaseOrder.findFirst({
    where: { id, ...purchaseOrderScope(actor) },
    include: orderInclude,
  });
}

async function findAccessibleSupplier(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  id: string,
) {
  return tx.supplier.findFirst({
    where: { id, ...supplierScope(actor) },
    select: { id: true, name: true, departmentId: true, active: true },
  });
}

async function findAccessibleLocation(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  id: string,
) {
  return tx.inventoryLocation.findFirst({
    where: { id, ...locationScope(actor) },
    select: { id: true, name: true, departmentId: true, isActive: true },
  });
}

export type SupplierRow = {
  id: string;
  name: string;
  orgNumber: string | null;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  active: boolean;
};

export async function listSuppliers(
  actor: ServiceActor,
): Promise<ServiceResult<{ suppliers: SupplierRow[] }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;

  const suppliers = await prisma.supplier.findMany({
    where: supplierScope(actor),
    orderBy: [{ active: "desc" }, { name: "asc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      orgNumber: true,
      email: true,
      phone: true,
      departmentId: true,
      active: true,
    },
  });
  return ok({ suppliers });
}

export async function createSupplier(
  actor: ServiceActor,
  input: {
    name: unknown;
    orgNumber?: unknown;
    email?: unknown;
    phone?: unknown;
    departmentId?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const name = cleanText(input.name, { maxLength: LIMITS.title });
  if (!name) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidSupplier });
  }
  const departmentId =
    isAdminActor(actor) && hasValue(input.departmentId)
      ? cleanId(input.departmentId)
      : actor.departmentId;
  if (!isAdminActor(actor) && !departmentId) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidSupplier });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          name,
          orgNumber:
            cleanText(input.orgNumber, { maxLength: 20 })
              .replace(/\s+/g, "")
              .toUpperCase() || null,
          email: cleanText(input.email, { maxLength: LIMITS.short }) || null,
          phone: cleanText(input.phone, { maxLength: 40 }) || null,
          departmentId,
        },
        select: { id: true, name: true },
      });
      await audit(tx, {
        entityType: "Supplier",
        entityId: supplier.id,
        action: `Opprettet leverandør ${supplier.name}`,
        actor: toAuditActor(actor),
        departmentId,
        metadata: { name: supplier.name },
      });
      return ok({ id: supplier.id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail("conflict", {
        code: PURCHASING_ERROR_CODES.duplicateSupplier,
      });
    }
    throw error;
  }
}

export type PurchaseOrderListRow = {
  id: string;
  number: string;
  status: PurchaseOrderStatusValue;
  supplierName: string;
  locationName: string;
  expectedAt: Date | null;
  createdAt: Date;
  lineCount: number;
  orderedTotal: string;
  receivedTotal: string;
};

export async function listPurchaseOrders(
  actor: ServiceActor,
  params: { status?: unknown; q?: unknown } = {},
): Promise<ServiceResult<{ orders: PurchaseOrderListRow[] }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;

  const status = hasValue(params.status) ? String(params.status) : "";
  if (status && !isPurchaseOrderStatus(status)) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidOrder });
  }
  const q = cleanText(params.q, { maxLength: LIMITS.short });

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      ...purchaseOrderScope(actor),
      ...(status ? { status: status as PurchaseOrderStatusValue } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { supplier: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
    include: {
      supplier: { select: { name: true } },
      location: { select: { name: true } },
      lines: {
        select: {
          orderedQuantity: true,
          receivedQuantity: true,
          unitCost: true,
        },
      },
    },
  });

  return ok({
    orders: orders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      supplierName: order.supplier.name,
      locationName: order.location.name,
      expectedAt: order.expectedAt,
      createdAt: order.createdAt,
      lineCount: order.lines.length,
      ...calculatePurchaseOrderTotals(order.lines),
    })),
  });
}

export type PurchaseOrderDetail = {
  order: {
    id: string;
    number: string;
    status: PurchaseOrderStatusValue;
    supplierId: string;
    supplierName: string;
    supplierEmail: string | null;
    locationId: string;
    locationName: string;
    departmentId: string | null;
    expectedAt: Date | null;
    notes: string | null;
    createdAt: Date;
    orderedAt: Date | null;
    receivedAt: Date | null;
    cancelledAt: Date | null;
    orderedTotal: string;
    receivedTotal: string;
    canOrder: boolean;
    canCancel: boolean;
    canReceive: boolean;
  };
  lines: Array<{
    id: string;
    itemId: string;
    sku: string;
    name: string;
    unit: string;
    orderedQuantity: number;
    receivedQuantity: number;
    remainingQuantity: number;
    unitCost: number;
    lineTotal: string;
  }>;
  items: Array<{ id: string; sku: string; name: string; unit: string }>;
};

export async function getPurchaseOrder(
  actor: ServiceActor,
  orderId: string,
): Promise<ServiceResult<PurchaseOrderDetail>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;

  const id = cleanId(orderId);
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, ...purchaseOrderScope(actor) },
    include: orderInclude,
  });
  if (!order) return fail("not_found");

  const items = await prisma.inventoryItem.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    take: 500,
    select: { id: true, sku: true, name: true, unit: true },
  });

  const hasReceived = order.lines.some(
    (line) => decimalToNumber(line.receivedQuantity) > 0,
  );
  const totals = calculatePurchaseOrderTotals(order.lines);

  return ok({
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      supplierEmail: order.supplier.email,
      locationId: order.locationId,
      locationName: order.location.name,
      departmentId: order.departmentId,
      expectedAt: order.expectedAt,
      notes: order.notes,
      createdAt: order.createdAt,
      orderedAt: order.orderedAt,
      receivedAt: order.receivedAt,
      cancelledAt: order.cancelledAt,
      ...totals,
      canOrder: canOrderPurchaseOrder(order.status, order.lines.length),
      canCancel: canCancelPurchaseOrder(order.status, hasReceived),
      canReceive: canReceivePurchaseOrder(order.status),
    },
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.inventoryItemId,
      sku: line.inventoryItem.sku,
      name: line.inventoryItem.name,
      unit: line.inventoryItem.unit,
      orderedQuantity: decimalToNumber(line.orderedQuantity),
      receivedQuantity: decimalToNumber(line.receivedQuantity),
      remainingQuantity: decimalToNumber(
        quantityRemaining(line.orderedQuantity, line.receivedQuantity),
      ),
      unitCost: decimalToNumber(line.unitCost),
      lineTotal: calculateLineTotal(
        line.orderedQuantity,
        line.unitCost,
      ).toFixed(2),
    })),
    items,
  });
}

export async function createPurchaseOrder(
  actor: ServiceActor,
  input: {
    supplierId: unknown;
    locationId: unknown;
    expectedAt?: unknown;
    notes?: unknown;
  },
): Promise<ServiceResult<{ id: string; number: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const supplierId = cleanId(input.supplierId);
  const locationId = cleanId(input.locationId);
  const expectedAt = parseDateInput(input.expectedAt);
  if (!supplierId || !locationId || expectedAt === undefined) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidOrder });
  }
  const notes = cleanText(input.notes, { maxLength: LIMITS.text }) || null;

  return prisma.$transaction(async (tx) => {
    const supplier = await findAccessibleSupplier(tx, actor, supplierId);
    if (!supplier || !supplier.active) return fail("not_found");
    const location = await findAccessibleLocation(tx, actor, locationId);
    if (!location || !location.isActive) return fail("not_found");

    const departmentId =
      location.departmentId ?? supplier.departmentId ?? actor.departmentId ?? null;
    if (!isAdminActor(actor) && departmentId !== actor.departmentId) {
      return fail("forbidden");
    }

    const number = await nextOrderNumber(tx);
    const order = await tx.purchaseOrder.create({
      data: {
        number,
        supplierId,
        locationId,
        departmentId,
        expectedAt,
        notes,
        createdById: actor.id,
      },
      select: { id: true, number: true },
    });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: order.id,
      action: `Opprettet innkjøpsordre ${order.number}`,
      actor: toAuditActor(actor),
      departmentId,
      metadata: {
        supplierId,
        locationId,
        number: order.number,
      },
    });
    return ok({ id: order.id, number: order.number });
  });
}

export async function updatePurchaseOrderDraft(
  actor: ServiceActor,
  input: {
    id: unknown;
    supplierId?: unknown;
    locationId?: unknown;
    expectedAt?: unknown;
    notes?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const id = cleanId(input.id);
  if (!id) return fail("not_found");
  const expectedAt = parseDateInput(input.expectedAt);
  if (expectedAt === undefined) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidOrder });
  }

  return prisma.$transaction(async (tx) => {
    if (!(await lockPurchaseOrder(tx, id))) return fail("not_found");
    const order = await findAccessibleOrder(tx, actor, id);
    if (!order) return fail("not_found");
    if (order.status !== "DRAFT") {
      return fail("conflict", {
        code: PURCHASING_ERROR_CODES.invalidTransition,
      });
    }

    const supplierId = hasValue(input.supplierId)
      ? cleanId(input.supplierId)
      : order.supplierId;
    const locationId = hasValue(input.locationId)
      ? cleanId(input.locationId)
      : order.locationId;
    const supplier = await findAccessibleSupplier(tx, actor, supplierId);
    if (!supplier) return fail("not_found");
    const location = await findAccessibleLocation(tx, actor, locationId);
    if (!location || !location.isActive) return fail("not_found");

    const departmentId =
      location.departmentId ?? supplier.departmentId ?? actor.departmentId ?? null;
    if (!isAdminActor(actor) && departmentId !== actor.departmentId) {
      return fail("forbidden");
    }

    const data: Prisma.PurchaseOrderUpdateInput = {
      supplier: { connect: { id: supplierId } },
      location: { connect: { id: locationId } },
      departmentId,
    };
    if (expectedAt !== undefined) data.expectedAt = expectedAt;
    if (input.notes !== undefined) {
      data.notes = cleanText(input.notes, { maxLength: LIMITS.text }) || null;
    }

    await tx.purchaseOrder.update({ where: { id }, data });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: id,
      action: `Endret innkjøpsordre ${order.number}`,
      actor: toAuditActor(actor),
      departmentId,
      metadata: { changed: Object.keys(data) },
    });
    return ok({ id });
  });
}

export async function addPurchaseOrderLine(
  actor: ServiceActor,
  input: {
    purchaseOrderId: unknown;
    itemId: unknown;
    orderedQuantity: unknown;
    unitCost?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const orderId = cleanId(input.purchaseOrderId);
  const itemId = cleanId(input.itemId);
  const quantity = parseQuantity(input.orderedQuantity);
  const unitCost =
    input.unitCost === undefined || input.unitCost === ""
      ? new Prisma.Decimal(0)
      : parseUnitCost(input.unitCost);
  if (
    !orderId ||
    !itemId ||
    !quantity ||
    quantity.lessThanOrEqualTo(0) ||
    quantity.greaterThan(MAX_LINE_QUANTITY) ||
    !unitCost
  ) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidLine });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockPurchaseOrder(tx, orderId))) return fail("not_found");
      const order = await findAccessibleOrder(tx, actor, orderId);
      if (!order) return fail("not_found");
      if (order.status !== "DRAFT") {
        return fail("conflict", {
          code: PURCHASING_ERROR_CODES.invalidTransition,
        });
      }
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { id: true, sku: true, name: true, active: true },
      });
      if (!item || !item.active) return fail("not_found");

      const line = await tx.purchaseOrderLine.create({
        data: {
          purchaseOrderId: orderId,
          inventoryItemId: itemId,
          orderedQuantity: quantity.toFixed(3),
          unitCost: unitCost.toDecimalPlaces(2).toFixed(2),
          sortOrder: order.lines.length,
        },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "PurchaseOrder",
        entityId: orderId,
        action: `La til vare ${item.sku} ${item.name} på ${order.number}`,
        actor: toAuditActor(actor),
        departmentId: order.departmentId,
        metadata: {
          lineId: line.id,
          itemId,
          orderedQuantity: quantity.toFixed(3),
          unitCost: unitCost.toFixed(2),
        },
      });
      return ok({ id: line.id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail("conflict", { code: PURCHASING_ERROR_CODES.duplicateLine });
    }
    throw error;
  }
}

export async function removePurchaseOrderLine(
  actor: ServiceActor,
  input: { purchaseOrderId: unknown; lineId: unknown },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const orderId = cleanId(input.purchaseOrderId);
  const lineId = cleanId(input.lineId);
  if (!orderId || !lineId) return fail("not_found");

  return prisma.$transaction(async (tx) => {
    if (!(await lockPurchaseOrder(tx, orderId))) return fail("not_found");
    const order = await findAccessibleOrder(tx, actor, orderId);
    if (!order) return fail("not_found");
    if (order.status !== "DRAFT") {
      return fail("conflict", {
        code: PURCHASING_ERROR_CODES.invalidTransition,
      });
    }
    const line = order.lines.find((candidate) => candidate.id === lineId);
    if (!line) return fail("not_found");
    if (decimalToNumber(line.receivedQuantity) > 0) {
      return fail("conflict", {
        code: PURCHASING_ERROR_CODES.invalidTransition,
      });
    }

    await tx.purchaseOrderLine.delete({ where: { id: lineId } });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: orderId,
      action: `Fjernet vare ${line.inventoryItem.sku} ${line.inventoryItem.name} fra ${order.number}`,
      actor: toAuditActor(actor),
      departmentId: order.departmentId,
      metadata: { lineId, itemId: line.inventoryItemId },
    });
    return ok({ id: lineId });
  });
}

export async function orderPurchaseOrder(
  actor: ServiceActor,
  orderId: string,
): Promise<ServiceResult<{ id: string; status: PurchaseOrderStatusValue }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const id = cleanId(orderId);
  if (!id) return fail("not_found");

  return prisma.$transaction(async (tx) => {
    if (!(await lockPurchaseOrder(tx, id))) return fail("not_found");
    const order = await findAccessibleOrder(tx, actor, id);
    if (!order) return fail("not_found");
    if (!canOrderPurchaseOrder(order.status, order.lines.length)) {
      return fail("conflict", {
        code:
          order.lines.length === 0
            ? PURCHASING_ERROR_CODES.nothingToOrder
            : PURCHASING_ERROR_CODES.invalidTransition,
      });
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "ORDERED", orderedAt: new Date() },
    });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: id,
      action: `Bestilte innkjøpsordre ${order.number}`,
      actor: toAuditActor(actor),
      departmentId: order.departmentId,
      metadata: { supplierId: order.supplierId, lineCount: order.lines.length },
    });
    return ok({ id, status: "ORDERED" as const });
  });
}

export async function cancelPurchaseOrder(
  actor: ServiceActor,
  orderId: string,
): Promise<ServiceResult<{ id: string; status: PurchaseOrderStatusValue }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const id = cleanId(orderId);
  if (!id) return fail("not_found");

  return prisma.$transaction(async (tx) => {
    if (!(await lockPurchaseOrder(tx, id))) return fail("not_found");
    const order = await findAccessibleOrder(tx, actor, id);
    if (!order) return fail("not_found");
    const hasReceived = order.lines.some(
      (line) => decimalToNumber(line.receivedQuantity) > 0,
    );
    if (!canCancelPurchaseOrder(order.status, hasReceived)) {
      return fail("conflict", {
        code: PURCHASING_ERROR_CODES.invalidTransition,
      });
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: id,
      action: `Avbestilte innkjøpsordre ${order.number}`,
      actor: toAuditActor(actor),
      departmentId: order.departmentId,
      metadata: { previousStatus: order.status },
    });
    return ok({ id, status: "CANCELLED" as const });
  });
}

export type ReceiveLineInput = { lineId: unknown; quantity: unknown };

/**
 * Mottar hele eller deler av ordren. Radlåsen på ordren gjør at to samtidige
 * mottak serialiseres, slik at den andre ser oppdatert mottatt mengde og blir
 * avvist dersom den prøver å motta mer enn det som gjenstår.
 */
export async function receivePurchaseOrder(
  actor: ServiceActor,
  orderId: string,
  receipts: readonly ReceiveLineInput[],
): Promise<
  ServiceResult<{
    id: string;
    status: PurchaseOrderStatusValue;
    received: Array<{ lineId: string; quantity: number }>;
  }>
> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const id = cleanId(orderId);
  if (!id) return fail("not_found");

  const byLine = new Map<string, Prisma.Decimal>();
  for (const receipt of receipts) {
    const lineId = cleanId(receipt.lineId);
    const quantity = parseQuantity(receipt.quantity);
    if (!lineId || !quantity || quantity.lessThanOrEqualTo(0)) {
      return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidLine });
    }
    if (byLine.has(lineId)) {
      return fail("invalid", { code: PURCHASING_ERROR_CODES.duplicateLine });
    }
    byLine.set(lineId, quantity);
  }
  if (byLine.size === 0) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.invalidLine });
  }

  return prisma.$transaction(async (tx) => {
    if (!(await lockPurchaseOrder(tx, id))) return fail("not_found");
    const order = await findAccessibleOrder(tx, actor, id);
    if (!order) return fail("not_found");
    if (!canReceivePurchaseOrder(order.status)) {
      return fail("conflict", {
        code: PURCHASING_ERROR_CODES.invalidTransition,
      });
    }

    const linesById = new Map(order.lines.map((line) => [line.id, line]));
    const accepted: Array<{
      line: OrderWithLines["lines"][number];
      quantity: Prisma.Decimal;
    }> = [];
    for (const [lineId, quantity] of byLine) {
      const line = linesById.get(lineId);
      if (!line) return fail("not_found");
      const remaining = quantityRemaining(
        line.orderedQuantity,
        line.receivedQuantity,
      );
      if (quantity.greaterThan(remaining)) {
        return fail("conflict", {
          code: PURCHASING_ERROR_CODES.overReceipt,
          lineId,
          remaining: remaining.toFixed(3),
          requested: quantity.toFixed(3),
        });
      }
      accepted.push({ line, quantity });
    }

    // Lås beholdningsrader i stabil rekkefølge, slik at to mottak som berører
    // samme varer aldri kan låse hverandre i motsatt rekkefølge.
    accepted.sort((a, b) =>
      a.line.inventoryItemId.localeCompare(b.line.inventoryItemId),
    );

    for (const { line, quantity } of accepted) {
      const current = await lockStockLevel(
        tx,
        line.inventoryItemId,
        order.locationId,
      );
      const next = nextStockQuantity(
        current,
        "IN",
        decimalToNumber(quantity),
      );
      await tx.stockLevel.update({
        where: {
          itemId_locationId: {
            itemId: line.inventoryItemId,
            locationId: order.locationId,
          },
        },
        data: { quantity: next },
      });
      await tx.stockMovement.create({
        data: {
          itemId: line.inventoryItemId,
          locationId: order.locationId,
          type: "IN",
          quantity,
          reason: `Mottak ${order.number}`,
          userId: actor.id,
        },
      });
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: {
          receivedQuantity: new Prisma.Decimal(line.receivedQuantity).add(
            quantity,
          ),
        },
      });
    }

    const nextLines = order.lines.map((line) => {
      const receipt = accepted.find((entry) => entry.line.id === line.id);
      return {
        orderedQuantity: line.orderedQuantity,
        receivedQuantity: receipt
          ? new Prisma.Decimal(line.receivedQuantity).add(receipt.quantity)
          : line.receivedQuantity,
      };
    });
    const status = receiptStatusAfter(nextLines);
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status,
        receivedAt: status === "RECEIVED" ? new Date() : order.receivedAt,
      },
    });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: id,
      action: `Mottok varer på ${order.number}`,
      actor: toAuditActor(actor),
      departmentId: order.departmentId,
      metadata: {
        status,
        locationId: order.locationId,
        lines: accepted.map((entry) => ({
          lineId: entry.line.id,
          itemId: entry.line.inventoryItemId,
          quantity: entry.quantity.toFixed(3),
        })),
      },
    });
    return ok({
      id,
      status,
      received: accepted.map((entry) => ({
        lineId: entry.line.id,
        quantity: decimalToNumber(entry.quantity),
      })),
    });
  });
}

/**
 * Dagens kjøpsforslag for et utvalg varer, aggregert over de lokasjonene
 * aktøren ser. Samme formel som `listInventory`, men uten leserettighetskrav:
 * den som har `equipment.manage` skal kunne bestille selv om rollen ikke har
 * `equipment.view`.
 */
async function suggestedQuantitiesFor(
  actor: ServiceActor,
  itemIds: readonly string[],
): Promise<Map<string, number>> {
  const locations = await prisma.inventoryLocation.findMany({
    where: { ...locationScope(actor), isActive: true },
    select: { id: true },
  });
  const locationIds = locations.map((location) => location.id);
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: [...itemIds] }, active: true },
    select: { id: true, minLevel: true },
  });
  const [levels, reservations] = await Promise.all([
    prisma.stockLevel.groupBy({
      by: ["itemId"],
      where: { itemId: { in: [...itemIds] }, locationId: { in: locationIds } },
      _sum: { quantity: true },
    }),
    prisma.inventoryReservation.groupBy({
      by: ["itemId"],
      where: {
        itemId: { in: [...itemIds] },
        locationId: { in: locationIds },
        status: "ACTIVE",
      },
      _sum: { quantity: true },
    }),
  ]);
  const onHand = new Map(
    levels.map((level) => [level.itemId, decimalToNumber(level._sum.quantity)]),
  );
  const reserved = new Map(
    reservations.map((row) => [row.itemId, decimalToNumber(row._sum.quantity)]),
  );
  const result = new Map<string, number>();
  for (const item of items) {
    result.set(
      item.id,
      suggestedPurchaseQuantity(
        onHand.get(item.id) ?? 0,
        reserved.get(item.id) ?? 0,
        decimalToNumber(item.minLevel),
      ),
    );
  }
  return result;
}

/**
 * Lager et utkast fra dagens kjøpsforslag. Valgte varer slås sammen til én
 * linje per vare, med den foreslåtte mengden. Forslaget regnes på nytt på
 * serveren, så klienten kan ikke sende egne mengder.
 */
export async function createPurchaseOrderFromSuggestions(
  actor: ServiceActor,
  input: {
    supplierId: unknown;
    locationId: unknown;
    itemIds?: unknown;
    expectedAt?: unknown;
    notes?: unknown;
  },
): Promise<ServiceResult<{ id: string; number: string; lineCount: number }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const supplierId = cleanId(input.supplierId);
  const locationId = cleanId(input.locationId);
  const expectedAt = parseDateInput(input.expectedAt);
  const selected = Array.from(
    new Set(
      (Array.isArray(input.itemIds) ? input.itemIds : [input.itemIds])
        .map((value) => cleanId(value))
        .filter(Boolean),
    ),
  );
  if (
    !supplierId ||
    !locationId ||
    selected.length === 0 ||
    expectedAt === undefined
  ) {
    return fail("invalid", {
      code: PURCHASING_ERROR_CODES.nothingToOrder,
    });
  }
  const notes = cleanText(input.notes, { maxLength: LIMITS.text }) || null;

  const suggestionMap = await suggestedQuantitiesFor(actor, selected);
  const chosen = selected
    .map((itemId) => ({
      id: itemId,
      suggestedQuantity: suggestionMap.get(itemId) ?? 0,
    }))
    .filter((item) => item.suggestedQuantity > 0);
  if (chosen.length === 0) {
    return fail("invalid", { code: PURCHASING_ERROR_CODES.nothingToOrder });
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await findAccessibleSupplier(tx, actor, supplierId);
    if (!supplier || !supplier.active) return fail("not_found");
    const location = await findAccessibleLocation(tx, actor, locationId);
    if (!location || !location.isActive) return fail("not_found");

    const departmentId =
      location.departmentId ?? supplier.departmentId ?? actor.departmentId ?? null;
    if (!isAdminActor(actor) && departmentId !== actor.departmentId) {
      return fail("forbidden");
    }

    const number = await nextOrderNumber(tx);
    const order = await tx.purchaseOrder.create({
      data: {
        number,
        supplierId,
        locationId,
        departmentId,
        expectedAt,
        notes,
        createdById: actor.id,
        lines: {
          create: chosen.map((item, index) => ({
            inventoryItemId: item.id,
            orderedQuantity: item.suggestedQuantity.toFixed(3),
            sortOrder: index,
          })),
        },
      },
      select: { id: true, number: true },
    });
    await audit(tx, {
      entityType: "PurchaseOrder",
      entityId: order.id,
      action: `Opprettet innkjøpsordre ${order.number} fra kjøpsforslag`,
      actor: toAuditActor(actor),
      departmentId,
      metadata: {
        supplierId,
        locationId,
        itemIds: chosen.map((item) => item.id),
      },
    });
    return ok({ id: order.id, number: order.number, lineCount: chosen.length });
  });
}
