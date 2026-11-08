// i18n-ignore-file: revisjonshandlinger er lagrede driftsdata, ikke UI-tekst.
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type QuoteStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { getDefaultDepartmentId } from "@/lib/departments";
import {
  addDaysUtc,
  parseDateOnly,
  todayUtc,
  toDateOnly,
} from "@/lib/dates";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { generateWorkOrderReference } from "@/lib/work-order-reference";
import {
  MAX_LINES,
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  calculateDocument,
  normalizeVatRate,
  parseMoney,
  type RawLine,
} from "@/lib/billing";
import { assertModule } from "./modules";
import { enqueueQuoteSentEmail } from "./email-outbox";
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
 * Tilbudstjenesten.
 *
 * Et tilbud kan bare endres mens det er kladd. Når det sendes, fryses linjene i
 * en `QuoteVersion`, og kunden godkjenner via et kortlivet engangstoken. Alle
 * beløp regnes på nytt på serveren – klientens totaler brukes aldri.
 */

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
] as const;

export type QuoteStatusValue = (typeof QUOTE_STATUSES)[number];

export function isQuoteStatus(value: string): value is QuoteStatusValue {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

export type QuoteLineInput = {
  description: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  vatRate?: unknown;
};

export type QuoteInput = {
  title: unknown;
  customerId?: unknown;
  customerName?: unknown;
  contactId?: unknown;
  workOrderId?: unknown;
  contractId?: unknown;
  productId?: unknown;
  departmentId?: unknown;
  validUntil?: unknown;
  notes?: unknown;
  vatRate?: unknown;
  lines?: unknown;
};

export type QuoteListItem = {
  id: string;
  quoteNumber: string | null;
  title: string;
  status: QuoteStatus;
  version: number;
  total: Prisma.Decimal;
  validUntil: Date | null;
  updatedAt: Date;
  customer: { id: string; name: string } | null;
};

export type QuoteDetail = NonNullable<Awaited<ReturnType<typeof getQuote>> extends ServiceResult<infer T> ? T : never>;

function id(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function optionalId(value: unknown): string | null {
  return id(value) || null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function quoteScopeFor(actor: ServiceActor): Prisma.QuoteWhereInput {
  if (!actor.isActive) return { id: { in: [] } };
  if (actor.role === "ADMIN") return {};
  if (actor.role === "CUSTOMER") {
    return actor.customerId ? { customerId: actor.customerId } : { id: { in: [] } };
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

function canManageQuotes(actor: ServiceActor): boolean {
  return actor.isActive && (isAdminActor(actor) || can(actor, "customers.manage"));
}

/** Alle endringer krever en aktiv konto med kundeadministrasjon. */
function requireManage(actor: ServiceActor): ServiceFailure | null {
  if (!canManageQuotes(actor)) return fail("forbidden");
  return null;
}

/**
 * Re-autentiserer aktøren mot databasen før konvertering. En gammel økt med
 * rettigheter som er endret siden innlogging skal ikke kunne lage oppdrag.
 */
async function freshActor(actor: ServiceActor): Promise<ServiceActor | null> {
  if (!actor.isActive) return null;
  const row = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      departmentId: true,
      customerId: true,
      contactId: true,
      permissions: true,
      permissionsCustomized: true,
      roleDefinition: { select: { permissions: true } },
    },
  });
  if (!row?.isActive) return null;
  return {
    ...actor,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    departmentId: row.departmentId,
    customerId: row.customerId,
    contactId: row.contactId,
    permissions: row.permissions,
    permissionsCustomized: row.permissionsCustomized,
    roleDefinition: row.roleDefinition,
  };
}

async function getSettings() {
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
    const vatRate = new Prisma.Decimal(normalizeVatRate(line.vatRate, Number(normalizeVatRate(fallbackVatRate))));
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
  const requestedId = optionalId(requested);
  if (requestedId) {
    const department = await prisma.department.findFirst({
      where: { id: requestedId, isActive: true },
      select: { id: true },
    });
    if (department) return department.id;
  }
  if (customerDepartmentId) {
    const department = await prisma.department.findFirst({
      where: { id: customerDepartmentId, isActive: true },
      select: { id: true },
    });
    if (department) return department.id;
  }
  return getDefaultDepartmentId();
}

async function resolveLinks(
  actor: ServiceActor,
  input: QuoteInput,
): Promise<
  | {
      departmentId: string;
      customerId: string | null;
      customerName: string | null;
      contactId: string | null;
      workOrderId: string | null;
      contractId: string | null;
      productId: string | null;
    }
  | { error: "invalid" | "not_found" }
> {
  const customerId = optionalId(input.customerId);
  let customerName = cleanText(input.customerName, { maxLength: LIMITS.title }) || null;
  let customerDepartmentId: string | null = null;

  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, name: true, departmentId: true },
    });
    if (!customer) return { error: "not_found" };
    customerName = customer.name;
    customerDepartmentId = customer.departmentId;
  }

  const workOrderId = optionalId(input.workOrderId);
  let workOrderCustomerId: string | null = null;
  let workOrderContactId: string | null = null;
  if (workOrderId) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, deletedAt: null },
      select: { id: true, customerId: true, contactId: true },
    });
    if (!workOrder) return { error: "not_found" };
    workOrderCustomerId = workOrder.customerId;
    workOrderContactId = workOrder.contactId;
  }

  // Oppdraget er en kilde til kunde/kontakt når tilbudet ikke oppgir det selv.
  const resolvedCustomerId = customerId ?? workOrderCustomerId;
  if (resolvedCustomerId && customerId && workOrderCustomerId && resolvedCustomerId !== workOrderCustomerId) {
    return { error: "invalid" };
  }
  if (!customerName && resolvedCustomerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: resolvedCustomerId, deletedAt: null },
      select: { name: true, departmentId: true },
    });
    if (!customer) return { error: "not_found" };
    customerName = customer.name;
    customerDepartmentId = customer.departmentId;
  }
  if (!resolvedCustomerId && !customerName) return { error: "invalid" };

  const contactId = optionalId(input.contactId) ?? workOrderContactId;
  if (contactId) {
    if (!resolvedCustomerId) return { error: "invalid" };
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, customerId: resolvedCustomerId },
      select: { id: true },
    });
    if (!contact) return { error: "invalid" };
  }

  const contractId = optionalId(input.contractId);
  if (contractId) {
    if (!resolvedCustomerId) return { error: "invalid" };
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, customerId: resolvedCustomerId },
      select: { id: true },
    });
    if (!contract) return { error: "invalid" };
  }

  const productId = optionalId(input.productId);
  if (productId) {
    if (!resolvedCustomerId) return { error: "invalid" };
    const product = await prisma.product.findFirst({
      where: { id: productId, customerId: resolvedCustomerId },
      select: { id: true },
    });
    if (!product) return { error: "invalid" };
  }

  const departmentId = await resolveDepartment(actor, input.departmentId, customerDepartmentId);
  if (!departmentId) return { error: "invalid" };

  return {
    departmentId,
    customerId: resolvedCustomerId,
    customerName,
    contactId: contactId ?? null,
    workOrderId,
    contractId,
    productId,
  };
}

function generateQuoteNumber(): string {
  const date = toDateOnly(todayUtc()).slice(2).replace(/-/g, "");
  return `T-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function writeLines(
  tx: Prisma.TransactionClient,
  quoteId: string,
  calculated: ReturnType<typeof calculateDocument>,
): Promise<void> {
  await tx.quoteLine.deleteMany({ where: { quoteId } });
  if (calculated.lines.length === 0) return;
  await tx.quoteLine.createMany({
    data: calculated.lines.map((line) => ({
      quoteId,
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

export async function createQuote(
  actor: ServiceActor,
  input: QuoteInput,
): Promise<ServiceResult<{ id: string }>> {
  await assertModule("quotes");
  const denied = requireManage(actor);
  if (denied) return denied;

  const title = cleanText(input.title, { maxLength: LIMITS.title });
  if (!title) return fail("invalid");
  const settings = await getSettings();
  const vatRate = normalizeVatRate(input.vatRate, Number(settings.vatRate));
  const lines = normalizeLines(input.lines, vatRate);
  if (!lines) return fail("invalid");
  const links = await resolveLinks(actor, input);
  if ("error" in links) return fail(links.error);

  const validityDays = Math.max(1, Math.min(3650, settings.quoteValidityDays));
  const requestedValidUntil = id(input.validUntil);
  const validUntil = requestedValidUntil
    ? parseDateOnly(requestedValidUntil)
    : addDaysUtc(todayUtc(), validityDays);
  if (!validUntil) return fail("invalid");

  const calculated = calculateDocument(toRawLines(lines), vatRate);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          quoteNumber: generateQuoteNumber(),
          title,
          ...links,
          currency: "NOK",
          subtotal: new Prisma.Decimal(calculated.subtotal),
          vatTotal: new Prisma.Decimal(calculated.vatTotal),
          total: new Prisma.Decimal(calculated.total),
          vatRate: new Prisma.Decimal(vatRate),
          validUntil,
          notes: cleanMarkdown(input.notes) || null,
          createdById: actor.id,
          createdByName: actor.name || actor.email || null,
        },
        select: { id: true, quoteNumber: true },
      });
      await writeLines(tx, quote.id, calculated);
      await audit(tx, {
        entityType: "Quote",
        entityId: quote.id,
        action: `Opprettet tilbud ${quote.quoteNumber ?? title}`,
        actor: toAuditActor(actor),
        metadata: {
          customerId: links.customerId,
          departmentId: links.departmentId,
          total: calculated.total,
        },
      });
      return quote;
    });
    return ok({ id: created.id });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict", { code: "quote.duplicate" });
    throw error;
  }
}

export async function updateQuote(
  actor: ServiceActor,
  quoteId: string,
  input: QuoteInput,
): Promise<ServiceResult<{ id: string }>> {
  await assertModule("quotes");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(quoteId);
  if (!cleanId) return fail("not_found");

  const existing = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(actor)] },
    select: { id: true, status: true, customerId: true },
  });
  if (!existing) return fail("not_found");
  if (existing.status !== "DRAFT") return fail("conflict", { code: "quote.locked" });

  const title = cleanText(input.title, { maxLength: LIMITS.title });
  if (!title) return fail("invalid");
  const settings = await getSettings();
  const vatRate = normalizeVatRate(input.vatRate, Number(settings.vatRate));
  const lines = normalizeLines(input.lines, vatRate);
  if (!lines) return fail("invalid");
  const links = await resolveLinks(actor, {
    ...input,
    // Bevar kunden dersom skjemaet ikke sender den med.
    customerId: input.customerId ?? existing.customerId,
  });
  if ("error" in links) return fail(links.error);

  const validityDays = Math.max(1, Math.min(3650, settings.quoteValidityDays));
  const requestedValidUntil = id(input.validUntil);
  const validUntil = requestedValidUntil
    ? parseDateOnly(requestedValidUntil)
    : addDaysUtc(todayUtc(), validityDays);
  if (!validUntil) return fail("invalid");

  const calculated = calculateDocument(toRawLines(lines), vatRate);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.quote.updateMany({
      where: { id: cleanId, status: "DRAFT" },
      data: {
        title,
        ...links,
        subtotal: new Prisma.Decimal(calculated.subtotal),
        vatTotal: new Prisma.Decimal(calculated.vatTotal),
        total: new Prisma.Decimal(calculated.total),
        vatRate: new Prisma.Decimal(vatRate),
        validUntil,
        notes: cleanMarkdown(input.notes) || null,
      },
    });
    if (updated.count === 0) return;
    await writeLines(tx, cleanId, calculated);
    await audit(tx, {
      entityType: "Quote",
      entityId: cleanId,
      action: `Oppdaterte tilbudet ${title}`,
      actor: toAuditActor(actor),
      metadata: { total: calculated.total, vatRate },
    });
  });
  return ok({ id: cleanId });
}

async function snapshotQuote(
  tx: Prisma.TransactionClient,
  quoteId: string,
  actor: ServiceActor,
): Promise<void> {
  const quote = await tx.quote.findUnique({
    where: { id: quoteId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      customer: { select: { name: true, customerNumber: true, orgNumber: true } },
      contact: { select: { name: true, email: true, phone: true } },
      product: { select: { model: true, serialNumber: true } },
    },
  });
  if (!quote) return;
  const exists = await tx.quoteVersion.findUnique({
    where: { quoteId_version: { quoteId, version: quote.version } },
    select: { id: true },
  });
  if (exists) return;
  const snapshot = {
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    customer: quote.customer,
    customerName: quote.customerName,
    contact: quote.contact,
    product: quote.product,
    validUntil: quote.validUntil ? toDateOnly(quote.validUntil) : null,
    notes: quote.notes,
    currency: quote.currency,
    lines: quote.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity.toFixed(2),
      unit: line.unit,
      unitPrice: line.unitPrice.toFixed(2),
      vatRate: line.vatRate.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
      lineVat: line.lineVat.toFixed(2),
    })),
  };
  await tx.quoteVersion.create({
    data: {
      quoteId,
      version: quote.version,
      status: quote.status,
      title: quote.title,
      snapshotJson: JSON.stringify(snapshot),
      subtotal: quote.subtotal,
      vatTotal: quote.vatTotal,
      total: quote.total,
      vatRate: quote.vatRate,
      validUntil: quote.validUntil,
      notes: quote.notes,
      createdById: actor.id,
      createdByName: actor.name || actor.email || null,
    },
  });
}

async function issueToken(
  tx: Prisma.TransactionClient,
  quoteId: string,
  ttlHours: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await tx.quote.update({
    where: { id: quoteId },
    data: {
      tokenHash: sha256(token),
      tokenExpiresAt: new Date(Date.now() + Math.max(1, Math.min(720, ttlHours)) * 3_600_000),
      tokenUsedAt: null,
    },
  });
  return token;
}

/** Sender kladden. Returnerer engangslenken som kan deles med kunden. */
export async function sendQuote(
  actor: ServiceActor,
  quoteId: string,
): Promise<ServiceResult<{ token: string; version: number }>> {
  await assertModule("quotes");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(quoteId);
  const quote = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(actor)] },
    select: {
      id: true,
      status: true,
      version: true,
      validUntil: true,
      title: true,
      quoteNumber: true,
      total: true,
      currency: true,
      customerId: true,
      contactId: true,
      customerName: true,
      customer: { select: { name: true } },
    },
  });
  if (!quote) return fail("not_found");
  if (quote.status !== "DRAFT") return fail("conflict", { code: "quote.notDraft" });
  if (quote.validUntil && quote.validUntil.getTime() < todayUtc().getTime()) {
    return fail("conflict", { code: "quote.expired" });
  }
  const settings = await getSettings();

  try {
    const result = await prisma.$transaction(async (tx) => {
      await snapshotQuote(tx, cleanId, actor);
      const token = await issueToken(tx, cleanId, settings.approvalTokenTtlHours);
      const updated = await tx.quote.updateMany({
        where: { id: cleanId, status: "DRAFT" },
        data: { status: "SENT", sentAt: new Date() },
      });
      if (updated.count === 0) return null;
      await audit(tx, {
        entityType: "Quote",
        entityId: cleanId,
        action: `Sendte tilbudet ${quote.title}`,
        actor: toAuditActor(actor),
        metadata: { version: quote.version },
      });
      return { token, version: quote.version };
    });
    if (!result) return fail("conflict", { code: "quote.notDraft" });

    // E-posten legges i den vedvarende utboksen etter at statusen er committet.
    // En SMTP-feil kan derfor aldri rulle tilbake «sendt»-statusen.
    await enqueueQuoteSentEmail({
      quoteId: cleanId,
      token: result.token,
      version: result.version,
      title: quote.title,
      customerName: quote.customer?.name ?? quote.customerName,
      reference: quote.quoteNumber,
      total: quote.total,
      currency: quote.currency,
      validUntil: quote.validUntil,
      customerId: quote.customerId,
      contactId: quote.contactId,
    });

    return ok(result);
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict", { code: "quote.duplicate" });
    throw error;
  }
}

/** Fornyer godkjenningslenken uten å endre tilbudet. */
export async function reissueQuoteToken(
  actor: ServiceActor,
  quoteId: string,
): Promise<ServiceResult<{ token: string }>> {
  await assertModule("quotes");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(quoteId);
  const quote = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(actor)] },
    select: { id: true, status: true },
  });
  if (!quote) return fail("not_found");
  if (quote.status !== "SENT") return fail("conflict", { code: "quote.notSent" });
  const settings = await getSettings();
  const token = await prisma.$transaction(async (tx) => {
    const value = await issueToken(tx, cleanId, settings.approvalTokenTtlHours);
    await audit(tx, {
      entityType: "Quote",
      entityId: cleanId,
      action: "Fornyet godkjenningslenken for tilbudet",
      actor: toAuditActor(actor),
    });
    return value;
  });
  return ok({ token });
}

/** Lagrer en navngitt revisjon av en kladd og øker versjonsnummeret. */
export async function createQuoteVersion(
  actor: ServiceActor,
  quoteId: string,
): Promise<ServiceResult<{ version: number }>> {
  await assertModule("quotes");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(quoteId);
  const quote = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(actor)] },
    select: { id: true, status: true, version: true, title: true },
  });
  if (!quote) return fail("not_found");
  if (quote.status !== "DRAFT") return fail("conflict", { code: "quote.locked" });

  const next = await prisma.$transaction(async (tx) => {
    await snapshotQuote(tx, cleanId, actor);
    const updated = await tx.quote.update({
      where: { id: cleanId },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    await audit(tx, {
      entityType: "Quote",
      entityId: cleanId,
      action: `Lagret versjon ${quote.version} av tilbudet ${quote.title}`,
      actor: toAuditActor(actor),
      metadata: { version: quote.version, nextVersion: updated.version },
    });
    return updated.version;
  });
  return ok({ version: next });
}

export async function cloneQuote(
  actor: ServiceActor,
  quoteId: string,
): Promise<ServiceResult<{ id: string }>> {
  await assertModule("quotes");
  const denied = requireManage(actor);
  if (denied) return denied;
  const cleanId = id(quoteId);
  const source = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(actor)] },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) return fail("not_found");

  const created = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        quoteNumber: generateQuoteNumber(),
        title: `${source.title} (kopi)`.slice(0, LIMITS.title),
        status: "DRAFT",
        version: 1,
        customerId: source.customerId,
        customerName: source.customerName,
        contactId: source.contactId,
        workOrderId: source.workOrderId,
        contractId: source.contractId,
        productId: source.productId,
        departmentId: source.departmentId,
        currency: source.currency,
        subtotal: source.subtotal,
        vatTotal: source.vatTotal,
        total: source.total,
        vatRate: source.vatRate,
        validUntil: source.validUntil,
        notes: source.notes,
        createdById: actor.id,
        createdByName: actor.name || actor.email || null,
        lines: {
          create: source.lines.map((line) => ({
            sortOrder: line.sortOrder,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
            lineTotal: line.lineTotal,
            lineVat: line.lineVat,
          })),
        },
      },
      select: { id: true, quoteNumber: true },
    });
    await audit(tx, {
      entityType: "Quote",
      entityId: quote.id,
      action: `Klona tilbudet ${source.quoteNumber ?? source.title}`,
      actor: toAuditActor(actor),
      metadata: { sourceQuoteId: source.id },
    });
    return quote;
  });
  return ok({ id: created.id });
}

const GENERIC_PORTAL_ACTOR = {
  id: "quote-portal",
  name: "Kunde (portal)",
  email: null,
  departmentId: null,
};

/**
 * Godkjenner et tilbud via token. Uten innlogging, men tokenet må være
 * uutløpt, ubrukt og tilhøre et tilbud som fortsatt er sendt.
 */
export async function acceptQuoteByToken(
  token: string,
  options: { name?: unknown; comment?: unknown } = {},
): Promise<ServiceResult<{ quoteId: string; status: "ACCEPTED"; alreadyAccepted: boolean }>> {
  await assertModule("quotes");
  const cleanToken = cleanText(token, { maxLength: 200 });
  if (!cleanToken) return fail("not_found");
  const name = cleanText(options.name, { maxLength: LIMITS.title });
  if (!name) return fail("invalid");

  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { tokenHash: sha256(cleanToken) },
      select: {
        id: true,
        title: true,
        status: true,
        validUntil: true,
        tokenExpiresAt: true,
        tokenUsedAt: true,
      },
    });
    if (!quote) return fail("not_found");
    if (quote.status === "ACCEPTED") {
      return ok({ quoteId: quote.id, status: "ACCEPTED" as const, alreadyAccepted: true });
    }
    if (quote.tokenUsedAt || quote.status !== "SENT") {
      return fail("conflict", { code: "token.used" });
    }
    if (!quote.tokenExpiresAt || quote.tokenExpiresAt.getTime() <= Date.now()) {
      return fail("conflict", { code: "token.expired" });
    }
    if (quote.validUntil && quote.validUntil.getTime() < todayUtc().getTime()) {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "EXPIRED" },
      });
      return fail("conflict", { code: "quote.expired" });
    }

    await tx.quote.update({
      where: { id: quote.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        tokenUsedAt: new Date(),
      },
    });
    await audit(tx, {
      entityType: "Quote",
      entityId: quote.id,
      action: `Kunden godkjente tilbudet ${quote.title}`.slice(0, 200),
      actor: { ...GENERIC_PORTAL_ACTOR, name },
      metadata: {
        acceptedBy: name,
        comment: cleanText(options.comment, { maxLength: LIMITS.text }) || null,
      },
    });
    return ok({ quoteId: quote.id, status: "ACCEPTED" as const, alreadyAccepted: false });
  });
}

export async function rejectQuoteByToken(
  token: string,
  options: { name?: unknown; reason?: unknown } = {},
): Promise<ServiceResult<{ quoteId: string; status: "REJECTED" }>> {
  await assertModule("quotes");
  const cleanToken = cleanText(token, { maxLength: 200 });
  if (!cleanToken) return fail("not_found");
  const name = cleanText(options.name, { maxLength: LIMITS.title });
  const reason = cleanText(options.reason, { maxLength: LIMITS.text });
  if (!name || !reason) return fail("invalid");

  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { tokenHash: sha256(cleanToken) },
      select: {
        id: true,
        title: true,
        status: true,
        tokenExpiresAt: true,
        tokenUsedAt: true,
      },
    });
    if (!quote) return fail("not_found");
    if (quote.status === "REJECTED") {
      return ok({ quoteId: quote.id, status: "REJECTED" as const });
    }
    if (quote.tokenUsedAt || quote.status !== "SENT") {
      return fail("conflict", { code: "token.used" });
    }
    if (!quote.tokenExpiresAt || quote.tokenExpiresAt.getTime() <= Date.now()) {
      return fail("conflict", { code: "token.expired" });
    }

    await tx.quote.update({
      where: { id: quote.id },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedReason: reason,
        tokenUsedAt: new Date(),
      },
    });
    await audit(tx, {
      entityType: "Quote",
      entityId: quote.id,
      action: `Kunden avslo tilbudet ${quote.title}`.slice(0, 200),
      actor: { ...GENERIC_PORTAL_ACTOR, name },
      metadata: { rejectedBy: name, reason },
    });
    return ok({ quoteId: quote.id, status: "REJECTED" as const });
  });
}

/** Offentlig, lesbar visning av et token. Skjuler interne id-er. */
export async function getQuoteByToken(token: string): Promise<ServiceResult<{
  quoteId: string;
  status: QuoteStatusValue;
  title: string;
  quoteNumber: string | null;
  customerName: string | null;
  contactName: string | null;
  validUntil: Date | null;
  expiresAt: Date | null;
  used: boolean;
  tokenExpired: boolean;
  canDecide: boolean;
  currency: string;
  subtotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  notes: string | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitPrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    lineVat: Prisma.Decimal;
  }>;
}>> {
  await assertModule("quotes");
  const cleanToken = cleanText(token, { maxLength: 200 });
  if (!cleanToken) return fail("not_found");
  const quote = await prisma.quote.findUnique({
    where: { tokenHash: sha256(cleanToken) },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      customer: { select: { name: true } },
      contact: { select: { name: true } },
    },
  });
  if (!quote) return fail("not_found");
  const status: QuoteStatusValue =
    quote.status === "SENT" &&
    quote.validUntil &&
    quote.validUntil.getTime() < todayUtc().getTime()
      ? "EXPIRED"
      : (quote.status as QuoteStatusValue);
  const tokenExpired =
    !quote.tokenExpiresAt || quote.tokenExpiresAt.getTime() <= Date.now();
  return ok({
    quoteId: quote.id,
    status,
    title: quote.title,
    quoteNumber: quote.quoteNumber,
    customerName: quote.customer?.name ?? quote.customerName,
    contactName: quote.contact?.name ?? null,
    validUntil: quote.validUntil,
    expiresAt: quote.tokenExpiresAt,
    used: Boolean(quote.tokenUsedAt),
    tokenExpired,
    canDecide: status === "SENT" && !quote.tokenUsedAt && !tokenExpired,
    currency: quote.currency,
    subtotal: quote.subtotal,
    vatTotal: quote.vatTotal,
    total: quote.total,
    notes: quote.notes,
    lines: quote.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
      lineVat: line.lineVat,
    })),
  });
}

export async function listQuotes(
  actor: ServiceActor,
  options: { status?: QuoteStatusValue | null; query?: string; customerId?: string; page?: number; pageSize?: number } = {},
): Promise<ServiceResult<{ quotes: QuoteListItem[]; total: number }>> {
  if (!(await moduleIsAvailable("quotes"))) return fail("not_found");
  const scope = quoteScopeFor(actor);
  if (!actor.isActive) return fail("forbidden");
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 25));
  const query = cleanText(options.query, { maxLength: 100 });
  const customerId = optionalId(options.customerId);
  const where: Prisma.QuoteWhereInput = {
    AND: [
      scope,
      options.status ? { status: options.status } : {},
      customerId ? { customerId } : {},
      query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { quoteNumber: { contains: query, mode: "insensitive" } },
              { customer: { name: { contains: query, mode: "insensitive" } } },
              { customerName: { contains: query, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const [quotes, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        quoteNumber: true,
        title: true,
        status: true,
        version: true,
        total: true,
        validUntil: true,
        updatedAt: true,
        customer: { select: { id: true, name: true } },
      },
    }),
    prisma.quote.count({ where }),
  ]);
  return ok({ quotes, total });
}

export async function getQuote(actor: ServiceActor, quoteId: string) {
  if (!(await moduleIsAvailable("quotes"))) return fail("not_found");
  const cleanId = id(quoteId);
  if (!cleanId) return fail("not_found");
  const quote = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(actor)] },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
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
      workOrder: { select: { id: true, title: true, reference: true, status: true } },
      contract: { select: { id: true, title: true } },
      product: { select: { id: true, model: true, serialNumber: true } },
      department: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, total: true, createdAt: true } },
      invoices: { select: { id: true, invoiceNumber: true, status: true, total: true } },
    },
  });
  if (!quote) return fail("not_found");
  return ok(quote);
}

/**
 * Marker sendte tilbud som er utløpt. Kalles av en jobb/cron; hver endring får
 * en revisjonsrad. Returnerer antall oppdaterte tilbud.
 */
export async function expireQuotes(now = new Date(), limit = 500): Promise<number> {
  if (!(await moduleIsAvailable("quotes"))) return 0;
  const candidates = await prisma.quote.findMany({
    where: { status: "SENT", validUntil: { lt: todayUtc() } },
    orderBy: { validUntil: "asc" },
    take: Math.max(1, Math.min(2000, limit)),
    select: { id: true, title: true, quoteNumber: true },
  });
  let expired = 0;
  for (const quote of candidates) {
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.quote.updateMany({
        where: { id: quote.id, status: "SENT" },
        data: { status: "EXPIRED" },
      });
      if (updated.count === 0) return false;
      await audit(tx, {
        entityType: "Quote",
        entityId: quote.id,
        action: `Tilbudet ${quote.quoteNumber ?? quote.title} utløp`,
        actor: { id: "system", name: "System", email: null, departmentId: null },
        metadata: { expiredAt: now.toISOString() },
      });
      return true;
    });
    if (changed) expired += 1;
  }
  return expired;
}

async function moduleIsAvailable(key: "quotes" | "invoicing"): Promise<boolean> {
  const { moduleEnabled } = await import("./modules");
  return moduleEnabled(key);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Konverterer et akseptert tilbud til oppdrag. Kunden gjenbrukes når den
 * finnes; ellers opprettes den fra tilbudets kundenavn. Utstyret på tilbudet
 * kobles til oppdraget. Hele operasjonen er én transaksjon og idempotent.
 */
export async function convertQuoteToWorkOrder(
  actor: ServiceActor,
  quoteId: string,
): Promise<ServiceResult<{ workOrderId: string }>> {
  await assertModule("quotes");
  const fresh = await freshActor(actor);
  if (!fresh) return fail("forbidden");
  if (!isAdminActor(fresh) && !can(fresh, "customers.manage")) return fail("forbidden");
  if (!can(fresh, "workorders.create")) return fail("forbidden");

  const cleanId = id(quoteId);
  if (!cleanId) return fail("not_found");
  const quote = await prisma.quote.findFirst({
    where: { id: cleanId, AND: [quoteScopeFor(fresh)] },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quote) return fail("not_found");
  if (quote.convertedWorkOrderId) {
    return ok({ workOrderId: quote.convertedWorkOrderId });
  }
  if (quote.status !== "ACCEPTED") return fail("conflict", { code: "quote.notAccepted" });

  try {
    const workOrderId = await prisma.$transaction(async (tx) => {
      const current = await tx.quote.findFirst({
        where: { id: cleanId, status: "ACCEPTED", convertedWorkOrderId: null },
        select: { id: true, customerId: true, customerName: true, title: true },
      });
      if (!current) {
        const converted = await tx.quote.findUnique({
          where: { id: cleanId },
          select: { convertedWorkOrderId: true },
        });
        return converted?.convertedWorkOrderId ?? null;
      }

      let customerId = current.customerId;
      if (customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, deletedAt: null },
          select: { id: true },
        });
        if (!customer) customerId = null;
      }
      if (!customerId) {
        const name = current.customerName || current.title;
        const customer = await tx.customer.create({
          data: { name, departmentId: quote.departmentId },
          select: { id: true },
        });
        customerId = customer.id;
      }

      const description = [
        quote.notes,
        quote.lines.length > 0
          ? quote.lines
              .map(
                (line) =>
                  `• ${line.description}: ${line.quantity.toString()} ${line.unit} × ${line.unitPrice.toString()}`,
              )
              .join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, LIMITS.markdown);

      const workOrder = await tx.workOrder.create({
        data: {
          title: quote.title,
          reference: generateWorkOrderReference(),
          description,
          departmentId: quote.departmentId,
          customerId,
          contactId: quote.contactId ?? undefined,
          productId: quote.productId ?? undefined,
          creatorName: fresh.name || fresh.email || "Kontor",
          status: "PENDING",
        },
        select: { id: true, reference: true },
      });

      await tx.quote.update({
        where: { id: cleanId },
        data: { convertedWorkOrderId: workOrder.id, convertedAt: new Date() },
      });

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrder.id,
        action: `Opprettet oppdrag fra tilbudet ${quote.quoteNumber ?? quote.title}`.slice(0, 200),
        actor: toAuditActor(fresh),
        metadata: { quoteId: quote.id, customerId, reference: workOrder.reference },
      });
      await audit(tx, {
        entityType: "Quote",
        entityId: quote.id,
        action: `Konverterte tilbudet til oppdrag ${workOrder.reference}`.slice(0, 200),
        actor: toAuditActor(fresh),
        metadata: { workOrderId: workOrder.id },
      });
      return workOrder.id;
    });
    if (!workOrderId) return fail("conflict", { code: "quote.conversionRace" });
    return ok({ workOrderId });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const converted = await prisma.quote.findUnique({
        where: { id: cleanId },
        select: { convertedWorkOrderId: true },
      });
      if (converted?.convertedWorkOrderId) return ok({ workOrderId: converted.convertedWorkOrderId });
      return fail("conflict", { code: "quote.conversionRace" });
    }
    throw error;
  }
}
