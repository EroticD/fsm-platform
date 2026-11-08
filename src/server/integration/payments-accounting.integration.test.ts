import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { invalidateModuleCache } from "@/server/modules";
import type { ServiceActor } from "@/server/actor";
import {
  createInvoice,
  registerPayment,
  sendInvoice,
} from "@/server/invoices";
import {
  applyPaymentEvent,
  createInvoicePaymentLink,
} from "@/server/payments";
import {
  getAccountingSettings,
  syncInvoiceToAccounting,
  updateAccountingSettings,
} from "@/server/accounting";
import type { PaymentWebhookEvent } from "@/lib/payments/types";

const describeIntegration = integrationEnabled ? describe : describe.skip;

let departmentId = "";
let customerId = "";
let customerBId = "";
let adminUserId = "";

const createdInvoiceIds: string[] = [];

const officeActor: ServiceActor = {
  id: "it-payments-office",
  name: "Betaling og regnskap",
  email: "payments@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: null,
  permissionsCustomized: true,
  permissions: ["customers.view", "customers.manage", "settings.manage"],
  roleDefinition: null,
};

function adminActor(): ServiceActor {
  return {
    id: adminUserId,
    name: "Betalingsadmin",
    email: "pay-admin@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId,
    permissionsCustomized: false,
    permissions: [],
    roleDefinition: { permissions: [] },
  };
}

async function createSentInvoice(options: { unitPrice?: number; customerId?: string } = {}) {
  const created = await createInvoice(officeActor, {
    customerId: options.customerId ?? customerId,
    lines: [
      {
        description: "Service",
        quantity: 1,
        unitPrice: options.unitPrice ?? 100,
        vatRate: 25,
      },
    ],
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.reason);
  createdInvoiceIds.push(created.data.id);
  const sent = await sendInvoice(officeActor, created.data.id);
  expect(sent.ok).toBe(true);
  if (!sent.ok) throw new Error(sent.reason);
  return { id: created.data.id, invoiceNumber: sent.data.invoiceNumber };
}

function paidEvent(
  invoiceId: string,
  overrides: Partial<PaymentWebhookEvent> = {},
): PaymentWebhookEvent {
  return {
    provider: "stripe",
    eventId: `evt_${unique("x")}`,
    providerPaymentId: `pi_${unique("x")}`,
    outcome: "PAID",
    invoiceId,
    reference: null,
    amount: "50.00",
    currency: "NOK",
    paidAt: new Date("2026-11-09T12:00:00Z"),
    eventType: "payment_intent.succeeded",
    failureReason: null,
    ...overrides,
  };
}

function setStripeEnv() {
  process.env.PAYMENTS_PROVIDER = "stripe";
  process.env.STRIPE_SECRET_KEY = "sk_test_integration";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration";
}

function setFikenEnv() {
  process.env.ACCOUNTING_PROVIDER = "fiken";
  process.env.FIKEN_TOKEN = "fiken-token-integration";
  process.env.FIKEN_COMPANY_SLUG = "demo";
  process.env.FIKEN_BANK_ACCOUNT = "1920:10001";
  process.env.FIKEN_PAYMENT_DEBIT_ACCOUNT = "1920:10001";
  process.env.FIKEN_PAYMENT_CREDIT_ACCOUNT = "1500:10001";
}

describeIntegration("betaling og regnskap mot ekte PostgreSQL", () => {
  beforeAll(async () => {
    const department = await prisma.department.create({ data: { name: unique("IT-pay") } });
    departmentId = department.id;
    officeActor.departmentId = departmentId;

    const customer = await prisma.customer.create({
      data: {
        name: unique("Betalingskunde"),
        departmentId,
        orgNumber: "999888777",
        email: "kunde@example.test",
        address: "Gate 1",
        postalCode: "0150",
        city: "Oslo",
      },
    });
    customerId = customer.id;

    const customerB = await prisma.customer.create({
      data: { name: unique("Betalingskunde B"), departmentId },
    });
    customerBId = customerB.id;

    const user = await prisma.user.create({
      data: {
        name: "Betalingsadmin",
        email: `${unique("pay-admin")}@example.test`,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    });
    adminUserId = user.id;

    await prisma.moduleState.upsert({
      where: { key: "invoicing" },
      update: { enabled: true },
      create: { key: "invoicing", enabled: true },
    });
    await prisma.billingSettings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });
    invalidateModuleCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PAYMENTS_PROVIDER;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.ACCOUNTING_PROVIDER;
    delete process.env.FIKEN_TOKEN;
    delete process.env.FIKEN_COMPANY_SLUG;
    delete process.env.FIKEN_BANK_ACCOUNT;
    delete process.env.FIKEN_PAYMENT_DEBIT_ACCOUNT;
    delete process.env.FIKEN_PAYMENT_CREDIT_ACCOUNT;
  });

  afterAll(async () => {
    await prisma.accountingSync.deleteMany({
      where: { invoiceId: { in: createdInvoiceIds } },
    });
    await prisma.accountingCustomer.deleteMany({
      where: { customerId: { in: [customerId, customerBId] } },
    });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.creditNote.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, customerBId] } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    if (adminUserId) await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.accountingSettings.deleteMany({ where: { id: "default" } });
  });

  it("oppretter betalingslenke, registrerer delbetaling og håndterer duplikat", async () => {
    setStripeEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_integration",
          url: "https://checkout.stripe.test/cs_test_integration",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const invoice = await createSentInvoice();
    const link = await createInvoicePaymentLink(officeActor, invoice.id);
    expect(link.ok).toBe(true);
    if (!link.ok) throw new Error(link.reason);
    expect(link.data).toMatchObject({
      provider: "stripe",
      url: "https://checkout.stripe.test/cs_test_integration",
      status: "PENDING",
    });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.paymentStatus).toBe("PENDING");
    expect(stored.paymentProvider).toBe("stripe");
    expect(stored.paymentLinkUrl).toContain("checkout.stripe.test");

    const event = paidEvent(invoice.id);
    const first = await applyPaymentEvent("stripe", event);
    if (first.outcome !== "payment") throw new Error(`first failed: ${first.reason}`);
    expect(first).toMatchObject({ outcome: "payment", invoiceId: invoice.id });

    let current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(current.status).toBe("PARTIALLY_PAID");
    expect(current.paymentStatus).toBe("PARTIALLY_PAID");
    expect(current.paidTotal.toFixed(2)).toBe("50.00");
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(payment).toMatchObject({
      method: "ONLINE",
      provider: "stripe",
      providerEventId: event.eventId,
      providerReference: event.providerPaymentId,
    });

    const duplicate = await applyPaymentEvent("stripe", event);
    expect(duplicate.outcome).toBe("duplicate");
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);

    const second = await applyPaymentEvent(
      "stripe",
      paidEvent(invoice.id, { amount: "75.00" }),
    );
    expect(second.outcome).toBe("payment");
    current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(current.status).toBe("PAID");
    expect(current.paymentStatus).toBe("PAID");
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(2);

    const lateDuplicate = await applyPaymentEvent("stripe", event);
    expect(lateDuplicate.outcome).toBe("duplicate");
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(2);
  });

  it("avviser feil valuta og for høyt beløp uten å føre betaling", async () => {
    setStripeEnv();
    const invoice = await createSentInvoice();
    const wrongCurrency = await applyPaymentEvent(
      "stripe",
      paidEvent(invoice.id, { amount: "10.00", currency: "USD" }),
    );
    expect(wrongCurrency).toMatchObject({ outcome: "ignored", reason: "currency_mismatch" });

    const tooHigh = await applyPaymentEvent(
      "stripe",
      paidEvent(invoice.id, { amount: "999.00" }),
    );
    expect(tooHigh).toMatchObject({ outcome: "ignored", reason: "amount_too_high" });

    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    const current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(current.status).toBe("SENT");
    expect(current.paymentStatus).toBe("FAILED");
  });

  it("er en no-op for betalingslenke når leverandøren er av", async () => {
    process.env.PAYMENTS_PROVIDER = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const invoice = await createSentInvoice();
    const result = await createInvoicePaymentLink(officeActor, invoice.id);
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "payments.disabled" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const current = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(current.paymentStatus).toBe("NONE");
  });

  it("synkroniserer kunde, faktura og betaling idempotent", async () => {
    setFikenEnv();
    const enabled = await updateAccountingSettings(adminActor(), { enabled: true });
    expect(enabled.ok).toBe(true);

    const invoice = await createSentInvoice();
    const paid = await registerPayment(officeActor, invoice.id, {
      amount: "125.00",
      method: "BANK_TRANSFER",
      idempotencyKey: unique("bank"),
    });
    expect(paid.ok).toBe(true);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 201,
          headers: {
            location: "https://api.fiken.no/api/v2/companies/demo/contacts/123",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invoiceNumber: 501 }), {
          status: 201,
          headers: {
            location: "https://api.fiken.no/api/v2/companies/demo/invoices/999",
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 201,
          headers: {
            location:
              "https://api.fiken.no/api/v2/companies/demo/generalJournalEntries/777",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await syncInvoiceToAccounting(officeActor, invoice.id);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(first.data).toMatchObject({
      provider: "fiken",
      status: "SYNCED",
      externalInvoiceId: "999",
      externalInvoiceNumber: "501",
      alreadySynced: false,
      paymentsSynced: 1,
      paymentFailures: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const sync = await prisma.accountingSync.findUniqueOrThrow({
      where: { invoiceId_provider: { invoiceId: invoice.id, provider: "fiken" } },
    });
    expect(sync).toMatchObject({ status: "SYNCED", attemptCount: 1, externalInvoiceId: "999" });
    const accountingPayment = await prisma.accountingPayment.findFirstOrThrow({
      where: { syncId: sync.id },
    });
    expect(accountingPayment.status).toBe("SYNCED");

    const second = await syncInvoiceToAccounting(officeActor, invoice.id);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.reason);
    expect(second.data.alreadySynced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const settings = await getAccountingSettings();
    expect(settings.lastSyncAt).not.toBeNull();
    expect(settings.lastSyncError).toBeNull();
  });

  it("lagrer feil og lar en ny synk prøve på nytt", async () => {
    setFikenEnv();
    await updateAccountingSettings(adminActor(), { enabled: true });
    const invoice = await createSentInvoice({ customerId: customerBId });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const failed = await syncInvoiceToAccounting(officeActor, invoice.id);
    expect(failed).toMatchObject({
      ok: false,
      reason: "error",
      details: { code: "accounting.syncFailed", retryable: true },
    });
    let sync = await prisma.accountingSync.findUniqueOrThrow({
      where: { invoiceId_provider: { invoiceId: invoice.id, provider: "fiken" } },
    });
    expect(sync).toMatchObject({
      status: "FAILED",
      attemptCount: 1,
      lastError: "provider_error",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 201,
          headers: {
            location: "https://api.fiken.no/api/v2/companies/demo/contacts/321",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 201,
          headers: {
            location: "https://api.fiken.no/api/v2/companies/demo/invoices/1001",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const retried = await syncInvoiceToAccounting(officeActor, invoice.id);
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error(retried.reason);
    expect(retried.data.status).toBe("SYNCED");
    sync = await prisma.accountingSync.findUniqueOrThrow({
      where: { invoiceId_provider: { invoiceId: invoice.id, provider: "fiken" } },
    });
    expect(sync).toMatchObject({
      status: "SYNCED",
      attemptCount: 2,
      lastError: null,
      externalInvoiceId: "1001",
    });
  });

  it("CSV-fallback markerer eksport uten eksternt kall", async () => {
    process.env.ACCOUNTING_PROVIDER = "csv";
    await updateAccountingSettings(adminActor(), { enabled: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const invoice = await createSentInvoice();

    const result = await syncInvoiceToAccounting(officeActor, invoice.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data).toMatchObject({
      provider: "csv",
      status: "EXPORTED",
      externalInvoiceId: `csv-invoice:${invoice.id}`,
      alreadySynced: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const sync = await prisma.accountingSync.findUniqueOrThrow({
      where: { invoiceId_provider: { invoiceId: invoice.id, provider: "csv" } },
    });
    expect(sync.status).toBe("EXPORTED");
  });
});
