import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { invalidateModuleCache } from "@/server/modules";
import type { ServiceActor } from "@/server/actor";
import {
  acceptQuoteByToken,
  cloneQuote,
  convertQuoteToWorkOrder,
  createQuote,
  createQuoteVersion,
  expireQuotes,
  getQuote,
  getQuoteByToken,
  sendQuote,
  updateQuote,
} from "@/server/quotes";
import {
  createInvoice,
  exportInvoicesCsv,
  getPortalInvoice,
  getPortalInvoices,
  markOverdueInvoices,
  registerCreditNote,
  registerPayment,
  sendInvoice,
  updateBillingSettings,
} from "@/server/invoices";

const describeIntegration = integrationEnabled ? describe : describe.skip;

database: {
  // Blokken er bare et merkelappnavn; testene hoppes over uten testdatabase.
}

let departmentId = "";
let customerAId = "";
let customerBId = "";
let contactAId = "";
let productAId = "";
let adminUserId = "";
const createdQuoteIds: string[] = [];
const createdInvoiceIds: string[] = [];
const createdWorkOrderIds: string[] = [];

const officeActor: ServiceActor = {
  id: "it-billing-office",
  name: "Fakturakontor",
  email: "faktura@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: null,
  permissionsCustomized: true,
  permissions: [
    "customers.view",
    "customers.manage",
    "workorders.view",
    "workorders.create",
    "settings.manage",
  ],
  roleDefinition: null,
};

const limitedActor: ServiceActor = {
  id: "it-billing-limited",
  name: "Uten tilgang",
  email: "uten@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: null,
  permissionsCustomized: true,
  permissions: [],
  roleDefinition: null,
};

function adminActor(): ServiceActor {
  return {
    id: adminUserId,
    name: "Fakturaadmin",
    email: "admin@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: null,
    permissionsCustomized: false,
    permissions: [],
    roleDefinition: { permissions: [] },
  };
}

async function createDraftQuote(options: {
  customerId?: string;
  lines?: Array<Record<string, unknown>>;
  vatRate?: unknown;
  productId?: string;
  withLinks?: boolean;
} = {}) {
  const withLinks = options.withLinks ?? true;
  const result = await createQuote(officeActor, {
    title: unique("Tilbud"),
    customerId: options.customerId ?? customerAId,
    contactId: withLinks ? contactAId : undefined,
    productId: withLinks ? (options.productId ?? productAId) : undefined,
    validUntil: "2027-12-31",
    vatRate: options.vatRate,
    lines:
      options.lines ??
      [
        { description: "Arbeid", quantity: 2, unitPrice: 100, vatRate: 25 },
        { description: "Materiell", quantity: 1, unitPrice: 50, vatRate: 25 },
      ],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  createdQuoteIds.push(result.data.id);
  return result.data.id;
}

async function sendAndAccept(quoteId: string) {
  const sent = await sendQuote(officeActor, quoteId);
  expect(sent.ok).toBe(true);
  if (!sent.ok) throw new Error(sent.reason);
  const accepted = await acceptQuoteByToken(sent.data.token, {
    name: "Kunde Kontakt",
    comment: "Godkjent",
  });
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error(accepted.reason);
  return sent.data.token;
}

async function createSentInvoice(options: {
  customerId?: string;
  lines?: Array<Record<string, unknown>>;
  quoteId?: string;
} = {}) {
  const created = await createInvoice(officeActor, {
    customerId: options.customerId ?? customerAId,
    contactId: options.customerId && options.customerId !== customerAId ? undefined : contactAId,
    quoteId: options.quoteId,
    lines:
      options.lines ??
      [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 25 }],
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.reason);
  createdInvoiceIds.push(created.data.id);
  const sent = await sendInvoice(officeActor, created.data.id);
  expect(sent.ok).toBe(true);
  if (!sent.ok) throw new Error(sent.reason);
  return { id: created.data.id, invoiceNumber: sent.data.invoiceNumber };
}

describeIntegration("tilbud og fakturering mot ekte PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.role.upsert({
      where: { key: "ADMIN" },
      update: {},
      create: {
        key: "ADMIN",
        label: unique("Administrator"),
        description: "Integrasjonstest",
        permissions: [],
        isSystem: true,
      },
    });
    const user = await prisma.user.create({
      data: {
        name: "Fakturaadmin",
        email: `${unique("billing-admin")}@example.test`,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    });
    adminUserId = user.id;
    // Testaktøren skal være administrator uavhengig av den tilfeldige rollenøkkelen.
    officeActor.permissions = [
      "customers.view",
      "customers.manage",
      "workorders.view",
      "workorders.create",
      "settings.manage",
    ];

    const department = await prisma.department.create({
      data: { name: unique("IT-faktura") },
    });
    departmentId = department.id;
    officeActor.departmentId = departmentId;
    limitedActor.departmentId = departmentId;

    const customerA = await prisma.customer.create({
      data: { name: unique("Fakturakunde A"), departmentId },
    });
    const customerB = await prisma.customer.create({
      data: { name: unique("Fakturakunde B"), departmentId },
    });
    customerAId = customerA.id;
    customerBId = customerB.id;

    const contact = await prisma.contact.create({
      data: { name: "Kontakt A", email: "a@example.test", customerId: customerAId },
    });
    contactAId = contact.id;

    const product = await prisma.product.create({
      data: { model: "Pumpe A", customerId: customerAId },
    });
    productAId = product.id;

    // Modulene er «planned» i katalogen til hovedagenten kobler dem inn.
    await prisma.moduleState.upsert({
      where: { key: "quotes" },
      update: { enabled: true },
      create: { key: "quotes", enabled: true },
    });
    await prisma.moduleState.upsert({
      where: { key: "invoicing" },
      update: { enabled: true },
      create: { key: "invoicing", enabled: true },
    });
    invalidateModuleCache();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.creditNote.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    await prisma.quoteVersion.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
    await prisma.quoteLine.deleteMany({ where: { quoteId: { in: createdQuoteIds } } });
    await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWorkOrderIds } } });
    await prisma.product.deleteMany({ where: { customerId: { in: [customerAId, customerBId] } } });
    await prisma.contact.deleteMany({ where: { customerId: { in: [customerAId, customerBId] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerAId, customerBId] } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    if (adminUserId) await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.billingSettings.update({
      where: { id: "default" },
      data: { vatRate: 25, invoiceDueDays: 14, quoteValidityDays: 30, approvalTokenTtlHours: 72 },
    }).catch(() => undefined);
    invalidateModuleCache();
  });

  it("beregner totaler og MVA på serveren", async () => {
    const quoteId = await createDraftQuote();
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.subtotal.toFixed(2)).toBe("250.00");
    expect(quote.vatTotal.toFixed(2)).toBe("62.50");
    expect(quote.total.toFixed(2)).toBe("312.50");
    expect(quote.status).toBe("DRAFT");

    // En oppdatering med nye linjer skal regne på nytt, ikke bruke gamle tall.
    const updated = await updateQuote(officeActor, quoteId, {
      title: quote.title,
      customerId: customerAId,
      lines: [{ description: "Ny linje", quantity: 3, unitPrice: 19.99, vatRate: 15 }],
    });
    expect(updated.ok).toBe(true);
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(after.subtotal.toFixed(2)).toBe("59.97");
    expect(after.vatTotal.toFixed(2)).toBe("9.00");
    expect(after.total.toFixed(2)).toBe("68.97");
  });

  it("bruker konfigurerbar MVA-sats som standard", async () => {
    const settings = await updateBillingSettings(adminActor(), {
      vatRate: 12,
      invoiceDueDays: 30,
      quoteValidityDays: 30,
      approvalTokenTtlHours: 24,
      invoicePrefix: "F",
      creditNotePrefix: "K",
    });
    expect(settings.ok).toBe(true);

    const quoteId = await createDraftQuote({
      lines: [{ description: "Tolv prosent", quantity: 1, unitPrice: 100 }],
    });
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.vatRate.toFixed(2)).toBe("12.00");
    expect(quote.vatTotal.toFixed(2)).toBe("12.00");
    expect(quote.total.toFixed(2)).toBe("112.00");

    await updateBillingSettings(adminActor(), {
      vatRate: 25,
      invoiceDueDays: 14,
      quoteValidityDays: 30,
      approvalTokenTtlHours: 72,
      invoicePrefix: "F",
      creditNotePrefix: "K",
    });
  });

  it("avviser utløpt godkjenningstoken og bruker tokenet bare én gang", async () => {
    const quoteId = await createDraftQuote();
    const sent = await sendQuote(officeActor, quoteId);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const view = await getQuoteByToken(sent.data.token);
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.data.status).toBe("SENT");

    await prisma.quote.update({
      where: { id: quoteId },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await acceptQuoteByToken(sent.data.token, { name: "Kunde" });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.reason).toBe("conflict");
      expect(expired.details).toMatchObject({ code: "token.expired" });
    }

    const resent = await sendQuote(officeActor, quoteId);
    expect(resent.ok).toBe(false);
  });

  it("godkjenner, versjonerer og konverterer til oppdrag med gjenbrukt kunde og utstyr", async () => {
    const quoteId = await createDraftQuote();
    const versioned = await createQuoteVersion(officeActor, quoteId);
    expect(versioned.ok).toBe(true);
    if (versioned.ok) expect(versioned.data.version).toBe(2);

    await sendAndAccept(quoteId);
    const accepted = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedAt).not.toBeNull();
    expect(accepted.version).toBe(2);

    const converted = await convertQuoteToWorkOrder(adminActor(), quoteId);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    createdWorkOrderIds.push(converted.data.workOrderId);

    const workOrder = await prisma.workOrder.findUniqueOrThrow({
      where: { id: converted.data.workOrderId },
    });
    expect(workOrder.customerId).toBe(customerAId);
    expect(workOrder.productId).toBe(productAId);
    expect(workOrder.departmentId).toBe(departmentId);

    const again = await convertQuoteToWorkOrder(adminActor(), quoteId);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.workOrderId).toBe(converted.data.workOrderId);

    const cloned = await cloneQuote(officeActor, quoteId);
    expect(cloned.ok).toBe(true);
    if (cloned.ok) {
      createdQuoteIds.push(cloned.data.id);
      const copy = await prisma.quote.findUniqueOrThrow({ where: { id: cloned.data.id } });
      expect(copy.status).toBe("DRAFT");
      expect(copy.convertedWorkOrderId).toBeNull();
    }
  });

  it("fakturerer et godkjent tilbud, delbetaler og dedupliserer betaling", async () => {
    const quoteId = await createDraftQuote();
    await sendAndAccept(quoteId);

    const created = await createInvoice(officeActor, { quoteId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdInvoiceIds.push(created.data.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(invoice.total.toFixed(2)).toBe("312.50");
    expect(invoice.outstanding.toFixed(2)).toBe("312.50");
    expect(invoice.invoiceNumber).toBeNull();

    const sent = await sendInvoice(officeActor, created.data.id);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.data.invoiceNumber).toMatch(/^F-\d{4}-\d{5}$/);
    const resent = await sendInvoice(officeActor, created.data.id);
    expect(resent.ok).toBe(true);
    if (resent.ok) {
      expect(resent.data.alreadySent).toBe(true);
      expect(resent.data.invoiceNumber).toBe(sent.data.invoiceNumber);
    }

    const first = await registerPayment(officeActor, created.data.id, {
      amount: "100.00",
      paidAt: "2026-11-07",
      method: "BANK_TRANSFER",
      reference: "KID-1",
      idempotencyKey: "dup-key-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.status).toBe("PARTIALLY_PAID");

    const duplicate = await registerPayment(officeActor, created.data.id, {
      amount: "100.00",
      paidAt: "2026-11-07",
      method: "BANK_TRANSFER",
      idempotencyKey: "dup-key-1",
    });
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) {
      expect(duplicate.data.duplicate).toBe(true);
      expect(duplicate.data.paymentId).toBe(first.ok ? first.data.paymentId : "");
    }

    const afterDuplicate = await prisma.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(afterDuplicate.paidTotal.toFixed(2)).toBe("100.00");
    expect(afterDuplicate.outstanding.toFixed(2)).toBe("212.50");

    const tooMuch = await registerPayment(officeActor, created.data.id, {
      amount: "999.00",
      idempotencyKey: "too-much",
    });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.details).toMatchObject({ code: "invoice.amountTooHigh" });

    const rest = await registerPayment(officeActor, created.data.id, {
      amount: "212.50",
      idempotencyKey: "dup-key-2",
    });
    expect(rest.ok).toBe(true);
    if (rest.ok) expect(rest.data.status).toBe("PAID");

    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(paid.paidTotal.toFixed(2)).toBe("312.50");
    expect(paid.outstanding.toFixed(2)).toBe("0.00");
    expect(paid.paidAt).not.toBeNull();
  });

  it("krediterer delvis og fullt, og nekter kreditt over utestående", async () => {
    const invoice = await createSentInvoice({
      lines: [{ description: "Krediterbar", quantity: 1, unitPrice: 100, vatRate: 25 }],
    });

    const over = await registerCreditNote(officeActor, invoice.id, { amount: "999.00" });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.details).toMatchObject({ code: "invoice.amountTooHigh" });

    const partial = await registerCreditNote(officeActor, invoice.id, {
      amount: "50.00",
      reason: "Rabatt",
      issuedAt: "2026-11-07",
    });
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.data.creditNoteNumber).toMatch(/^K-\d{4}-\d{5}$/);

    const afterPartial = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(afterPartial.creditedTotal.toFixed(2)).toBe("50.00");
    expect(afterPartial.outstanding.toFixed(2)).toBe("75.00");
    expect(afterPartial.status).toBe("SENT");

    const rest = await registerCreditNote(officeActor, invoice.id, { amount: "75.00" });
    expect(rest.ok).toBe(true);
    if (rest.ok) expect(rest.data.status).toBe("CREDITED");

    const credited = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(credited.creditedTotal.toFixed(2)).toBe("125.00");
    expect(credited.outstanding.toFixed(2)).toBe("0.00");
    expect(credited.creditedAt).not.toBeNull();
  });

  it("fakturerer bare fullførte oppdrag og rapporter", async () => {
    const draftWorkOrder = await prisma.workOrder.create({
      data: {
        title: unique("Ikke fullført"),
        reference: unique("IT-DRAFT"),
        departmentId,
        customerId: customerAId,
        status: "IN_PROGRESS",
      },
      select: { id: true },
    });
    createdWorkOrderIds.push(draftWorkOrder.id);
    const rejected = await createInvoice(officeActor, {
      customerId: customerAId,
      workOrderId: draftWorkOrder.id,
      lines: [{ description: "For tidlig", quantity: 1, unitPrice: 100 }],
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("conflict");

    const completedWorkOrder = await prisma.workOrder.create({
      data: {
        title: unique("Fullført"),
        reference: unique("IT-DONE"),
        departmentId,
        customerId: customerAId,
        contactId: contactAId,
        status: "COMPLETED",
      },
      select: { id: true },
    });
    createdWorkOrderIds.push(completedWorkOrder.id);
    const created = await createInvoice(officeActor, {
      customerId: customerAId,
      workOrderId: completedWorkOrder.id,
      lines: [{ description: "Utført arbeid", quantity: 1, unitPrice: 250, vatRate: 25 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdInvoiceIds.push(created.data.id);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(invoice.workOrderId).toBe(completedWorkOrder.id);
    expect(invoice.total.toFixed(2)).toBe("312.50");
    expect(invoice.status).toBe("DRAFT");
  });

  it("håndhever rettigheter og isolerer kunder i portalen", async () => {
    const denied = await createQuote(limitedActor, {
      title: "Skal ikke lages",
      customerId: customerAId,
      lines: [{ description: "X", quantity: 1, unitPrice: 100 }],
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("forbidden");

    const quoteAId = await createDraftQuote();
    const quoteBId = await createDraftQuote({ customerId: customerBId, withLinks: false });

    const ownQuote = await getQuote(officeActor, quoteAId);
    expect(ownQuote.ok).toBe(true);
    const quoteForB = await getQuote(officeActor, quoteBId);
    expect(quoteForB.ok).toBe(true);
    const noAccess = await getQuote(limitedActor, quoteAId);
    expect(noAccess.ok).toBe(false);
    if (!noAccess.ok) expect(noAccess.reason).toBe("not_found");

    const invoiceB = await createSentInvoice({
      customerId: customerBId,
      lines: [{ description: "Kunde B", quantity: 1, unitPrice: 200, vatRate: 25 }],
    });

    const customerAActor: ServiceActor = {
      id: "it-portal-a",
      name: "Portal A",
      email: null,
      role: "CUSTOMER",
      isActive: true,
      departmentId: null,
      customerId: customerAId,
      contactId: contactAId,
      permissionsCustomized: false,
      permissions: [],
      roleDefinition: null,
    };
    const listA = await getPortalInvoices(customerAActor);
    expect(listA.ok).toBe(true);
    if (listA.ok) {
      expect(listA.data.invoices.every((row) => row.id !== invoiceB.id)).toBe(true);
    }
    const cross = await getPortalInvoice(customerAActor, invoiceB.id);
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.reason).toBe("not_found");

    // Utskriftsvisningen bruker samme tjenestelag som detaljsiden. En
    // kundeportalbruker skal derfor aldri kunne lese en annen kundes tilbud.
    const crossQuote = await getQuote(customerAActor, quoteBId);
    expect(crossQuote.ok).toBe(false);
    if (!crossQuote.ok) expect(crossQuote.reason).toBe("not_found");
    const ownQuoteViaPortal = await getQuote(customerAActor, quoteAId);
    expect(ownQuoteViaPortal.ok).toBe(true);
  });

  it("markerer forfalte fakturaer og eksporterer stabil CSV", async () => {
    const invoice = await createSentInvoice({
      lines: [{ description: "Forfalt", quantity: 1, unitPrice: 100, vatRate: 25 }],
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        issueDate: new Date("2026-01-01T00:00:00.000Z"),
        dueDate: new Date("2026-01-15T00:00:00.000Z"),
        status: "SENT",
      },
    });
    const marked = await markOverdueInvoices(new Date("2026-06-01T12:00:00.000Z"));
    expect(marked).toBeGreaterThan(0);
    const overdue = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(overdue.status).toBe("OVERDUE");

    const first = await exportInvoicesCsv(officeActor, {});
    const second = await exportInvoicesCsv(officeActor, {});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.data.csv).toBe(second.data.csv);
      expect(first.data.csv).toContain("Fakturanummer");
      expect(first.data.csv).toContain(overdue.invoiceNumber ?? "");
    }
  });

  it("utløper sendte tilbud idempotent", async () => {
    const quoteId = await createDraftQuote();
    const sent = await sendQuote(officeActor, quoteId);
    expect(sent.ok).toBe(true);
    await prisma.quote.update({
      where: { id: quoteId },
      data: { validUntil: new Date("2026-01-01T00:00:00.000Z") },
    });
    const first = await expireQuotes(new Date("2026-06-01T12:00:00.000Z"));
    const second = await expireQuotes(new Date("2026-06-01T12:00:00.000Z"));
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const expired = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(expired.status).toBe("EXPIRED");
  });
});
