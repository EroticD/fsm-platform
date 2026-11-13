// i18n-ignore-file: revisjonshandlinger er lagrede driftsdata, ikke UI-tekst.
import { createHash } from "node:crypto";
import { Prisma, type WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDateOnly, toDateOnly } from "@/lib/dates";
import {
  MAX_LINES,
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  calculateDocument,
  normalizeVatRate,
  parseMoney,
} from "@/lib/billing";
import { cleanMarkdown, cleanText, LIMITS } from "@/lib/sanitize";
import type { AccessUser } from "@/lib/access";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "@/server/actor";
import { createWorkOrder } from "./work-orders";
import type { ErrorCode } from "@/lib/error-codes";

/**
 * Innmeldte ordrer fra andre ordresystemer.
 *
 * En ekstern ordre er en tynn, idempotent referanse rundt et vanlig oppdrag.
 * `(source, externalId)` er alltid idempotensnøkkelen; `Idempotency-Key` kan i
 * tillegg brukes som sekundær nøkkel. Oppdraget og referansen opprettes i samme
 * transaksjon, slik at en kollisjon eller feil aldri etterlater et oppdrag uten
 * ekstern referanse – eller omvendt.
 *
 * Tjenesten gjenbruker `createWorkOrder`, og dermed også avdelingssperre,
 * rettighetskontroll, visitgenerering, SLA og revisjonslogg. Den innfører ingen
 * egen snarvei forbi modul- eller rettighetssjekker.
 */

export const EXTERNAL_ORDER_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;

export type ExternalOrderPriority = (typeof EXTERNAL_ORDER_PRIORITIES)[number];

export function isExternalOrderPriority(
  value: string,
): value is ExternalOrderPriority {
  return (EXTERNAL_ORDER_PRIORITIES as readonly string[]).includes(value);
}

export const EXTERNAL_ORDER_ERROR_CODES = {
  invalidPayload: "orders.invalidPayload",
  customerRequired: "orders.customerRequired",
  idempotencyConflict: "orders.idempotencyConflict",
  invalidPriority: "orders.invalidPriority",
  invalidDate: "orders.invalidDate",
  invalidLines: "orders.invalidLines",
} as const satisfies Record<string, ErrorCode>;

export type ExternalOrderLine = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  lineTotal: string;
  lineVat: string;
};

export type ExternalOrderView = {
  id: string;
  source: string;
  externalId: string;
  idempotencyKey: string | null;
  priority: ExternalOrderPriority | null;
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
  totals: {
    currency: string;
    subtotal: string;
    vatTotal: string;
    total: string;
  };
  lines: ExternalOrderLine[];
  workOrder: {
    id: string;
    reference: string;
    orderNumber: string | null;
    title: string;
    status: string;
    scheduledFor: string | null;
    scheduledTo: string | null;
    customerId: string | null;
    department: { id: string; name: string };
  };
};

export type ExternalOrderDetail = ExternalOrderView & {
  payload: Prisma.JsonValue | null;
};

export type CreateExternalOrderInput = {
  source: unknown;
  externalId: unknown;
  idempotencyKey?: string | null;
  customerId?: unknown;
  customerNumber?: unknown;
  orgNumber?: unknown;
  siteId?: unknown;
  departmentId?: unknown;
  title?: unknown;
  description?: unknown;
  requestedDate?: unknown;
  scheduledFor?: unknown;
  priority?: unknown;
  lines?: unknown;
  payload?: unknown;
};

export type CreateExternalOrderResult = {
  id: string;
  workOrderId: string;
  reference: string;
  replay: boolean;
};

type NormalizedLine = {
  description: string;
  quantity: Prisma.Decimal;
  unit: string;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
};

const EXTERNAL_ORDER_SELECT = {
  id: true,
  source: true,
  externalId: true,
  idempotencyKey: true,
  priority: true,
  requestHash: true,
  receivedAt: true,
  createdAt: true,
  updatedAt: true,
  payload: true,
  lines: true,
  workOrder: {
    select: {
      id: true,
      reference: true,
      orderNumber: true,
      title: true,
      status: true,
      scheduledFor: true,
      scheduledTo: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ExternalOrderSelect;

type ExternalOrderRow = Prisma.ExternalOrderGetPayload<{
  select: typeof EXTERNAL_ORDER_SELECT;
}>;

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (parseDateOnly(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizePriority(value: unknown): ExternalOrderPriority | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return isExternalOrderPriority(normalized) ? normalized : undefined;
}

function normalizeLines(raw: unknown): NormalizedLine[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_LINES) return null;
  const result: NormalizedLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const line = entry as Record<string, unknown>;
    const description = cleanText(line.description, { maxLength: LIMITS.title });
    const quantity = parseMoney(line.quantity);
    const unitPrice = parseMoney(line.unitPrice);
    if (!description || !quantity || !unitPrice) return null;
    if (quantity.lte(0) || quantity.gt(MAX_QUANTITY)) return null;
    if (unitPrice.lt(0) || unitPrice.gt(MAX_UNIT_PRICE)) return null;
    result.push({
      description,
      quantity,
      unit: cleanText(line.unit, { maxLength: 20 }) || "stk",
      unitPrice,
      vatRate: new Prisma.Decimal(normalizeVatRate(line.vatRate, 25)),
    });
  }
  return result;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function lineTotals(lines: NormalizedLine[]) {
  return calculateDocument(
    lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
    })),
    "25",
  );
}

function linesJson(lines: NormalizedLine[]) {
  const calculated = lineTotals(lines);
  return {
    lines: calculated.lines.map((line) => ({
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity).toFixed(2),
      unit: line.unit,
      unitPrice: new Prisma.Decimal(line.unitPrice).toFixed(2),
      vatRate: new Prisma.Decimal(line.vatRate).toFixed(2),
      lineTotal: new Prisma.Decimal(line.lineTotal).toFixed(2),
      lineVat: new Prisma.Decimal(line.lineVat).toFixed(2),
    })),
    totals: {
      currency: "NOK",
      subtotal: calculated.subtotal,
      vatTotal: calculated.vatTotal,
      total: calculated.total,
    },
  };
}

type StoredLines = {
  lines?: Array<Record<string, unknown>>;
  totals?: {
    currency?: string;
    subtotal?: string;
    vatTotal?: string;
    total?: string;
  };
};

function readStoredLines(value: Prisma.JsonValue | null): StoredLines {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as unknown as StoredLines;
}

function toLineViews(value: Prisma.JsonValue | null): ExternalOrderLine[] {
  const stored = readStoredLines(value);
  if (!Array.isArray(stored.lines)) return [];
  return stored.lines.map((line) => ({
    description: String(line.description ?? ""),
    quantity: String(line.quantity ?? "0"),
    unit: String(line.unit ?? "stk"),
    unitPrice: String(line.unitPrice ?? "0"),
    vatRate: String(line.vatRate ?? "0"),
    lineTotal: String(line.lineTotal ?? "0"),
    lineVat: String(line.lineVat ?? "0"),
  }));
}

function toView(row: ExternalOrderRow): ExternalOrderView {
  const stored = readStoredLines(row.lines);
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    idempotencyKey: row.idempotencyKey,
    priority: row.priority && isExternalOrderPriority(row.priority)
      ? row.priority
      : null,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    customer: row.workOrder.customer,
    site: row.workOrder.site,
    totals: {
      currency: stored.totals?.currency ?? "NOK",
      subtotal: stored.totals?.subtotal ?? "0.00",
      vatTotal: stored.totals?.vatTotal ?? "0.00",
      total: stored.totals?.total ?? "0.00",
    },
    lines: toLineViews(row.lines),
    workOrder: {
      id: row.workOrder.id,
      reference: row.workOrder.reference,
      orderNumber: row.workOrder.orderNumber,
      title: row.workOrder.title,
      status: row.workOrder.status,
      scheduledFor: row.workOrder.scheduledFor
        ? toDateOnly(row.workOrder.scheduledFor)
        : null,
      scheduledTo: row.workOrder.scheduledTo
        ? toDateOnly(row.workOrder.scheduledTo)
        : null,
      customerId: row.workOrder.customerId,
      department: row.workOrder.department,
    },
  };
}

function toDetail(row: ExternalOrderRow): ExternalOrderDetail {
  return { ...toView(row), payload: row.payload ?? null };
}

async function resolveCustomer(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  input: CreateExternalOrderInput,
): Promise<
  | { id: string; name: string; departmentId: string | null }
  | { error: "not_found" | "required" }
> {
  const customerId = cleanText(input.customerId, { maxLength: LIMITS.line });
  const customerNumber = cleanText(input.customerNumber, {
    maxLength: LIMITS.line,
  });
  const orgNumber = cleanText(input.orgNumber, { maxLength: LIMITS.line });

  if (!customerId && !customerNumber && !orgNumber) {
    return { error: "required" };
  }

  const customer = await tx.customer.findFirst({
    where: {
      deletedAt: null,
      ...(customerId
        ? { id: customerId }
        : orgNumber
          ? { orgNumber }
          : { customerNumber }),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, departmentId: true },
  });
  if (!customer) return { error: "not_found" };

  // En vanlig ansatt kan ikke melde inn ordre på en kunde i en annen avdeling.
  // Administrator er den eneste som ser alle avdelinger.
  if (
    actor.role !== "ADMIN" &&
    actor.departmentId &&
    customer.departmentId &&
    customer.departmentId !== actor.departmentId
  ) {
    return { error: "not_found" };
  }

  return customer;
}

function buildDescription(
  description: string,
  priority: ExternalOrderPriority | null,
  lines: NormalizedLine[],
): string {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (priority) parts.push(`Prioritet: ${priority}`);
  if (lines.length > 0) {
    parts.push(
      lines
        .map(
          (line) =>
            `• ${line.description}: ${line.quantity.toString()} ${line.unit} × ${line.unitPrice.toString()}`,
        )
        .join("\n"),
    );
  }
  return parts.join("\n\n").slice(0, LIMITS.markdown);
}

async function findExisting(
  client: Prisma.TransactionClient | typeof prisma,
  source: string,
  externalId: string,
  idempotencyKey: string | null,
) {
  return client.externalOrder.findFirst({
    where: {
      source,
      OR: [
        { externalId },
        ...(idempotencyKey ? [{ idempotencyKey }] : []),
      ],
    },
    select: {
      id: true,
      workOrderId: true,
      requestHash: true,
      workOrder: { select: { reference: true } },
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Oppretter eller replay-er en ekstern ordre. */
export async function createExternalOrder(
  actor: ServiceActor,
  input: CreateExternalOrderInput,
): Promise<ServiceResult<CreateExternalOrderResult>> {
  if (!actor.isActive || !can(actor, "workorders.create")) {
    return fail("forbidden");
  }

  const source = cleanText(input.source, { maxLength: 64 });
  const externalId = cleanText(input.externalId, { maxLength: LIMITS.line });
  const idempotencyKey =
    cleanText(input.idempotencyKey, { maxLength: LIMITS.line }) || null;
  if (!source || !externalId) {
    return fail("invalid", { code: EXTERNAL_ORDER_ERROR_CODES.invalidPayload });
  }

  const title = cleanText(input.title, { maxLength: LIMITS.title });
  if (!title) {
    return fail("invalid", { code: EXTERNAL_ORDER_ERROR_CODES.invalidPayload });
  }

  const requestedDate =
    normalizeDate(input.requestedDate) ?? normalizeDate(input.scheduledFor);
  if (!requestedDate) {
    return fail("invalid", { code: EXTERNAL_ORDER_ERROR_CODES.invalidDate });
  }

  const priority = normalizePriority(input.priority);
  if (priority === undefined) {
    return fail("invalid", { code: EXTERNAL_ORDER_ERROR_CODES.invalidPriority });
  }

  const lines = normalizeLines(input.lines);
  if (!lines) {
    return fail("invalid", { code: EXTERNAL_ORDER_ERROR_CODES.invalidLines });
  }

  const description = cleanMarkdown(input.description) || "";
  const siteId = cleanText(input.siteId, { maxLength: LIMITS.line }) || null;
  const departmentId =
    cleanText(input.departmentId, { maxLength: LIMITS.line }) || null;
  const payload =
    input.payload === undefined ? null : (input.payload as Prisma.JsonValue);

  const requestHash = sha256(
    JSON.stringify({
      source,
      externalId,
      customerId: cleanText(input.customerId, { maxLength: LIMITS.line }),
      customerNumber: cleanText(input.customerNumber, {
        maxLength: LIMITS.line,
      }),
      orgNumber: cleanText(input.orgNumber, { maxLength: LIMITS.line }),
      siteId,
      departmentId,
      title,
      description,
      requestedDate,
      priority,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity.toFixed(2),
        unit: line.unit,
        unitPrice: line.unitPrice.toFixed(2),
        vatRate: line.vatRate.toFixed(2),
      })),
      payload,
    }),
  );

  // Rask replay uten å åpne en skrivetransaksjon. Den autoritative kontrollen
  // gjøres likevel inne i transaksjonen under.
  const early = await findExisting(prisma, source, externalId, idempotencyKey);
  if (early) {
    if (early.requestHash !== requestHash) {
      return fail("conflict", {
        code: EXTERNAL_ORDER_ERROR_CODES.idempotencyConflict,
      });
    }
    return ok({
      id: early.id,
      workOrderId: early.workOrderId,
      reference: early.workOrder.reference,
      replay: true,
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await findExisting(tx, source, externalId, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return fail("conflict", {
            code: EXTERNAL_ORDER_ERROR_CODES.idempotencyConflict,
          });
        }
        return ok({
          id: existing.id,
          workOrderId: existing.workOrderId,
          reference: existing.workOrder.reference,
          replay: true,
        });
      }

      const customer = await resolveCustomer(tx, actor, input);
      if ("error" in customer) {
        return customer.error === "required"
          ? fail("invalid", {
              code: EXTERNAL_ORDER_ERROR_CODES.customerRequired,
            })
          : fail("not_found");
      }

      if (siteId) {
        const site = await tx.customerSite.findFirst({
          where: { id: siteId, customerId: customer.id },
          select: { id: true },
        });
        if (!site) return fail("invalid", { code: "orders.invalidSite" satisfies ErrorCode });
      }

      const workOrder = await createWorkOrder(
        actor as unknown as AccessUser,
        {
          title,
          description: buildDescription(description, priority, lines),
          departmentId: departmentId ?? customer.departmentId ?? "",
          customerId: customer.id,
          contactId: "",
          siteId: siteId ?? "",
          scheduledFor: requestedDate,
          scheduledTo: "",
          technicianIds: [],
          templateIds: [],
          tagNames: [],
        },
        { tx },
      );
      if (!workOrder.ok) return fail("invalid", { code: workOrder.error });

      const stored = linesJson(lines);
      const externalOrder = await tx.externalOrder.create({
        data: {
          source,
          externalId,
          idempotencyKey,
          workOrderId: workOrder.id,
          priority,
          requestHash,
          ...(payload === null
            ? {}
            : { payload: payload as Prisma.InputJsonValue }),
          lines: stored as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "ExternalOrder",
        entityId: externalOrder.id,
        action: `Mottok ekstern ordre ${source}/${externalId}`,
        actor: toAuditActor(actor),
        departmentId: customer.departmentId,
        metadata: {
          source,
          externalId,
          workOrderId: workOrder.id,
          priority,
          lineCount: lines.length,
        },
      });

      const mapped = await tx.workOrder.findUnique({
        where: { id: workOrder.id },
        select: { reference: true },
      });

      return ok({
        id: externalOrder.id,
        workOrderId: workOrder.id,
        reference: mapped?.reference ?? "",
        replay: false,
      });
    });
    return created;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findExisting(prisma, source, externalId, idempotencyKey);
    if (existing && existing.requestHash === requestHash) {
      return ok({
        id: existing.id,
        workOrderId: existing.workOrderId,
        reference: existing.workOrder.reference,
        replay: true,
      });
    }
    return fail("conflict", {
      code: EXTERNAL_ORDER_ERROR_CODES.idempotencyConflict,
    });
  }
}

export async function listExternalOrders(
  actor: ServiceActor,
  options: {
    source?: string;
    status?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<ServiceResult<{ orders: ExternalOrderView[]; total: number }>> {
  if (!actor.isActive || !can(actor, "workorders.view")) {
    return fail("forbidden");
  }
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const source = cleanText(options.source, { maxLength: 64 });
  const status = cleanText(options.status, { maxLength: 30 });

  const where: Prisma.ExternalOrderWhereInput = {
    AND: [
      source ? { source } : {},
      status ? { workOrder: { status: status as WorkStatus } } : {},
      { workOrder: { is: workOrderScopeFor(actor) } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.externalOrder.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: EXTERNAL_ORDER_SELECT,
    }),
    prisma.externalOrder.count({ where }),
  ]);

  return ok({ orders: rows.map(toView), total });
}

export async function getExternalOrder(
  actor: ServiceActor,
  id: string,
): Promise<ServiceResult<ExternalOrderDetail>> {
  if (!actor.isActive || !can(actor, "workorders.view")) {
    return fail("forbidden");
  }
  const clean = cleanText(id, { maxLength: LIMITS.line });
  if (!clean) return fail("not_found");
  const row = await prisma.externalOrder.findFirst({
    where: {
      id: clean,
      workOrder: { is: workOrderScopeFor(actor) },
    },
    select: EXTERNAL_ORDER_SELECT,
  });
  if (!row) return fail("not_found");
  return ok(toDetail(row));
}

/** Statusendring eller kansellering av det underliggende oppdraget. */
export async function updateExternalOrder(
  actor: ServiceActor,
  id: string,
  input: { status?: unknown; reason?: unknown },
): Promise<ServiceResult<ExternalOrderDetail>> {
  if (!actor.isActive || !can(actor, "workorders.update")) {
    return fail("forbidden");
  }
  const clean = cleanText(id, { maxLength: LIMITS.line });
  if (!clean) return fail("not_found");

  const row = await prisma.externalOrder.findFirst({
    where: {
      id: clean,
      workOrder: { is: workOrderScopeFor(actor) },
    },
    select: { id: true, workOrderId: true },
  });
  if (!row) return fail("not_found");

  // Kansellering er en kontorhandling og krever workorders.edit, på samme måte
  // som i kontorflaten.
  if (
    String(input.status ?? "").toUpperCase() === "CANCELLED" &&
    !can(actor, "workorders.edit")
  ) {
    return fail("forbidden");
  }

  const { changeWorkOrderStatus } = await import("./work-orders");
  const result = await changeWorkOrderStatus(
    actor as unknown as AccessUser,
    row.workOrderId,
    input.status,
    "office",
    input.reason,
  );
  if (!result.ok) {
    if (result.error === "ikke-tilgang") {
      return fail("forbidden");
    }
    if (result.error === "ikke-funnet") {
      return fail("not_found");
    }
    if (
      result.error === "workorder-locked" ||
      result.error === "legal-hold" ||
      result.error === "duplikat-ordrenummer"
    ) {
      return fail("conflict", { code: result.error });
    }
    return fail("invalid", { code: result.error });
  }

  const updated = await prisma.externalOrder.findFirst({
    where: {
      id: clean,
      workOrder: { is: workOrderScopeFor(actor) },
    },
    select: EXTERNAL_ORDER_SELECT,
  });
  if (!updated) return fail("not_found");
  return ok(toDetail(updated));
}
