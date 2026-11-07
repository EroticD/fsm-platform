import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
  getCurrentUser: vi.fn(),
  getCustomerErasurePreview: vi.fn(),
  eraseCustomerDataAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
  getLocale: async () => "nb",
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/customer-erasure", () => ({
  getCustomerErasurePreview: mocks.getCustomerErasurePreview,
  erasureBlockersFromDetails: () => [],
}));
vi.mock("./actions", () => ({
  eraseCustomerDataAction: mocks.eraseCustomerDataAction,
}));

import { renderToStaticMarkup } from "react-dom/server";
import CustomerPrivacyPage from "./page";

const admin = {
  id: "a1",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "dep",
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
};

const counts = {
  contacts: 2,
  sites: 1,
  portalUsers: 1,
  workOrders: 3,
  reports: 2,
  reportRevisions: 2,
  reportUnits: 4,
  reportDrafts: 0,
  customerAttachments: 1,
  workOrderAttachments: 2,
  documents: 1,
  documentVersions: 1,
  uploads: 6,
  comments: 1,
  messageThreads: 1,
  messages: 2,
  smsMessages: 1,
  bookingRequests: 1,
  contracts: 1,
  products: 2,
  filesScheduledForDeletion: 5,
  reportPdfsRetained: 2,
  customerSignaturesRemoved: 2,
};

function params(id = "c1") {
  return {
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  };
}

function preview(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    data: {
      customerId: "c1",
      customerName: "Kunde Alfa",
      alreadyAnonymised: false,
      anonymisedAt: null,
      counts,
      blockers: [],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(admin);
  mocks.getCustomerErasurePreview.mockResolvedValue(preview());
});

describe("/kunder/[id]/personvern", () => {
  it("rendrer forhåndsvisning, forklaring og bekreftelsesskjema for administrator", async () => {
    const html = renderToStaticMarkup(await CustomerPrivacyPage(params()));

    expect(html).toContain("customers.privacy.previewTitle");
    expect(html).toContain("customers.privacy.formTitle");
    expect(html).toContain("Kunde Alfa");
    expect(html).toContain('id="reason"');
    expect(html).toContain('id="confirmation"');
    expect(html).toContain('name="confirmation"');
    expect(html).toContain("customers.privacy.counts.workOrders");
    expect(mocks.getCustomerErasurePreview).toHaveBeenCalledWith(admin, "c1");
  });

  it("viser blokkeringer og skjuler skjemaet når bevaringsplikt gjelder", async () => {
    mocks.getCustomerErasurePreview.mockResolvedValue(
      preview({
        blockers: [
          {
            kind: "work_order_legal_hold",
            entityType: "WorkOrder",
            entityId: "wo1",
            label: "O-123",
          },
          {
            kind: "audit_hold",
            entityType: "Report",
            entityId: "r1",
            label: "R-9",
            reason: "Tvistesak",
          },
        ],
      }),
    );

    const html = renderToStaticMarkup(await CustomerPrivacyPage(params()));

    expect(html).toContain("customers.privacy.blockers.workOrderLegalHold");
    expect(html).toContain("customers.privacy.blockers.auditHold");
    expect(html).toContain("Tvistesak");
    expect(html).not.toContain('id="reason"');
    expect(html).not.toContain('name="confirmation"');
  });

  it("viser at kunden allerede er anonymisert uten skjema", async () => {
    mocks.getCustomerErasurePreview.mockResolvedValue(
      preview({
        alreadyAnonymised: true,
        anonymisedAt: "2026-11-07T12:00:00.000Z",
      }),
    );

    const html = renderToStaticMarkup(await CustomerPrivacyPage(params()));

    expect(html).toContain("customers.privacy.alreadyTitle");
    expect(html).toContain("customers.privacy.anonymisedAt");
    expect(html).not.toContain('id="reason"');
  });

  it("avviser ikke-administrator før tjenesten kalles", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...admin, role: "OFFICE" });

    await expect(CustomerPrivacyPage(params())).rejects.toThrow(
      "REDIRECT:/kunder/c1",
    );
    expect(mocks.getCustomerErasurePreview).not.toHaveBeenCalled();
  });

  it("avviser inaktiv administrator", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...admin, isActive: false });

    await expect(CustomerPrivacyPage(params())).rejects.toThrow(
      "REDIRECT:/kunder/c1",
    );
    expect(mocks.getCustomerErasurePreview).not.toHaveBeenCalled();
  });

  it("gir 404 når kunden ikke finnes", async () => {
    mocks.getCustomerErasurePreview.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });

    await expect(CustomerPrivacyPage(params())).rejects.toThrow("NOT_FOUND");
  });
});
