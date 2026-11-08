// i18n-ignore-file: revisjonshandlinger er lagrede driftsdata, ikke UI-tekst.
import { Prisma, PaymentMethod, type InvoiceStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { getDefaultDepartmentId } from "@/lib/departments";
import { addDaysUtc, parseDateOnly, todayUtc, toDateOnly } from "@/lib/dates";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { toCsv } from "@/lib/csv";
import {
  MAX_LINES,
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  calculateDocument,
  deriveInvoiceStatus,
  normalizeVatRate,
  parseMoney,
  payableAmount,
  roundMoney,
  type RawLine,
} from "@/lib/billing";
import {
  BILLING_AMOUNT_FIELDS,
  CUSTOMER_CONTACT_FIELDS,
  fieldAccess,
  redactRecord,
} from "@/lib/field-rbac";
import { resolvePortalAccess } from "./portal-access";
import { quoteScopeFor } from "./quotes";
import { assertModule } from "./modules";
import { notifyUser } from "./notifications";
import {
  enqueueInvoiceSentEmail,
  enqueuePaymentReceivedEmail,
} from "./email-outbox";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "./actor";

/**
 * Fakturatjenesten.
 *
 * Ingen ekstern betalingsleverandør er koblet på i v1. Betalinger registreres
 * manuelt (bankoverføring, kontant eller annet), og kunden kan se status i
 * kundeportalen. Alle totaler regnes om på serveren.
 */

export const INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CREDITED",
] as const;

export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];
export const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "OTHER", "ONLINE"] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export function isInvoiceStatus(value: string): value is InvoiceStatusValue {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isPaymentMethod(value: string): value is PaymentMethodValue {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export type InvoiceInput = {
  customerId?: unknown;
  contactId?: unknown;
  workOrderId?: unknown;
  reportId?: unknown;
  quoteId?: unknown;
  departmentId?: unknown;
  issueDate?: unknown;
  dueDate?: unknown;
  notes?: unknown;
  vatRate?: unknown;
  lines?: unknown;
};

export type InvoiceListFilters = {
  status?: InvoiceStatusValue | null;
  overdue?: boolean;
  customerId?: string;
  query?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

function id(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function optionalId(value: unknown): string | null {
  return id(value) || null;
}

export function invoiceScopeFor(actor: ServiceActor): Prisma.InvoiceWhereInput {
  if (!actor.isActive) return { id: { in: [] } };
  if (actor.role === "ADMIN") return {};
  if (actor.role === "CUSTOMER") {
    return {
      customerId: actor.customerId ?? "__none__",
      status: { in: ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDITED"] },
    };
  }
  if (
    !can(actor, "customers.view") &&
    !can(actor, "customers.manage") &&
    !can(actor, "workorders.view")
  ) {
    return { id: { in: [] } };
  }
  if (!actor.departmentId) return { id: { in: [] } };
  return {
    departmentId: actor.departmentId,
    department: { isActive: true },
  };
}

function canManageInvoices(actor: ServiceActor): boolean {
  return actor.isActive && (isAdminActor(actor) || can(actor, "customers.manage"));
}

function requireManage(actor: ServiceActor): ServiceFailure | null {
  if (!canManageInvoices(actor)) return fail("forbidden");
  return null;
}

/**
 * Feltnivå-RBAC for fakturabeløp. ADMIN/OFFICE og kunden selv ser alt;
 * montører og andre interne uten eksplisitt feltilgang får maskerte beløp.
 * Feltnavnene settes til null, og `redactedFields` forteller UI/API hvorfor.
 */
function redactInvoiceAmounts<T extends object>(
  actor: ServiceActor,
  invoice: T,
  customerId: string | null,
): T {
  return redactRecord(actor, invoice, {
    group: "billingAmounts",
    fields: BILLING_AMOUNT_FIELDS,
    customerId,
  }) as T;
}

export async function getBillingSettings() {
  const existing = await prisma.billingSettings.findUnique({
    where: { id: "default" },
  });
  if (existing) return existing;
  return prisma.billingSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

type NormalizedLine = {
  description: string;
  quantity: Prisma.Decimal;
  unit: string;
  unitPrice: Prisma.Decimal;
  vatRate: Prisma.Decimal;
};

function normalizeLines(raw: unknown, fallbackVatRate: unknown): NormalizedLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const result: NormalizedLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const line = entry as Record<string, unknown>;
    const description = cleanText(line.description, { maxLength: LIMITS.title });
    const quantity = parseMoney(line.quantity);
    const unitPrice = parseMoney(line.unitPrice);
    if (!description || !quantity || !unitPrice) return null;
    if (quantity.lte(0) || quantity.gt(MAX_QUANTITY)) return null;
    if (unitPrice.lt(0) || unitPrice.gt(MAX_UNIT_PRICE)) return null;
    const vatRate = new Prisma.Decimal(
      normalizeVatRate(line.vatRate, Number(normalizeVatRate(fallbackVatRate))),
    );
    result.push({
      description,
      quantity,
      unit: cleanText(line.unit, { maxLength: LIMITS.short }) || "stk",
      unitPrice,
      vatRate,
    });
  }
  return result;
}

function toRawLines(lines: NormalizedLine[]): RawLine[] {
  return lines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    vatRate: line.vatRate,
  }));
}

async function resolveDepartment(
  actor: ServiceActor,
  requested: unknown,
  workOrderDepartmentId: string | null,
  customerDepartmentId: string | null,
): Promise<string | null> {
  if (!isAdminActor(actor)) {
    if (!actor.departmentId) return null;
    const department = await prisma.department.findFirst({
      where: { id: actor.departmentId, isActive: true },
      select: { id: true },
    });
    return department?.id ?? null;
  }
  for (const candidate of [optionalId(requested), workOrderDepartmentId, customerDepartmentId]) {
    if (!candidate) continue;
    const department = await prisma.department.findFirst({
      where: { id: candidate, isActive: true },
      select: { id: true },
    });
    if (department) return department.id;
  }
  return getDefaultDepartmentId();
}

function invoiceNumberFor(prefix: string, sequence: number, issueDate: Date): string {
  const year = issueDate.getUTCFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  issueDate: Date,
): Promise<string> {
  const settings = await tx.billingSettings.update({
    where: { id: "default" },
    data: { nextInvoiceNumber: { increment: 1 } },
    select: { invoicePrefix: true, nextInvoiceNumber: true },
  });
  return invoiceNumberFor(
    cleanText(settings.invoicePrefix, { maxLength: 20 }) || "F",
    settings.nextInvoiceNumber - 1,
    issueDate,
  );
}

async function allocateCreditNoteNumber(
  tx: Prisma.TransactionClient,
  issuedAt: Date,
): Promise<string> {
  const settings = await tx.billingSettings.update({
    where: { id: "default" },
    data: { nextCreditNoteNumber: { increment: 1 } },
    select: { creditNotePrefix: true, nextCreditNoteNumber: true },
  });
  return invoiceNumberFor(
    cleanText(settings.creditNotePrefix, { maxLength: 20 }) || "K",
    settings.nextCreditNoteNumber - 1,
    issuedAt,
  );
}

async function writeInvoiceLines(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  calculated: ReturnType<typeof calculateDocument>,
): Promise<void> {
  await tx.invoiceLine.deleteMany({ where: { invoiceId } });
  if (calculated.lines.length === 0) return;
  await tx.invoiceLine.createMany({
    data: calculated.lines.map((line) => ({
      invoiceId,
      sortOrder: line.sortOrder,
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity),
      unit: line.unit,
      unitPrice: new Prisma.Decimal(line.unitPrice),
      vatRate: new Prisma.Decimal(line.vatRate),
      lineTotal: new Prisma.Decimal(line.lineTotal),
      lineVat: new Prisma.Decimal(line.lineVat),
    })),
  });
}

type SourceContext = {
  customerId: string;
  contactId: string | null;
  workOrderId: string | null;
  reportId: string | null;
  quoteId: string | null;
  departmentId: string | null;
  sourceLabel: string;
  quoteLines?: NormalizedLine[];
};

async function resolveSource(
  actor: ServiceActor,
  input: InvoiceInput,
): Promise<SourceContext | { error: "invalid" | "not_found" | "conflict" }> {
  const quoteId = optionalId(input.quoteId);
  const workOrderId = optionalId(input.workOrderId);
  const reportId = optionalId(input.reportId);
  let customerId = optionalId(input.customerId);
  let contactId = optionalId(input.contactId);
  let resolvedWorkOrderId = workOrderId;
  let departmentId: string | null = null;
  let sourceLabel = "manuell faktura";
  let quoteLines: NormalizedLine[] | undefined;
  // En faktura fra et tilbud skal ikke kreve at et eventuelt koblet oppdrag
  // allerede er fullført. Kravet gjelder når oppdraget/rapporten er kilden.
  const requiresCompletedWorkOrder = Boolean(workOrderId || reportId);

  if (quoteId) {
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, AND: [quoteScopeFor(actor)] },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    if (!quote) return { error: "not_found" };
    if (quote.status !== "ACCEPTED") return { error: "conflict" };
    if (quote.customerId) {
      if (customerId && customerId !== quote.customerId) return { error: "invalid" };
      customerId = quote.customerId;
    }
    if (!customerId) return { error: "invalid" };
    contactId = contactId ?? quote.contactId;
    departmentId = quote.departmentId;
    resolvedWorkOrderId = resolvedWorkOrderId ?? quote.workOrderId;
    sourceLabel = `tilbud ${quote.quoteNumber ?? quote.title}`;
    quoteLines = quote.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
    }));
  }

  if (reportId) {
    const report = await prisma.report.findFirst({
      where: { id: reportId, deletedAt: null },
      select: {
        id: true,
        name: true,
        templateTitle: true,
        workOrderId: true,
        workOrder: {
          select: {
            id: true,
            title: true,
            status: true,
            customerId: true,
            contactId: true,
            departmentId: true,
          },
        },
      },
    });
    if (!report) return { error: "not_found" };
    if (resolvedWorkOrderId && resolvedWorkOrderId !== report.workOrderId) return { error: "invalid" };
    if (report.workOrder.status !== "COMPLETED") return { error: "conflict" };
    resolvedWorkOrderId = report.workOrderId;
    customerId = customerId ?? report.workOrder.customerId;
    contactId = contactId ?? report.workOrder.contactId;
    departmentId = departmentId ?? report.workOrder.departmentId;
    sourceLabel = `rapport ${report.name ?? report.templateTitle ?? report.id}`;
  }

  if (resolvedWorkOrderId) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: resolvedWorkOrderId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        customerId: true,
        contactId: true,
        departmentId: true,
      },
    });
    if (!workOrder) return { error: "not_found" };
    if (requiresCompletedWorkOrder && workOrder.status !== "COMPLETED") {
      return { error: "conflict" };
    }
    if (customerId && workOrder.customerId && customerId !== workOrder.customerId) {
      return { error: "invalid" };
    }
    customerId = customerId ?? workOrder.customerId;
    contactId = contactId ?? workOrder.contactId;
    departmentId = departmentId ?? workOrder.departmentId;
    if (!reportId) sourceLabel = `oppdrag ${workOrder.title}`;
  }

  if (!customerId) return { error: "invalid" };
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, departmentId: true },
  });
  if (!customer) return { error: "not_found" };
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, customerId },
      select: { id: true },
    });
    if (!contact) return { error: "invalid" };
  }

  const resolvedDepartmentId = await resolveDepartment(
    actor,
    input.departmentId,
    departmentId,
    customer.departmentId,
  );
  if (!resolvedDepartmentId) return { error: "invalid" };

  return {
    customerId,
    contactId,
    workOrderId: resolvedWorkOrderId,
    reportId,
    quoteId,
    departmentId: resolvedDepartmentId,
    sourceLabel,
    quoteLines,
  };
}

export type InvoiceListItem = {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  issueDate: Date | null;
  dueDate: Date | null;
  total: Prisma.Decimal;
  paidTotal: Prisma.Decimal;
  creditedTotal: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  currency: string;
  customer: { id: string; name: string };
  workOrder: { id: string; title: string } | null;
  lines: Array<{ description: string }>;
};

export async function listInvoices(
  actor: ServiceActor,
  options: InvoiceListFilters = {},
): Promise<ServiceResult<{ invoices: InvoiceListItem[]; total: number }>> {
  if (!actor.isActive) return fail("forbidden");
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 25));
  const query = cleanText(options.query, { maxLength: 100 });
  const from = options.from ? parseDateOnly(options.from) : null;
  const to = options.to ? parseDateOnly(options.to) : null;
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      invoiceScopeFor(actor),
      options.status ? { status: options.status } : {},
      options.overdue ? { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { lt: todayUtc() } } : {},
      options.customerId ? { customerId: options.customerId } : {},
      from ? { issueDate: { gte: from } } : {},
      to ? { issueDate: { lte: to } } : {},
      query
        ? {
            OR: [
              { invoiceNumber: { contains: query, mode: "insensitive" } },
              { customer: { name: { contains: query, mode: "insensitive" } } },
              { workOrder: { title: { contains: query, mode: "insensitive" } } },
              { lines: { some: { description: { contains: query, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        dueDate: true,
        total: true,
        paidTotal: true,
        creditedTotal: true,
        outstanding: true,
        currency: true,
        customer: { select: { id: true, name: true } },
        workOrder: { select: { id: true, title: true } },
        lines: { orderBy: { sortOrder: "asc" }, take: 1, select: { description: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);
  return ok({
    invoices: invoices.map((invoice) =>
      redactInvoiceAmounts(actor, invoice, invoice.customer.id),
    ),
    total,
  });
}

export async function getInvoice(actor: ServiceActor, invoiceId: string) {
  const cleanId = id(invoiceId);
  if (!cleanId) return fail("not_found");
  const invoice = await prisma.invoice.findFirst({
    where: { id: cleanId, AND: [invoiceScopeFor(actor)] },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }] },
      creditNotes: { orderBy: { issuedAt: "desc" } },
      accountingSyncs: { orderBy: { updatedAt: "desc" }, take: 1 },
      customer: {
        select: {
          id: true,
          name: true,
          customerNumber: true,
          orgNumber: true,
          email: true,
          phone: true,
          address: true,
          postalCode: true,
          city: true,
        },
      },
      contact: { select: { id: true, name: true, email: true, phone: true } },
      department: { select: { id: true, name: true } },
      workOrder: { select: { id: true, title: true, reference: true, status: true } },
      report: { select: { id: true, name: true, reportNumber: true } },
      quote: { select: { id: true, quoteNumber: true, title: true } },
    },
  });
  if (!invoice) return fail("not_found");
  const contact = invoice.contact
    ? redactRecord(actor, invoice.contact, {
        group: "customerContact",
        fields: CUSTOMER_CONTACT_FIELDS,
        customerId: invoice.customerId,
      })
    : null;
  return ok({
    ...redactInvoiceAmounts(actor, invoice, invoice.customerId),
    customer: redactRecord(actor, invoice.customer, {
      group: "customerContact",
      fields: CUSTOMER_CONTACT_FIELDS,
      customerId: invoice.customerId,
    }),
    contact,
  });
}

export async function createInvoice(
  actor: ServiceActor,
  input: InvoiceInput,
): Promise<ServiceResult<{ id: string }>> {
  await assertModule("invoicing");
  const denied = requireManage(actor);
  if (denied) return denied;

  const source = await resolveSource(actor, input);
  if ("error" in source) return fail(source.error);

  const settings = await getBillingSettings();
  const vatRate = normalizeVatRate(input.vatRate, Number(settings.vatRate));
  const provided = Array.isArray(input.lines) ? input.lines : [];
  const rawLines = provided.length > 0 ? provided : source.quoteLines;
  const lines = normalizeLines(rawLines, vatRate);
  if (!lines) return fail("invalid");

  const issueDateInput = id(input.issueDate);
  const issueDate = issueDateInput ? parseDateOnly(issueDateInput) : todayUtc();
  if (!issueDate) return fail("invalid");
  const dueDateInput = id(input.dueDate);
  const dueDate = dueDateInput
    ? parseDateOnly(dueDateInput)
    : addDaysUtc(issueDate, Math.max(0, Math.min(365, settings.invoiceDueDays)));
  if (!dueDate || dueDate < issueDate) return fail("invalid");

  const calculated = calculateDocument(toRawLines(lines), vatRate);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          status: "DRAFT",
          customerId: source.customerId,
          contactId: source.contactId ?? undefined,
          departmentId: source.departmentId!,
          workOrderId: source.workOrderId ?? undefined,
          reportId: source.reportId ?? undefined,
          quoteId: source.quoteId ?? undefined,
          currency: "NOK",
          subtotal: new Prisma.Decimal(calculated.subtotal),
          vatTotal: new Prisma.Decimal(calculated.vatTotal),
          total: new Prisma.Decimal(calculated.total),
          outstanding: new Prisma.Decimal(calculated.total),
          vatRate: new Prisma.Decimal(vatRate),
          issueDate,
          dueDate,
          notes: cleanMarkdown(input.notes) || null,
          createdById: actor.id,
          createdByName: actor.name || actor.email || null,
        },
        select: { id: true },
      });
      await writeInvoiceLines(tx, invoice.id, calculated);
      await audit(tx, {
        entityType: "Invoice",
        entityId: invoice.id,
        action: `Opprettet fakturakladd fra ${source.sourceLabel}`.slice(0, 200),
        actor: toAuditActor(actor),
        metadata: {
          customerId: source.customerId,
          workOrderId: source.workOrderId,
          quoteId: source.quoteId,
          total: calculated.total,
        },
      });
      return invoice;
    });
    return ok({ id: created.id });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict", { code: "invoice.duplicate" });
    throw error;
  }
}

/** Redigerer en fakturakladd. Sendte fakturaer er frosne. */
export async function updateInvoice(
  actor: ServiceActor,
  invoiceId: string,
  input: InvoiceInput,
): Promise<ServiceResult<{ id: string }>> {
  await assertModule("invoicing");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(invoiceId);
  const current = await prisma.invoice.findFirst({
    where: { id: cleanId, AND: [invoiceScopeFor(actor)] },
    select: { id: true, status: true, customerId: true, workOrderId: true, reportId: true, quoteId: true },
  });
  if (!current) return fail("not_found");
  if (current.status !== "DRAFT") return fail("conflict", { code: "invoice.locked" });

  const source = await resolveSource(actor, {
    ...input,
    customerId: input.customerId ?? current.customerId,
    workOrderId: input.workOrderId ?? current.workOrderId,
    reportId: input.reportId ?? current.reportId,
    quoteId: input.quoteId ?? current.quoteId,
  });
  if ("error" in source) return fail(source.error);
  const settings = await getBillingSettings();
  const vatRate = normalizeVatRate(input.vatRate, Number(settings.vatRate));
  const lines = normalizeLines(input.lines, vatRate);
  if (!lines) return fail("invalid");

  const issueDateInput = id(input.issueDate);
  const issueDate = issueDateInput ? parseDateOnly(issueDateInput) : todayUtc();
  if (!issueDate) return fail("invalid");
  const dueDateInput = id(input.dueDate);
  const dueDate = dueDateInput
    ? parseDateOnly(dueDateInput)
    : addDaysUtc(issueDate, Math.max(0, Math.min(365, settings.invoiceDueDays)));
  if (!dueDate || dueDate < issueDate) return fail("invalid");

  const calculated = calculateDocument(toRawLines(lines), vatRate);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.updateMany({
      where: { id: cleanId, status: "DRAFT" },
      data: {
        customerId: source.customerId,
        contactId: source.contactId ?? undefined,
        departmentId: source.departmentId!,
        workOrderId: source.workOrderId ?? undefined,
        reportId: source.reportId ?? undefined,
        quoteId: source.quoteId ?? undefined,
        subtotal: new Prisma.Decimal(calculated.subtotal),
        vatTotal: new Prisma.Decimal(calculated.vatTotal),
        total: new Prisma.Decimal(calculated.total),
        outstanding: new Prisma.Decimal(calculated.total),
        vatRate: new Prisma.Decimal(vatRate),
        issueDate,
        dueDate,
        notes: cleanMarkdown(input.notes) || null,
      },
    });
    if (updated.count === 0) return;
    await writeInvoiceLines(tx, cleanId, calculated);
    await audit(tx, {
      entityType: "Invoice",
      entityId: cleanId,
      action: "Oppdaterte fakturakladden",
      actor: toAuditActor(actor),
      metadata: { total: calculated.total, vatRate },
    });
  });
  return ok({ id: cleanId });
}

/** Sender fakturaen og tildeler et unikt, løpende fakturanummer. */
export async function sendInvoice(
  actor: ServiceActor,
  invoiceId: string,
): Promise<ServiceResult<{ invoiceNumber: string; alreadySent: boolean }>> {
  await assertModule("invoicing");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(invoiceId);
  if (!cleanId) return fail("not_found");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: cleanId, AND: [invoiceScopeFor(actor)] },
        select: {
          id: true,
          status: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          total: true,
        },
      });
      if (!invoice) return fail("not_found");

      // Idempotent: gjentatt «send» skal gi samme nummer, ikke et nytt.
      if (invoice.invoiceNumber) {
        return ok({ invoiceNumber: invoice.invoiceNumber, alreadySent: true });
      }
      if (invoice.status !== "DRAFT") return fail("conflict", { code: "invoice.notDraft" });

      const settings = await tx.billingSettings.findUnique({
        where: { id: "default" },
        select: { invoiceDueDays: true },
      });
      const issueDate = invoice.issueDate ?? todayUtc();
      const dueDate =
        invoice.dueDate ??
        addDaysUtc(issueDate, Math.max(0, Math.min(365, settings?.invoiceDueDays ?? 14)));
      const invoiceNumber = await allocateInvoiceNumber(tx, issueDate);

      // Den betingede oppdateringen gjør samtidige «send» idempotente: bare én
      // transaksjon får sette nummeret. Den andre leser det som allerede er satt.
      const updated = await tx.invoice.updateMany({
        where: { id: cleanId, status: "DRAFT", invoiceNumber: null },
        data: {
          invoiceNumber,
          status: "SENT",
          issueDate,
          dueDate,
          sentAt: new Date(),
        },
      });
      if (updated.count === 0) {
        const current = await tx.invoice.findUnique({
          where: { id: cleanId },
          select: { invoiceNumber: true },
        });
        return ok({ invoiceNumber: current?.invoiceNumber ?? invoiceNumber, alreadySent: true });
      }
      await audit(tx, {
        entityType: "Invoice",
        entityId: cleanId,
        action: `Sendte faktura ${invoiceNumber}`,
        actor: toAuditActor(actor),
        metadata: { invoiceNumber, total: invoice.total.toFixed(2) },
      });
      return ok({ invoiceNumber, alreadySent: false });
    });

    if (result.ok && !result.data.alreadySent) {
      const invoice = await prisma.invoice.findUnique({
        where: { id: cleanId },
        select: {
          id: true,
          invoiceNumber: true,
          customerId: true,
          contactId: true,
          currency: true,
          total: true,
          dueDate: true,
          customer: { select: { name: true } },
        },
      });
      if (invoice?.invoiceNumber) {
        await enqueueInvoiceSentEmail({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          contactId: invoice.contactId,
          customerName: invoice.customer?.name,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
        });
      }
    }

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict", { code: "invoice.duplicateNumber" });
    throw error;
  }
}

export type PaymentInput = {
  amount: unknown;
  paidAt?: unknown;
  method?: unknown;
  reference?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
  /** PSP-metadata. Settes bare av betalingswebhooken, aldri av skjemaet. */
  provider?: unknown;
  providerEventId?: unknown;
  providerReference?: unknown;
};

/**
 * Varsler kontoret i fakturaens avdeling når fakturaen blir fullt betalt.
 * Dedupe-nøkkelen gjør gjentatte betalingsforsøk idempotente. Selve
 * push-utsendelsen skjer i den vedvarende utboksen.
 */
async function notifyInvoicePaid(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      departmentId: true,
    },
  });
  if (!invoice?.departmentId) return;

  const recipients = await prisma.user.findMany({
    where: {
      departmentId: invoice.departmentId,
      role: { in: ["ADMIN", "OFFICE"] },
      isActive: true,
    },
    select: { id: true },
    take: 100,
  });

  const invoiceNumber = invoice.invoiceNumber ?? invoice.id.slice(-8);
  for (const recipient of recipients) {
    await notifyUser({
      userId: recipient.id,
      type: "INVOICE_PAID",
      titleKey: "push.notifications.invoicePaid.title",
      bodyKey: "push.notifications.invoicePaid.body",
      params: { invoiceNumber },
      href: `/faktura/${invoice.id}`,
      sourceLabel: `Faktura ${invoiceNumber}`,
      dedupeKey: `invoice-paid:${invoice.id}:${recipient.id}`,
    }).catch(() => undefined);
  }
}

/** Registrerer en manuell betaling. Delbetaling er normalen, ikke unntaket. */
export async function registerPayment(
  actor: ServiceActor,
  invoiceId: string,
  input: PaymentInput,
): Promise<ServiceResult<{ paymentId: string; duplicate: boolean; status: InvoiceStatusValue }>> {
  await assertModule("invoicing");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(invoiceId);
  if (!cleanId) return fail("not_found");

  const amount = parseMoney(input.amount);
  if (!amount || amount.lte(0)) return fail("invalid");
  const paidAtInput = id(input.paidAt);
  const paidAt = paidAtInput ? parseDateOnly(paidAtInput) : todayUtc();
  if (!paidAt) return fail("invalid");
  const methodText = cleanText(input.method, { maxLength: 30 }).toUpperCase() || "BANK_TRANSFER";
  if (!isPaymentMethod(methodText)) return fail("invalid");
  const method = methodText as PaymentMethodValue;
  const reference = cleanText(input.reference, { maxLength: LIMITS.line }) || null;
  const note = cleanText(input.note, { maxLength: LIMITS.text }) || null;
  const idempotencyKey = cleanText(input.idempotencyKey, { maxLength: 100 }) || null;
  const provider = cleanText(input.provider, { maxLength: 30 }).toLowerCase() || null;
  const providerEventId = cleanText(input.providerEventId, { maxLength: 200 }) || null;
  const providerReference = cleanText(input.providerReference, { maxLength: 200 }) || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: cleanId, AND: [invoiceScopeFor(actor)] },
        select: {
          id: true,
          status: true,
          total: true,
          paidTotal: true,
          creditedTotal: true,
          dueDate: true,
          issueDate: true,
        },
      });
      if (!invoice) return fail("not_found");

      if (idempotencyKey) {
        const existing = await tx.payment.findFirst({
          where: { invoiceId: cleanId, idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          return ok({
            paymentId: existing.id,
            duplicate: true,
            status: invoice.status as InvoiceStatusValue,
          });
        }
      }

      if (!["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status)) {
        return fail("conflict", { code: "invoice.notPayable" });
      }
      const outstanding = payableAmount(invoice);
      if (amount.gt(outstanding)) return fail("conflict", { code: "invoice.amountTooHigh" });

      const payment = await tx.payment.create({
        data: {
          invoiceId: cleanId,
          amount,
          paidAt,
          method: method as PaymentMethod,
          reference,
          note,
          idempotencyKey,
          provider,
          providerEventId,
          providerReference,
          createdById: actor.id,
        },
        select: { id: true },
      });

      const paidTotal = roundMoney(new Prisma.Decimal(invoice.paidTotal).add(amount));
      const outstandingAfter = roundMoney(
        new Prisma.Decimal(invoice.total)
          .sub(paidTotal)
          .sub(invoice.creditedTotal),
      );
      const nextStatus = deriveInvoiceStatus(
        {
          total: invoice.total,
          paidTotal,
          creditedTotal: invoice.creditedTotal,
          dueDate: invoice.dueDate,
          issueDate: invoice.issueDate,
        },
        "SENT",
        todayUtc(),
      );

      await tx.invoice.update({
        where: { id: cleanId },
        data: {
          paidTotal,
          outstanding: outstandingAfter.isNegative() ? new Prisma.Decimal(0) : outstandingAfter,
          status: nextStatus,
          paidAt: nextStatus === "PAID" ? new Date() : null,
        },
      });
      await audit(tx, {
        entityType: "Invoice",
        entityId: cleanId,
        action: `Registrerte betaling på faktura ${cleanId}`.slice(0, 200),
        actor: toAuditActor(actor),
        metadata: {
          paymentId: payment.id,
          amount: amount.toFixed(2),
          method,
          paidAt: toDateOnly(paidAt),
          status: nextStatus,
          ...(provider ? { provider } : {}),
          ...(providerReference ? { providerReference } : {}),
        },
      });
      return ok({ paymentId: payment.id, duplicate: false, status: nextStatus });
    });

    // Kvittering sendes bare når fakturaen faktisk er fullt betalt, og bare
    // for den transaksjonen som skrev betalingen (ikke idempotente gjentak).
    if (result.ok && !result.data.duplicate && result.data.status === "PAID") {
      const invoice = await prisma.invoice.findUnique({
        where: { id: cleanId },
        select: {
          id: true,
          invoiceNumber: true,
          customerId: true,
          contactId: true,
          currency: true,
          total: true,
          customer: { select: { name: true } },
        },
      });
      if (invoice?.invoiceNumber) {
        await enqueuePaymentReceivedEmail({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          contactId: invoice.contactId,
          customerName: invoice.customer?.name,
          amount: invoice.total,
          currency: invoice.currency,
        });
      }
    }

      // Pushvarsel er best effort: betalingen er allerede registrert.
      await notifyInvoicePaid(cleanId).catch(() => undefined);
    return result;
  } catch (error) {
    if (isUniqueViolation(error) && idempotencyKey) {
      const existing = await prisma.payment.findFirst({
        where: { invoiceId: cleanId, idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        const invoice = await prisma.invoice.findUnique({
          where: { id: cleanId },
          select: { status: true },
        });
        return ok({
          paymentId: existing.id,
          duplicate: true,
          status: (invoice?.status ?? "SENT") as InvoiceStatusValue,
        });
      }
    }
    throw error;
  }
}

/** Kreditnota. Beløpet er inkl. MVA og kan ikke overstige utestående. */
export async function registerCreditNote(
  actor: ServiceActor,
  invoiceId: string,
  input: { amount: unknown; reason?: unknown; issuedAt?: unknown },
): Promise<ServiceResult<{ creditNoteId: string; creditNoteNumber: string; status: InvoiceStatusValue }>> {
  await assertModule("invoicing");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(invoiceId);
  if (!cleanId) return fail("not_found");
  const total = parseMoney(input.amount);
  if (!total || total.lte(0)) return fail("invalid");
  const reason = cleanText(input.reason, { maxLength: LIMITS.text }) || null;
  const issuedAtInput = id(input.issuedAt);
  const issuedAt = issuedAtInput ? parseDateOnly(issuedAtInput) : todayUtc();
  if (!issuedAt) return fail("invalid");

  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: cleanId, AND: [invoiceScopeFor(actor)] },
        select: {
          id: true,
          status: true,
          total: true,
          paidTotal: true,
          creditedTotal: true,
          vatRate: true,
          dueDate: true,
          issueDate: true,
        },
      });
      if (!invoice) return fail("not_found");
      if (!["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(invoice.status)) {
        return fail("conflict", { code: "invoice.notCreditable" });
      }
      const available = payableAmount(invoice);
      if (total.gt(available)) return fail("conflict", { code: "invoice.amountTooHigh" });

      const vatRate = new Prisma.Decimal(invoice.vatRate);
      const base = roundMoney(total.div(vatRate.div(100).add(1)));
      const vatAmount = roundMoney(total.sub(base));
      const creditNoteNumber = await allocateCreditNoteNumber(tx, issuedAt);

      const creditNote = await tx.creditNote.create({
        data: {
          creditNoteNumber,
          invoiceId: cleanId,
          amount: base,
          vatAmount,
          total,
          reason,
          issuedAt,
          createdById: actor.id,
          createdByName: actor.name || actor.email || null,
        },
        select: { id: true },
      });

      const creditedTotal = roundMoney(new Prisma.Decimal(invoice.creditedTotal).add(total));
      const outstanding = roundMoney(
        new Prisma.Decimal(invoice.total).sub(invoice.paidTotal).sub(creditedTotal),
      );
      const nextStatus: InvoiceStatusValue =
        creditedTotal.greaterThanOrEqualTo(invoice.total)
          ? "CREDITED"
          : deriveInvoiceStatus(
              {
                total: invoice.total,
                paidTotal: invoice.paidTotal,
                creditedTotal,
                dueDate: invoice.dueDate,
                issueDate: invoice.issueDate,
              },
              "SENT",
              todayUtc(),
            );

      await tx.invoice.update({
        where: { id: cleanId },
        data: {
          creditedTotal,
          outstanding: outstanding.isNegative() ? new Prisma.Decimal(0) : outstanding,
          status: nextStatus,
          creditedAt: nextStatus === "CREDITED" ? new Date() : null,
        },
      });
      await audit(tx, {
        entityType: "Invoice",
        entityId: cleanId,
        action: `Registrerte kreditnota ${creditNoteNumber}`,
        actor: toAuditActor(actor),
        metadata: {
          creditNoteId: creditNote.id,
          creditNoteNumber,
          total: total.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          status: nextStatus,
        },
      });
      return ok({ creditNoteId: creditNote.id, creditNoteNumber, status: nextStatus });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict", { code: "invoice.duplicateNumber" });
    throw error;
  }
}

/** Sender fakturaer med forfalt dato over i OVERDUE. Idempotent. */
export async function markOverdueInvoices(now = new Date(), limit = 500): Promise<number> {
  const { moduleEnabled } = await import("./modules");
  if (!(await moduleEnabled("invoicing"))) return 0;
  const today = todayUtc();
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      dueDate: { lt: today },
    },
    orderBy: { dueDate: "asc" },
    take: Math.max(1, Math.min(2000, limit)),
    select: { id: true, invoiceNumber: true },
  });
  let marked = 0;
  for (const invoice of candidates) {
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: ["SENT", "PARTIALLY_PAID"] } },
        data: { status: "OVERDUE" },
      });
      if (updated.count === 0) return false;
      await audit(tx, {
        entityType: "Invoice",
        entityId: invoice.id,
        action: `Faktura ${invoice.invoiceNumber ?? invoice.id} er forfalt`,
        actor: { id: "system", name: "System", email: null, departmentId: null },
        metadata: { overdueAt: now.toISOString() },
      });
      return true;
    });
    if (changed) marked += 1;
  }
  return marked;
}

/**
 * Regnskapseksport som CSV. Funksjonen er lesende og derfor idempotent; like
 * filtre gir byte-identisk fil så lenge dataene ikke er endret.
 */
export async function exportInvoicesCsv(
  actor: ServiceActor,
  options: InvoiceListFilters = {},
): Promise<ServiceResult<{ filename: string; csv: string; count: number }>> {
  await assertModule("invoicing");
  if (!actor.isActive) return fail("forbidden");
  if (!isAdminActor(actor) && !can(actor, "customers.manage")) {
    return fail("forbidden");
  }
  // Hent hele filtrerte mengden i en stabil rekkefølge, opptil et fast tak.
  // Funksjonen er lesende og gir derfor samme fil for samme filtre.
  const limit = 5000;
  const query = cleanText(options.query, { maxLength: 100 });
  const from = options.from ? parseDateOnly(options.from) : null;
  const to = options.to ? parseDateOnly(options.to) : null;
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      invoiceScopeFor(actor),
      options.status ? { status: options.status } : {},
      options.overdue ? { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { lt: todayUtc() } } : {},
      options.customerId ? { customerId: options.customerId } : {},
      from ? { issueDate: { gte: from } } : {},
      to ? { issueDate: { lte: to } } : {},
      query
        ? {
            OR: [
              { invoiceNumber: { contains: query, mode: "insensitive" } },
              { customer: { name: { contains: query, mode: "insensitive" } } },
              { workOrder: { title: { contains: query, mode: "insensitive" } } },
              { lines: { some: { description: { contains: query, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      invoiceNumber: true,
      status: true,
      issueDate: true,
      dueDate: true,
      currency: true,
      subtotal: true,
      vatTotal: true,
      total: true,
      paidTotal: true,
      creditedTotal: true,
      outstanding: true,
      customer: { select: { name: true, customerNumber: true, orgNumber: true } },
      workOrder: { select: { reference: true } },
      quote: { select: { quoteNumber: true } },
    },
  });
  const billingVisible = !fieldAccess(actor, "billingAmounts").masked;
  const amount = (value: { toFixed: (digits: number) => string }): string =>
    billingVisible ? value.toFixed(2) : "••••";
  const header = [
    "Fakturanummer",
    "Status",
    "Kundenummer",
    "Kunde",
    "Org.nr.",
    "Fakturadato",
    "Forfallsdato",
    "Valuta",
    "Netto",
    "MVA",
    "Totalt",
    "Betalt",
    "Kreditert",
    "Utestående",
    "Oppdrag",
    "Tilbud",
  ];
  const rows = invoices.map((invoice) => [
    invoice.invoiceNumber ?? "",
    invoice.status,
    invoice.customer.customerNumber ?? "",
    invoice.customer.name,
    invoice.customer.orgNumber ?? "",
    invoice.issueDate ? toDateOnly(invoice.issueDate) : "",
    invoice.dueDate ? toDateOnly(invoice.dueDate) : "",
    invoice.currency,
    amount(invoice.subtotal),
    amount(invoice.vatTotal),
    amount(invoice.total),
    amount(invoice.paidTotal),
    amount(invoice.creditedTotal),
    amount(invoice.outstanding),
    invoice.workOrder?.reference ?? "",
    invoice.quote?.quoteNumber ?? "",
  ]);
  return ok({
    filename: `fakturaer-${toDateOnly(todayUtc())}.csv`,
    csv: toCsv(header, rows),
    count: invoices.length,
  });
}

/** Portalens fakturaliste. Bare kundens egne, sendte fakturaer. */
export async function getPortalInvoices(
  actor: ServiceActor,
  options: { page?: number; pageSize?: number } = {},
): Promise<ServiceResult<{
  invoices: Array<{
    id: string;
    invoiceNumber: string | null;
    status: InvoiceStatusValue;
    issueDate: Date | null;
    dueDate: Date | null;
    total: Prisma.Decimal;
    paidTotal: Prisma.Decimal;
    outstanding: Prisma.Decimal;
    currency: string;
    paymentStatus: string;
    paymentProvider: string | null;
    paymentLinkUrl: string | null;
  }>;
  total: number;
  page: number;
  totalPages: number;
}>> {
  const access = await resolvePortalAccess(actor);
  if (!access.ok) return access;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, Math.min(50, options.pageSize ?? 20));
  const where: Prisma.InvoiceWhereInput = {
    customerId: access.data.customerId,
    status: { in: ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDITED"] },
  };
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        dueDate: true,
        total: true,
        paidTotal: true,
        outstanding: true,
        currency: true,
        paymentStatus: true,
        paymentProvider: true,
        paymentLinkUrl: true,
      },
    }),
    prisma.invoice.count({ where }),
  ]);
  return ok({
    invoices: invoices.map((invoice) => ({
      ...redactInvoiceAmounts(actor, invoice, access.data.customerId),
      status: invoice.status as InvoiceStatusValue,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/** Portalens detaljvisning. Krysskundeoppslag avvises av kundefilteret. */
export async function getPortalInvoice(actor: ServiceActor, invoiceId: string) {
  const access = await resolvePortalAccess(actor);
  if (!access.ok) return access;
  const cleanId = id(invoiceId);
  if (!cleanId) return fail("not_found");
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: cleanId,
      customerId: access.data.customerId,
      status: { in: ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDITED"] },
    },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      customer: { select: { name: true, customerNumber: true, orgNumber: true, address: true, postalCode: true, city: true } },
      contact: { select: { name: true, email: true } },
      workOrder: { select: { reference: true, title: true } },
    },
  });
  if (!invoice) return fail("not_found");
  return ok(
    redactInvoiceAmounts(actor, invoice, access.data.customerId),
  );
}

export type BillingSettingsInput = {
  vatRate?: unknown;
  invoiceDueDays?: unknown;
  quoteValidityDays?: unknown;
  approvalTokenTtlHours?: unknown;
  invoicePrefix?: unknown;
  creditNotePrefix?: unknown;
};

export async function updateBillingSettings(
  actor: ServiceActor,
  input: BillingSettingsInput,
): Promise<ServiceResult<{ updated: true }>> {
  await assertModule("invoicing");
  if (!isAdminActor(actor) || !can(actor, "settings.manage")) return fail("forbidden");
  const vatRate = normalizeVatRate(input.vatRate, 25);
  const invoiceDueDays = clampInt(input.invoiceDueDays, 0, 365, 14);
  const quoteValidityDays = clampInt(input.quoteValidityDays, 1, 3650, 30);
  const approvalTokenTtlHours = clampInt(input.approvalTokenTtlHours, 1, 720, 72);
  const invoicePrefix = cleanText(input.invoicePrefix, { maxLength: 20 }) || "F";
  const creditNotePrefix = cleanText(input.creditNotePrefix, { maxLength: 20 }) || "K";

  await prisma.$transaction(async (tx) => {
    await tx.billingSettings.upsert({
      where: { id: "default" },
      update: {
        vatRate: new Prisma.Decimal(vatRate),
        invoiceDueDays,
        quoteValidityDays,
        approvalTokenTtlHours,
        invoicePrefix,
        creditNotePrefix,
        updatedById: actor.id,
      },
      create: {
        id: "default",
        vatRate: new Prisma.Decimal(vatRate),
        invoiceDueDays,
        quoteValidityDays,
        approvalTokenTtlHours,
        invoicePrefix,
        creditNotePrefix,
        updatedById: actor.id,
      },
    });
    await audit(tx, {
      entityType: "BillingSettings",
      entityId: "default",
      action: "Oppdaterte faktureringsinnstillingene",
      actor: toAuditActor(actor),
      metadata: { vatRate, invoiceDueDays, quoteValidityDays, approvalTokenTtlHours },
    });
  });
  return ok({ updated: true });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
