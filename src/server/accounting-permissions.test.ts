import { describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

vi.mock("@/server/modules", () => ({
  assertModule: vi.fn(async () => undefined),
  moduleEnabled: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    accountingSettings: {
      findUnique: vi.fn(async () => ({ enabled: false, provider: "csv" })),
    },
  },
}));

import {
  resetAccountingSync,
  syncInvoiceToAccounting,
  testAccountingConnection,
  updateAccountingSettings,
} from "./accounting";

const technician: ServiceActor = {
  id: "tech-1",
  name: "Tekniker",
  email: "tech@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dept-1",
  permissionsCustomized: true,
  permissions: [],
  roleDefinition: null,
};

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

describe("rettigheter for regnskapssynk", () => {
  it("avviser tekniker uten customers.manage", async () => {
    await expect(updateAccountingSettings(technician, { enabled: true })).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    await expect(testAccountingConnection(technician)).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    await expect(syncInvoiceToAccounting(technician, "inv-1")).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    await expect(resetAccountingSync(technician, "inv-1")).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("krever administrator for innstillinger og test, men ikke for manuell synk", async () => {
    await expect(updateAccountingSettings(office, { enabled: true })).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    await expect(testAccountingConnection(office)).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    // Manuell synk går videre til tilstandskontrollen, ikke til forbidden.
    const result = await syncInvoiceToAccounting(office, "inv-1");
    expect(result).not.toMatchObject({ reason: "forbidden" });
  });
});
