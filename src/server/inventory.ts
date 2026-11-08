// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger
// som historiske driftsdata, ikke UI-tekst.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cleanText, LIMITS } from "@/lib/sanitize";
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
} from "@/server/actor";
import { requireModule } from "@/server/modules";
import {
  canTakeFromStock,
  decimalToNumber,
  isLowStock,
  nextStockQuantity,
  roundQuantity,
  suggestedPurchaseQuantity,
} from "@/lib/inventory";

/**
 * Lager og reservedeler (OPS-05).
 *
 * Beholdning ligg i `StockLevel` per vare og lokasjon. Alle endringer skjer i
 * en transaksjon med radlås (`SELECT ... FOR UPDATE`), slik at to samtidige
 * reservasjoner eller justeringer ikke kan lese samme beholdning og begge
 * slippe gjennom. Reservasjoner reduserer tilgjengelig mengde uten å flytte
 * fysisk beholdning; forbruk trekker den ned når arbeidet fullføres.
 *
 * Avdelingssperren følger lokasjonen. En ansatt ser bare lokasjoner i egen
 * avdeling, mens administrator ser alle.
 */

export const INVENTORY_ERROR_CODES = {
  negativeStock: "inventory.negativeStock",
  insufficientStock: "inventory.insufficientStock",
  invalidMovement: "inventory.invalidMovement",
  invalidLocation: "inventory.invalidLocation",
  invalidItem: "inventory.invalidItem",
  duplicateSku: "inventory.duplicateSku",
  reservationNotActive: "inventory.reservationNotActive",
  workOrderRequired: "inventory.workOrderRequired",
} as const;

const MOVEMENT_TYPES = ["IN", "OUT", "ADJUST"] as const;
type AdjustMovementType = (typeof MOVEMENT_TYPES)[number];

function hasValue(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
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

/** Reservasjon, frigjøring og forbruk krever oppdragsrettighet. */
function requireStockWork(actor: ServiceActor): ServiceFailure | null {
  if (
    !actor?.isActive ||
    (!can(actor, "workorders.update") && !can(actor, "equipment.manage"))
  ) {
    return fail("forbidden");
  }
  return null;
}

function locationScope(actor: ServiceActor): Prisma.InventoryLocationWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (isAdminActor(actor)) return {};
  if (!actor.departmentId) return { id: { in: [] } };
  return { departmentId: actor.departmentId };
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function parseLocationType(value: unknown): "WAREHOUSE" | "VAN" {
  return value === "VAN" ? "VAN" : "WAREHOUSE";
}

function parseMovementType(value: unknown): AdjustMovementType | null {
  return (MOVEMENT_TYPES as readonly string[]).includes(String(value))
    ? (String(value) as AdjustMovementType)
    : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function findAccessibleLocation(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  locationId: string,
) {
  return tx.inventoryLocation.findFirst({
    where: { id: locationId, ...locationScope(actor) },
    select: {
      id: true,
      name: true,
      type: true,
      departmentId: true,
      isActive: true,
    },
  });
}

/**
 * Oppretter beholdningsraden om den mangler og låser den. `ON CONFLICT DO
 * NOTHING` gjør opprettelsen samtidighetssikker; låsen tas etterpå, så alle
 * som vil endre samme rad serialiseres.
 */
export async function lockStockLevel(
  tx: Prisma.TransactionClient,
  itemId: string,
  locationId: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO "StockLevel" ("id", "itemId", "locationId", "quantity", "updatedAt")
    VALUES (${randomUUID()}, ${itemId}, ${locationId}, 0, NOW())
    ON CONFLICT ("itemId", "locationId") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ quantity: string }>>`
    SELECT "quantity"::text AS quantity
    FROM "StockLevel"
    WHERE "itemId" = ${itemId} AND "locationId" = ${locationId}
    FOR UPDATE
  `;
  return decimalToNumber(rows[0]?.quantity ?? "0");
}

async function activeReservedQuantity(
  tx: Prisma.TransactionClient,
  itemId: string,
  locationId: string,
): Promise<number> {
  const result = await tx.inventoryReservation.aggregate({
    where: { itemId, locationId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  return decimalToNumber(result._sum.quantity);
}

export type InventoryLocationView = {
  id: string;
  name: string;
  type: "WAREHOUSE" | "VAN";
  departmentId: string | null;
  assignedUserId: string | null;
  isActive: boolean;
  itemCount: number;
  lowCount: number;
};

export type InventoryItemRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  minLevel: number;
  active: boolean;
  onHand: number;
  reserved: number;
  available: number;
  low: boolean;
  suggestedQuantity: number;
};

export type InventoryOverview = {
  items: InventoryItemRow[];
  locations: InventoryLocationView[];
  suggestions: InventoryItemRow[];
};

/** Alle varer med beholdning i de lokasjonene aktøren ser. */
export async function listInventory(
  actor: ServiceActor,
  params: { q?: string } = {},
): Promise<ServiceResult<InventoryOverview>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;

  const q = cleanText(params.q, { maxLength: LIMITS.short });
  const locations = await prisma.inventoryLocation.findMany({
    where: { ...locationScope(actor), isActive: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      departmentId: true,
      assignedUserId: true,
      isActive: true,
    },
  });
  const locationIds = locations.map((location) => location.id);

  const items = await prisma.inventoryItem.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: 500,
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      minLevel: true,
      active: true,
    },
  });

  const [levels, reservations] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { locationId: { in: locationIds } },
      select: { itemId: true, locationId: true, quantity: true },
    }),
    prisma.inventoryReservation.findMany({
      where: { status: "ACTIVE", locationId: { in: locationIds } },
      select: { itemId: true, locationId: true, quantity: true },
    }),
  ]);

  const onHandByItem = new Map<string, number>();
  const reservedByItem = new Map<string, number>();
  for (const level of levels) {
    onHandByItem.set(
      level.itemId,
      roundQuantity(
        (onHandByItem.get(level.itemId) ?? 0) + decimalToNumber(level.quantity),
      ),
    );
  }
  for (const reservation of reservations) {
    reservedByItem.set(
      reservation.itemId,
      roundQuantity(
        (reservedByItem.get(reservation.itemId) ?? 0) +
          decimalToNumber(reservation.quantity),
      ),
    );
  }

  const rows: InventoryItemRow[] = items.map((item) => {
    const onHand = onHandByItem.get(item.id) ?? 0;
    const reserved = reservedByItem.get(item.id) ?? 0;
    const minLevel = decimalToNumber(item.minLevel);
    const low = isLowStock(onHand, reserved, minLevel);
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      minLevel,
      active: item.active,
      onHand,
      reserved,
      available: roundQuantity(onHand - reserved),
      low,
      suggestedQuantity: suggestedPurchaseQuantity(onHand, reserved, minLevel),
    };
  });

  const locationViews: InventoryLocationView[] = locations.map((location) => {
    const itemIds = new Set(
      levels.filter((level) => level.locationId === location.id).map((level) => level.itemId),
    );
    let lowCount = 0;
    for (const item of rows) {
      if (item.low && itemIds.has(item.id)) lowCount += 1;
    }
    return {
      ...location,
      itemCount: itemIds.size,
      lowCount,
    };
  });

  return ok({
    items: rows,
    locations: locationViews,
    suggestions: rows.filter((item) => item.suggestedQuantity > 0),
  });
}

export type InventoryItemDetail = {
  item: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    minLevel: number;
    active: boolean;
    description: string | null;
  };
  levels: Array<{
    locationId: string;
    locationName: string;
    locationType: string;
    quantity: number;
    reserved: number;
    available: number;
  }>;
  movements: Array<{
    id: string;
    type: string;
    quantity: number;
    reason: string | null;
    locationName: string;
    workOrderId: string | null;
    visitId: string | null;
    createdAt: Date;
  }>;
  reservations: Array<{
    id: string;
    status: string;
    quantity: number;
    locationId: string;
    locationName: string;
    workOrderId: string | null;
    visitId: string | null;
    createdAt: Date;
  }>;
};

export async function getInventoryItem(
  actor: ServiceActor,
  itemId: string,
): Promise<ServiceResult<InventoryItemDetail>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;
  const id = cleanId(itemId);

  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      minLevel: true,
      active: true,
      description: true,
    },
  });
  if (!item) return fail("not_found");

  const scopedLocations = await prisma.inventoryLocation.findMany({
    where: locationScope(actor),
    select: { id: true, name: true, type: true },
  });
  const locationIds = scopedLocations.map((location) => location.id);
  const locationById = new Map(
    scopedLocations.map((location) => [location.id, location]),
  );

  const [levels, movements, reservations] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { itemId: id, locationId: { in: locationIds } },
      orderBy: { location: { name: "asc" } },
      select: {
        locationId: true,
        quantity: true,
        location: { select: { name: true, type: true } },
      },
    }),
    prisma.stockMovement.findMany({
      where: { itemId: id, locationId: { in: locationIds } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        quantity: true,
        reason: true,
        workOrderId: true,
        visitId: true,
        createdAt: true,
        location: { select: { name: true } },
      },
    }),
    prisma.inventoryReservation.findMany({
      where: { itemId: id, locationId: { in: locationIds } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        quantity: true,
        locationId: true,
        workOrderId: true,
        visitId: true,
        createdAt: true,
      },
    }),
  ]);

  const reservedByLocation = new Map<string, number>();
  for (const reservation of reservations) {
    if (reservation.status !== "ACTIVE") continue;
    reservedByLocation.set(
      reservation.locationId,
      roundQuantity(
        (reservedByLocation.get(reservation.locationId) ?? 0) +
          decimalToNumber(reservation.quantity),
      ),
    );
  }

  return ok({
    item: { ...item, minLevel: decimalToNumber(item.minLevel) },
    levels: levels.map((level) => {
      const reserved = reservedByLocation.get(level.locationId) ?? 0;
      const quantity = decimalToNumber(level.quantity);
      return {
        locationId: level.locationId,
        locationName: level.location.name,
        locationType: level.location.type,
        quantity,
        reserved,
        available: roundQuantity(quantity - reserved),
      };
    }),
    movements: movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      quantity: decimalToNumber(movement.quantity),
      reason: movement.reason,
      locationName: movement.location.name,
      workOrderId: movement.workOrderId,
      visitId: movement.visitId,
      createdAt: movement.createdAt,
    })),
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      status: reservation.status,
      quantity: decimalToNumber(reservation.quantity),
      locationId: reservation.locationId,
      locationName: locationById.get(reservation.locationId)?.name ?? "",
      workOrderId: reservation.workOrderId,
      visitId: reservation.visitId,
      createdAt: reservation.createdAt,
    })),
  });
}

export type InventoryLocationDetail = {
  location: {
    id: string;
    name: string;
    type: string;
    departmentId: string | null;
    isActive: boolean;
  };
  levels: Array<{
    itemId: string;
    sku: string;
    name: string;
    unit: string;
    quantity: number;
    reserved: number;
    available: number;
    low: boolean;
  }>;
  movements: Array<{
    id: string;
    type: string;
    quantity: number;
    reason: string | null;
    itemName: string;
    workOrderId: string | null;
    createdAt: Date;
  }>;
};

export async function getInventoryLocation(
  actor: ServiceActor,
  locationId: string,
): Promise<ServiceResult<InventoryLocationDetail>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;

  const location = await prisma.inventoryLocation.findFirst({
    where: { id: cleanId(locationId), ...locationScope(actor) },
    select: {
      id: true,
      name: true,
      type: true,
      departmentId: true,
      isActive: true,
    },
  });
  if (!location) return fail("not_found");

  const [levels, reservations, movements] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { locationId: location.id },
      orderBy: { item: { name: "asc" } },
      select: {
        quantity: true,
        item: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            minLevel: true,
          },
        },
      },
    }),
    prisma.inventoryReservation.findMany({
      where: { locationId: location.id, status: "ACTIVE" },
      select: { itemId: true, quantity: true },
    }),
    prisma.stockMovement.findMany({
      where: { locationId: location.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        quantity: true,
        reason: true,
        workOrderId: true,
        createdAt: true,
        item: { select: { name: true } },
      },
    }),
  ]);

  const reservedByItem = new Map<string, number>();
  for (const reservation of reservations) {
    reservedByItem.set(
      reservation.itemId,
      roundQuantity(
        (reservedByItem.get(reservation.itemId) ?? 0) +
          decimalToNumber(reservation.quantity),
      ),
    );
  }

  return ok({
    location,
    levels: levels.map((level) => {
      const quantity = decimalToNumber(level.quantity);
      const reserved = reservedByItem.get(level.item.id) ?? 0;
      return {
        itemId: level.item.id,
        sku: level.item.sku,
        name: level.item.name,
        unit: level.item.unit,
        quantity,
        reserved,
        available: roundQuantity(quantity - reserved),
        low: isLowStock(
          quantity,
          reserved,
          decimalToNumber(level.item.minLevel),
        ),
      };
    }),
    movements: movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      quantity: decimalToNumber(movement.quantity),
      reason: movement.reason,
      itemName: movement.item.name,
      workOrderId: movement.workOrderId,
      createdAt: movement.createdAt,
    })),
  });
}

/** Oppretter lagerlokasjon. Administrator kan velge avdeling eksplisitt. */
export async function createInventoryLocation(
  actor: ServiceActor,
  input: {
    name: unknown;
    type?: unknown;
    departmentId?: unknown;
    assignedUserId?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const name = cleanText(input.name, { maxLength: LIMITS.short });
  if (!name) {
    return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidLocation });
  }
  const departmentId = isAdminActor(actor) && hasValue(input.departmentId)
    ? cleanId(input.departmentId)
    : actor.departmentId;
  if (!departmentId) {
    return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidLocation });
  }

  return prisma.$transaction(async (tx) => {
    const location = await tx.inventoryLocation.create({
      data: {
        name,
        type: parseLocationType(input.type),
        departmentId,
        assignedUserId: hasValue(input.assignedUserId)
          ? cleanId(input.assignedUserId)
          : null,
      },
      select: { id: true, name: true },
    });
    await audit(tx, {
      entityType: "InventoryLocation",
      entityId: location.id,
      action: `Opprettet lagerlokasjon ${location.name}`,
      actor: toAuditActor(actor),
      departmentId,
      metadata: { name: location.name, type: parseLocationType(input.type) },
    });
    return ok({ id: location.id });
  });
}

export async function updateInventoryLocation(
  actor: ServiceActor,
  input: {
    id: unknown;
    name?: unknown;
    isActive?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const id = cleanId(input.id);
  const name = hasValue(input.name)
    ? cleanText(input.name, { maxLength: LIMITS.short })
    : undefined;
  if (!id || (name !== undefined && !name)) {
    return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidLocation });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const location = await findAccessibleLocation(tx, actor, id);
    if (!location) return null;
    await tx.inventoryLocation.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.isActive !== undefined
          ? { isActive: String(input.isActive) !== "false" }
          : {}),
      },
    });
    await audit(tx, {
      entityType: "InventoryLocation",
      entityId: id,
      action: `Endret lagerlokasjon ${name ?? location.name}`,
      actor: toAuditActor(actor),
      departmentId: location.departmentId,
      metadata: { name: name ?? location.name },
    });
    return location;
  });
  return updated ? ok({ id }) : fail("not_found");
}

/** Oppretter en vare. SKU er unik på tvers av installasjonen. */
export async function createInventoryItem(
  actor: ServiceActor,
  input: {
    sku: unknown;
    name: unknown;
    unit?: unknown;
    minLevel?: unknown;
    description?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const sku = cleanText(input.sku, { maxLength: LIMITS.short }).toUpperCase();
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const minLevel = Number(input.minLevel ?? 0);
  if (!sku || !name || !Number.isFinite(minLevel) || minLevel < 0) {
    return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidItem });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          sku,
          name,
          unit: cleanText(input.unit, { maxLength: 20 }) || "stk",
          minLevel: roundQuantity(minLevel),
          description:
            cleanText(input.description, { maxLength: LIMITS.text }) || null,
        },
        select: { id: true, sku: true, name: true },
      });
      await audit(tx, {
        entityType: "InventoryItem",
        entityId: item.id,
        action: `Opprettet vare ${item.sku} ${item.name}`,
        actor: toAuditActor(actor),
        metadata: { sku: item.sku, name: item.name },
      });
      return ok({ id: item.id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail("conflict", { code: INVENTORY_ERROR_CODES.duplicateSku });
    }
    throw error;
  }
}

export async function updateInventoryItem(
  actor: ServiceActor,
  input: {
    id: unknown;
    sku?: unknown;
    name?: unknown;
    unit?: unknown;
    minLevel?: unknown;
    description?: unknown;
    active?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;
  const id = cleanId(input.id);
  if (!id) return fail("not_found");

  const data: Prisma.InventoryItemUpdateInput = {};
  if (hasValue(input.sku)) {
    data.sku = cleanText(input.sku, { maxLength: LIMITS.short }).toUpperCase();
  }
  if (hasValue(input.name)) {
    data.name = cleanText(input.name, { maxLength: LIMITS.title });
  }
  if (hasValue(input.unit)) {
    data.unit = cleanText(input.unit, { maxLength: 20 });
  }
  if (input.minLevel !== undefined) {
    const minLevel = Number(input.minLevel);
    if (!Number.isFinite(minLevel) || minLevel < 0) {
      return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidItem });
    }
    data.minLevel = roundQuantity(minLevel);
  }
  if (input.description !== undefined) {
    data.description =
      cleanText(input.description, { maxLength: LIMITS.text }) || null;
  }
  if (input.active !== undefined) {
    data.active = String(input.active) !== "false";
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryItem.findUnique({
        where: { id },
        select: { id: true, sku: true, name: true },
      });
      if (!existing) return fail("not_found");
      await tx.inventoryItem.update({ where: { id }, data });
      await audit(tx, {
        entityType: "InventoryItem",
        entityId: id,
        action: `Endret vare ${existing.sku} ${existing.name}`,
        actor: toAuditActor(actor),
        metadata: { changed: Object.keys(data) },
      });
      return ok({ id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail("conflict", { code: INVENTORY_ERROR_CODES.duplicateSku });
    }
    throw error;
  }
}

export type AdjustStockInput = {
  itemId: unknown;
  locationId: unknown;
  type: unknown;
  quantity: unknown;
  reason?: unknown;
  workOrderId?: unknown;
  visitId?: unknown;
};

/**
 * Justerer fysisk beholdning. `IN`/`OUT` avviser negativ beholdning, mens
 * `ADJUST` er en eksplisitt korrigering som kan rette opp en feil også når
 * beholdningen må bli negativ.
 */
export async function adjustStock(
  actor: ServiceActor,
  input: AdjustStockInput,
): Promise<ServiceResult<{ quantity: number }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireManage(actor);
  if (denied) return denied;

  const itemId = cleanId(input.itemId);
  const locationId = cleanId(input.locationId);
  const type = parseMovementType(input.type);
  const quantity = Number(input.quantity);
  if (
    !itemId ||
    !locationId ||
    !type ||
    !Number.isFinite(quantity) ||
    quantity === 0
  ) {
    return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidMovement });
  }
  const reason = cleanText(input.reason, { maxLength: LIMITS.text }) || null;

  return prisma.$transaction(async (tx) => {
    const location = await findAccessibleLocation(tx, actor, locationId);
    if (!location) return fail("not_found");
    const item = await tx.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, sku: true, name: true, active: true },
    });
    if (!item) return fail("not_found");
    if (!item.active && type !== "ADJUST") {
      return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidItem });
    }

    const current = await lockStockLevel(tx, itemId, locationId);
    const next = nextStockQuantity(current, type, quantity);
    if (next < 0 && type !== "ADJUST") {
      return fail("conflict", {
        code: INVENTORY_ERROR_CODES.negativeStock,
        current,
        requested: quantity,
      });
    }

    await tx.stockLevel.update({
      where: { itemId_locationId: { itemId, locationId } },
      data: { quantity: next },
    });
    await tx.stockMovement.create({
      data: {
        itemId,
        locationId,
        type,
        quantity: type === "ADJUST" ? next - current : Math.abs(quantity),
        reason,
        workOrderId: hasValue(input.workOrderId)
          ? cleanId(input.workOrderId)
          : null,
        visitId: hasValue(input.visitId) ? cleanId(input.visitId) : null,
        userId: actor.id,
      },
    });
    await audit(tx, {
      entityType: "InventoryItem",
      entityId: itemId,
      action: `Justerte beholdning for ${item.sku} ${item.name}: ${type}`,
      actor: toAuditActor(actor),
      departmentId: location.departmentId,
      metadata: {
        type,
        quantity,
        current,
        next,
        locationId,
        reason,
      },
    });
    return ok({ quantity: next });
  });
}

export type ReserveStockInput = {
  itemId: unknown;
  locationId: unknown;
  quantity: unknown;
  workOrderId?: unknown;
  visitId?: unknown;
  note?: unknown;
};

/** Reserverer deler mot et oppdrag eller en arbeidsøkt. */
export async function reserveStock(
  actor: ServiceActor,
  input: ReserveStockInput,
): Promise<ServiceResult<{ id: string; quantity: number; available: number }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireStockWork(actor);
  if (denied) return denied;

  const itemId = cleanId(input.itemId);
  const locationId = cleanId(input.locationId);
  const quantity = roundQuantity(Math.abs(Number(input.quantity)));
  if (!itemId || !locationId || !Number.isFinite(quantity) || quantity <= 0) {
    return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidMovement });
  }
  const note = cleanText(input.note, { maxLength: LIMITS.text }) || null;

  return prisma.$transaction(async (tx) => {
    const location = await findAccessibleLocation(tx, actor, locationId);
    if (!location) return fail("not_found");

    let workOrderId = hasValue(input.workOrderId)
      ? cleanId(input.workOrderId)
      : null;
    const visitId = hasValue(input.visitId) ? cleanId(input.visitId) : null;

    if (visitId) {
      const visit = await tx.visit.findFirst({
        where: {
          id: visitId,
          workOrder: { ...workOrderScopeFor(actor), deletedAt: null },
        },
        select: { id: true, workOrderId: true },
      });
      if (!visit) return fail("not_found");
      if (workOrderId && visit.workOrderId !== workOrderId) {
        return fail("invalid", { code: INVENTORY_ERROR_CODES.invalidMovement });
      }
      workOrderId = visit.workOrderId;
    }

    if (workOrderId) {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, ...workOrderScopeFor(actor) },
        select: { id: true, status: true, legalHold: true },
      });
      if (!workOrder) return fail("not_found");
      if (
        workOrder.legalHold ||
        workOrder.status === "COMPLETED" ||
        workOrder.status === "CANCELLED"
      ) {
        return fail("conflict", { code: "inventory.workOrderLocked" });
      }
    } else if (!visitId) {
      return fail("invalid", { code: INVENTORY_ERROR_CODES.workOrderRequired });
    }

    const item = await tx.inventoryItem.findUnique({
      where: { id: itemId },
      select: { id: true, sku: true, name: true, active: true },
    });
    if (!item || !item.active) return fail("not_found");

    const current = await lockStockLevel(tx, itemId, locationId);
    const reserved = await activeReservedQuantity(tx, itemId, locationId);
    const available = roundQuantity(current - reserved);
    if (!canTakeFromStock(available, quantity)) {
      return fail("conflict", {
        code: INVENTORY_ERROR_CODES.insufficientStock,
        available,
        requested: quantity,
      });
    }

    const reservation = await tx.inventoryReservation.create({
      data: {
        itemId,
        locationId,
        quantity,
        workOrderId,
        visitId,
        note,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await tx.stockMovement.create({
      data: {
        itemId,
        locationId,
        type: "RESERVE",
        quantity,
        reason: note,
        workOrderId,
        visitId,
        userId: actor.id,
        reservationId: reservation.id,
      },
    });
    await audit(tx, {
      entityType: "InventoryReservation",
      entityId: reservation.id,
      action: `Reserverte ${quantity} ${item.sku} ${item.name}`,
      actor: toAuditActor(actor),
      departmentId: location.departmentId,
      metadata: {
        itemId,
        locationId,
        quantity,
        workOrderId,
        visitId,
        available: roundQuantity(available - quantity),
      },
    });
    return ok({
      id: reservation.id,
      quantity,
      available: roundQuantity(available - quantity),
    });
  });
}

async function releaseReservationTx(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  reservationId: string,
): Promise<ServiceResult<{ id: string }>> {
  const reservation = await tx.inventoryReservation.findFirst({
    where: {
      id: reservationId,
      location: locationScope(actor),
    },
    select: {
      id: true,
      itemId: true,
      locationId: true,
      quantity: true,
      status: true,
      workOrderId: true,
      visitId: true,
      item: { select: { sku: true, name: true } },
      location: { select: { departmentId: true } },
    },
  });
  if (!reservation) return fail("not_found");
  if (reservation.status !== "ACTIVE") {
    return fail("conflict", { code: INVENTORY_ERROR_CODES.reservationNotActive });
  }

  await tx.inventoryReservation.update({
    where: { id: reservation.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
  await tx.stockMovement.create({
    data: {
      itemId: reservation.itemId,
      locationId: reservation.locationId,
      type: "RELEASE",
      quantity: reservation.quantity,
      workOrderId: reservation.workOrderId,
      visitId: reservation.visitId,
      userId: actor.id,
      reservationId: reservation.id,
    },
  });
  await audit(tx, {
    entityType: "InventoryReservation",
    entityId: reservation.id,
    action: `Frigjorde reservasjon av ${reservation.item.sku} ${reservation.item.name}`,
    actor: toAuditActor(actor),
    departmentId: reservation.location.departmentId,
    metadata: { quantity: decimalToNumber(reservation.quantity) },
  });
  return ok({ id: reservation.id });
}

/** Frigjør en aktiv reservasjon uten å trekke beholdning. */
export async function releaseReservation(
  actor: ServiceActor,
  reservationId: string,
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireStockWork(actor);
  if (denied) return denied;
  return prisma.$transaction((tx) =>
    releaseReservationTx(tx, actor, cleanId(reservationId)),
  );
}

async function consumeReservationTx(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  reservationId: string,
): Promise<ServiceResult<{ id: string; quantity: number }>> {
  const reservation = await tx.inventoryReservation.findFirst({
    where: { id: reservationId, location: locationScope(actor) },
    select: {
      id: true,
      itemId: true,
      locationId: true,
      quantity: true,
      status: true,
      workOrderId: true,
      visitId: true,
      item: { select: { sku: true, name: true } },
      location: { select: { departmentId: true } },
    },
  });
  if (!reservation) return fail("not_found");
  if (reservation.status !== "ACTIVE") {
    return fail("conflict", { code: INVENTORY_ERROR_CODES.reservationNotActive });
  }

  const current = await lockStockLevel(
    tx,
    reservation.itemId,
    reservation.locationId,
  );
  const quantity = decimalToNumber(reservation.quantity);
  if (!canTakeFromStock(current, quantity)) {
    return fail("conflict", {
      code: INVENTORY_ERROR_CODES.negativeStock,
      current,
      requested: quantity,
    });
  }
  const next = roundQuantity(current - quantity);
  await tx.stockLevel.update({
    where: {
      itemId_locationId: {
        itemId: reservation.itemId,
        locationId: reservation.locationId,
      },
    },
    data: { quantity: next },
  });
  await tx.inventoryReservation.update({
    where: { id: reservation.id },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  await tx.stockMovement.create({
    data: {
      itemId: reservation.itemId,
      locationId: reservation.locationId,
      type: "CONSUME",
      quantity,
      workOrderId: reservation.workOrderId,
      visitId: reservation.visitId,
      userId: actor.id,
      reservationId: reservation.id,
    },
  });
  await audit(tx, {
    entityType: "InventoryReservation",
    entityId: reservation.id,
    action: `Forbrukte ${quantity} ${reservation.item.sku} ${reservation.item.name}`,
    actor: toAuditActor(actor),
    departmentId: reservation.location.departmentId,
    metadata: { quantity, next, workOrderId: reservation.workOrderId },
  });
  return ok({ id: reservation.id, quantity });
}

/** Forbruker delene når arbeidet er fullført. */
export async function consumeReservation(
  actor: ServiceActor,
  reservationId: string,
): Promise<ServiceResult<{ id: string; quantity: number }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireStockWork(actor);
  if (denied) return denied;
  return prisma.$transaction((tx) =>
    consumeReservationTx(tx, actor, cleanId(reservationId)),
  );
}

/** Forbruker alle aktive reservasjoner på en visitt i én transaksjon. */
export async function consumeReservationsForVisit(
  actor: ServiceActor,
  visitId: string,
): Promise<ServiceResult<{ consumed: number }>> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireStockWork(actor);
  if (denied) return denied;
  const id = cleanId(visitId);
  if (!id) return fail("not_found");

  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findFirst({
      where: {
        id,
        workOrder: { ...workOrderScopeFor(actor), deletedAt: null },
      },
      select: { id: true },
    });
    if (!visit) return fail("not_found");
    const reservations = await tx.inventoryReservation.findMany({
      where: {
        visitId: id,
        status: "ACTIVE",
        location: locationScope(actor),
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    for (const reservation of reservations) {
      const result = await consumeReservationTx(tx, actor, reservation.id);
      if (!result.ok) return result;
    }
    return ok({ consumed: reservations.length });
  });
}

export type WorkOrderPart = {
  id: string;
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  status: string;
  locationId: string;
  locationName: string;
  visitId: string | null;
};

export async function listWorkOrderParts(
  actor: ServiceActor,
  workOrderId: string,
): Promise<
  ServiceResult<{
    workOrder: { id: string; title: string; reference: string; status: string };
    reservations: WorkOrderPart[];
    locations: Array<{ id: string; name: string; type: string }>;
    items: Array<{ id: string; sku: string; name: string; unit: string }>;
    visits: Array<{
      id: string;
      sequence: number;
      startsAt: Date;
      status: string;
    }>;
  }>
> {
  if (!(await requireModule("inventory"))) return fail("not_found");
  const denied = requireView(actor);
  if (denied) return denied;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: cleanId(workOrderId), ...workOrderScopeFor(actor) },
    select: { id: true, title: true, reference: true, status: true },
  });
  if (!workOrder) return fail("not_found");

  const [reservations, locations, items, visits] = await Promise.all([
    prisma.inventoryReservation.findMany({
      where: {
        workOrderId: workOrder.id,
        location: locationScope(actor),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        status: true,
        locationId: true,
        visitId: true,
        item: { select: { sku: true, name: true, unit: true } },
        location: { select: { name: true } },
      },
    }),
    prisma.inventoryLocation.findMany({
      where: { ...locationScope(actor), isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.inventoryItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, unit: true },
      take: 500,
    }),
    prisma.visit.findMany({
      where: { workOrderId: workOrder.id },
      orderBy: { startsAt: "asc" },
      select: { id: true, sequence: true, startsAt: true, status: true },
      take: 100,
    }),
  ]);

  return ok({
    workOrder,
    locations,
    items,
    visits,
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      itemId: reservation.itemId,
      sku: reservation.item.sku,
      name: reservation.item.name,
      unit: reservation.item.unit,
      quantity: decimalToNumber(reservation.quantity),
      status: reservation.status,
      locationId: reservation.locationId,
      locationName: reservation.location.name,
      visitId: reservation.visitId,
    })),
  });
}
