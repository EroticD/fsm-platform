import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const state = vi.hoisted(() => ({
  syncRow: null as Record<string, unknown> | null,
  settingsRow: {
    id: "default",
    provider: "fiken",
    enabled: true,
    lastTestedAt: null,
    lastTestOk: null,
    lastTestError: null,
    lastSyncAt: null,
    lastSyncError: null,
  },
}));

const mocks = vi.hoisted(() => {
  const invoice = {
    id: "inv-1",
    invoiceNumber: "F-2026-00001",
    issueDate: new Date("2026-11-09T00:00:00Z"),
    dueDate: new Date("2026-11-23T00:00:00Z"),
    currency: "NOK",
    notes: null,
    subtotal: { toFixed: () => "200.00" },
    vatTotal: { toFixed: () => "50.00" },
    total: { toFixed: () => "250.00" },
    customer: {
      id: "cust-1",
      name: "Kunde AS",
      orgNumber: null,
      email: null,
      phone: null,
      address: null,
      postalCode: null,
      city: null,
    },
    lines: [],
    payments: [],
  };

  const syncInvoice = vi.fn(async () => ({
    externalId: "ext-inv-1",
    externalNumber: "501",
    mode: "api" as const,
  }));
  const syncCustomer = vi.fn(async () => ({
    externalId: "ext-cust-1",
    externalNumber: null,
    mode: "api" as const,
  }));
  const recordPayment = vi.fn(async () => ({
    externalId: "ext-pay-1",
    externalNumber: null,
    mode: "api" as const,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: Record<string, any> = {
    invoice: { findFirst: vi.fn(async () => invoice) },
    accountingSettings: {
      findUnique: vi.fn(async () => state.settingsRow),
      update: vi.fn(async () => state.settingsRow),
      upsert: vi.fn(async () => state.settingsRow),
    },
    accountingSync: {
      findUnique: vi.fn(async () => state.syncRow),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.syncRow = { id: "sync-1", ...data };
        return state.syncRow;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.syncRow = { ...(state.syncRow ?? {}), ...data };
        return state.syncRow;
      }),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    accountingCustomer: {
      findUnique: vi.fn(async () => ({ externalId: "ext-cust-1" })),
      create: vi.fn(async () => ({})),
    },
    accountingPayment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "ap-1" })),
      update: vi.fn(async () => ({})),
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));

  return { prisma, syncInvoice, syncCustomer, recordPayment };
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/modules", () => ({
  assertModule: vi.fn(async () => undefined),
  moduleEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/accounting/provider", () => ({
  resolveAccountingProviderName: () => "fiken",
  accountingProviderInfo: () => ({
    provider: "fiken",
    mode: "api",
    configured: true,
    settings: { baseUrl: true, company: true, paymentAccounts: true },
  }),
  getAccountingProvider: () => ({
    name: "fiken",
    mode: "api",
    configured: () => true,
    testConnection: async () => ({ ok: true, message: "connected" }),
    syncCustomer: mocks.syncCustomer,
    syncInvoice: mocks.syncInvoice,
    recordPayment: mocks.recordPayment,
  }),
}));

import { syncInvoiceToAccounting } from "./accounting";

const office: ServiceActor = {
  id: "office-1",
  name: "Kontor",
  email: "office@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dept-1",
  permissionsCustomized: true,
  permissions: ["customers.manage"],
  roleDefinition: null,
};

beforeEach(() => {
  state.syncRow = null;
  state.settingsRow = { ...state.settingsRow, enabled: true };
  vi.clearAllMocks();
});

describe("idempotent regnskapssynk", () => {
  it("gjenbruker en fullført synk uten nye leverandørkall", async () => {
    const first = await syncInvoiceToAccounting(office, "inv-1");
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);
    expect(first.data).toMatchObject({
      provider: "fiken",
      status: "SYNCED",
      externalInvoiceId: "ext-inv-1",
      alreadySynced: false,
    });
    expect(mocks.syncInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.syncCustomer).not.toHaveBeenCalled();

    const second = await syncInvoiceToAccounting(office, "inv-1");
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.reason);
    expect(second.data).toMatchObject({
      status: "SYNCED",
      externalInvoiceId: "ext-inv-1",
      alreadySynced: true,
    });
    expect(mocks.syncInvoice).toHaveBeenCalledTimes(1);
  });

  it("avviser synk når integrasjonen er slått av", async () => {
    state.settingsRow = { ...state.settingsRow, enabled: false };
    const result = await syncInvoiceToAccounting(office, "inv-1");
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "accounting.disabled" },
    });
    expect(mocks.syncInvoice).not.toHaveBeenCalled();
  });
});
