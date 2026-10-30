import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  branding: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks }));

import { renderContractPdf, type ContractPdfData } from "./contract-pdf";

const contract: ContractPdfData = {
  id: "contract-1",
  title: "Årlig service",
  contractNumber: "A-100",
  status: "ACTIVE",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-12-31T00:00:00.000Z"),
  intervalMonths: 12,
  renewalMode: "AUTO",
  noticeDays: 30,
  indexationPercent: null,
  customer: {
    name: "Acme AS",
    customerNumber: "K-100",
    orgNumber: "999888777",
    address: "Gate 1",
    postalCode: "0100",
    city: "Oslo",
    phone: "12345678",
    email: "post@acme.test",
  },
  department: { name: "Øst" },
  contact: null,
  slaPolicy: {
    name: "Standard",
    responseMinutes: 60,
    resolutionMinutes: 240,
    businessHoursOnly: true,
  },
  priceList: {
    name: "Standard",
    items: [
      {
        id: "item-1",
        code: "SVC",
        label: "Service",
        unit: "stk",
        amount: 1250,
      },
    ],
  },
  lines: [
    {
      id: "line-1",
      scope: "Pumpe",
      visitsPerYear: 2,
      responseMinutes: null,
      resolutionMinutes: null,
      product: {
        model: "Pumpe 2000",
        serialNumber: "SN-1",
        location: "Kjeller",
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.branding.findFirst.mockResolvedValue({
    companyName: "Test Service",
    primaryColor: "#101310",
  });
});

describe("contract-pdf", () => {
  it("rendrer en PDF for avtalen", async () => {
    const buffer = await renderContractPdf(contract, "nb");
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("godtar alle fire språk", async () => {
    for (const locale of ["nb", "en", "pl", "de"]) {
      const buffer = await renderContractPdf(contract, locale);
      expect(buffer.subarray(0, 4).toString(), locale).toBe("%PDF");
    }
  });
});
