import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    quote: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    quoteVersion: { findUnique: vi.fn(), create: vi.fn() },
    invoice: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    invoiceLine: { deleteMany: vi.fn(), createMany: vi.fn() },
    billingSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  assertModule: vi.fn(),
  enqueueQuoteSentEmail: vi.fn(),
  enqueueInvoiceSentEmail: vi.fn(),
  enqueuePaymentReceivedEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("./modules", () => ({
  assertModule: mocks.assertModule,
  moduleEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("./email-outbox", () => ({
  enqueueQuoteSentEmail: mocks.enqueueQuoteSentEmail,
  enqueueInvoiceSentEmail: mocks.enqueueInvoiceSentEmail,
  enqueuePaymentReceivedEmail: mocks.enqueuePaymentReceivedEmail,
}));

import { sendQuote } from "./quotes";
import { sendInvoice } from "./invoices";

const office: ServiceActor = {
  id: "office-1",
  name: "Kontor",
  email: "kontor@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
  permissions: ["customers.manage", "customers.view", "workorders.view"],
  permissionsCustomized: true,
  roleDefinition: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertModule.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.enqueueQuoteSentEmail.mockResolvedValue({
    queued: true,
    id: "em-1",
    reason: "queued",
  });
  mocks.enqueueInvoiceSentEmail.mockResolvedValue({
    queued: true,
    id: "em-2",
    reason: "queued",
  });
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
});

describe("tilbudstrigger", () => {
  it("legger tilbuds-e-posten i utboksen etter at tilbudet er sendt", async () => {
    mocks.prisma.quote.findFirst.mockResolvedValue({
      id: "q-1",
      status: "DRAFT",
      version: 3,
      validUntil: null,
      title: "Årlig service",
      quoteNumber: "T-100",
      total: new Prisma.Decimal(1250),
      currency: "NOK",
      customerId: "c-1",
      contactId: "k-1",
      customerName: null,
      customer: { name: "Kunde AS" },
    });
    mocks.prisma.billingSettings.findUnique.mockResolvedValue({
      id: "default",
      approvalTokenTtlHours: 72,
    });
    mocks.prisma.quote.findUnique.mockResolvedValue({
      id: "q-1",
      quoteNumber: "T-100",
      title: "Årlig service",
      version: 3,
      status: "DRAFT",
      currency: "NOK",
      subtotal: new Prisma.Decimal(1000),
      vatTotal: new Prisma.Decimal(250),
      total: new Prisma.Decimal(1250),
      vatRate: new Prisma.Decimal(25),
      validUntil: null,
      notes: null,
      customerName: null,
      customer: { name: "Kunde AS", customerNumber: null, orgNumber: null },
      contact: null,
      product: null,
      lines: [],
    });
    mocks.prisma.quoteVersion.findUnique.mockResolvedValue(null);
    mocks.prisma.quoteVersion.create.mockResolvedValue({});
    mocks.prisma.quote.update.mockResolvedValue({});
    mocks.prisma.quote.updateMany.mockResolvedValue({ count: 1 });

    const result = await sendQuote(office, "q-1");

    expect(result.ok).toBe(true);
    expect(mocks.enqueueQuoteSentEmail).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueQuoteSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: "q-1",
        version: 3,
        title: "Årlig service",
        reference: "T-100",
        customerName: "Kunde AS",
        customerId: "c-1",
        contactId: "k-1",
      }),
    );
  });
});

describe("fakturatrigger", () => {
  it("legger faktura-e-posten i utboksen etter at fakturaen er sendt", async () => {
    mocks.prisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: "DRAFT",
      invoiceNumber: null,
      issueDate: new Date("2026-11-09T00:00:00Z"),
      dueDate: new Date("2026-11-23T00:00:00Z"),
      total: new Prisma.Decimal(2500),
    });
    mocks.prisma.billingSettings.findUnique.mockResolvedValue({
      invoiceDueDays: 14,
    });
    mocks.prisma.billingSettings.update.mockResolvedValue({
      invoicePrefix: "F",
      nextInvoiceNumber: 2,
    });
    mocks.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      invoiceNumber: "F-2026-0001",
      customerId: "c-1",
      contactId: "k-1",
      currency: "NOK",
      total: new Prisma.Decimal(2500),
      dueDate: new Date("2026-11-23T00:00:00Z"),
      customer: { name: "Kunde AS" },
    });

    const result = await sendInvoice(office, "inv-1");

    expect(result).toMatchObject({ ok: true, data: { alreadySent: false } });
    expect(mocks.enqueueInvoiceSentEmail).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueInvoiceSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "inv-1",
        invoiceNumber: "F-2026-0001",
        customerId: "c-1",
        contactId: "k-1",
        customerName: "Kunde AS",
      }),
    );
  });

  it("sender ikke e-post på nytt når fakturaen allerede er sendt", async () => {
    mocks.prisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: "SENT",
      invoiceNumber: "F-2026-0001",
      issueDate: new Date("2026-11-09T00:00:00Z"),
      dueDate: new Date("2026-11-23T00:00:00Z"),
      total: new Prisma.Decimal(2500),
    });

    const result = await sendInvoice(office, "inv-1");

    expect(result).toMatchObject({ ok: true, data: { alreadySent: true } });
    expect(mocks.enqueueInvoiceSentEmail).not.toHaveBeenCalled();
  });
});
