import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  getEquipment: vi.fn(),
  resolveEquipmentQrToken: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/server/equipment", () => ({
  getEquipment: mocks.getEquipment,
  resolveEquipmentQrToken: mocks.resolveEquipmentQrToken,
}));
vi.mock("@/lib/prisma", () => ({
  default: { workOrder: { findFirst: mocks.findFirst } },
}));

import { resolveScanCode } from "./scan";

const token = "AbCdEfGhIjKlMnOpQrSt1234";

const technician: ServiceActor = {
  id: "tech-1",
  name: "Ola Montør",
  email: "ola@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-1",
  permissionsCustomized: false,
  roleDefinition: {
    permissions: ["workorders.view", "equipment.view"],
  },
};

const office: ServiceActor = {
  ...technician,
  id: "office-1",
  role: "OFFICE",
};

const customer: ServiceActor = {
  ...technician,
  id: "customer-1",
  role: "CUSTOMER",
  customerId: "cust-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveScanCode", () => {
  it("rejects an unknown code without touching the database", async () => {
    await expect(resolveScanCode(technician, "hello world")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.getEquipment).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("re-authorizes an equipment QR token before redirecting", async () => {
    mocks.resolveEquipmentQrToken.mockResolvedValue({
      id: "prod-1",
      model: "Pumpe",
    });
    mocks.getEquipment.mockResolvedValue({ ok: true, data: { equipment: {} } });

    await expect(resolveScanCode(technician, token)).resolves.toEqual({
      ok: true,
      href: "/enheter/prod-1",
    });
    expect(mocks.getEquipment).toHaveBeenCalledWith(technician, "prod-1");
  });

  it("does not reveal equipment the actor cannot access", async () => {
    mocks.resolveEquipmentQrToken.mockResolvedValue({
      id: "prod-2",
      model: "Pumpe",
    });
    mocks.getEquipment.mockResolvedValue({ ok: false, reason: "not_found" });

    await expect(resolveScanCode(technician, token)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("maps a missing permission to forbidden", async () => {
    mocks.getEquipment.mockResolvedValue({ ok: false, reason: "forbidden" });

    await expect(
      resolveScanCode(technician, "/enheter/prod-3"),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("opens a work order by reference for a technician", async () => {
    mocks.findFirst.mockResolvedValue({ id: "wo-1" });

    await expect(
      resolveScanCode(technician, "O-261103-ABCD1234"),
    ).resolves.toEqual({ ok: true, href: "/mine-oppdrag/wo-1" });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: "dep-1",
          OR: [
            { reference: "O-261103-ABCD1234" },
            { orderNumber: "O-261103-ABCD1234" },
          ],
        }),
      }),
    );
  });

  it("opens the office work-order page for office staff", async () => {
    mocks.findFirst.mockResolvedValue({ id: "wo-2" });

    await expect(resolveScanCode(office, "/oppdrag/wo-2")).resolves.toEqual({
      ok: true,
      href: "/oppdrag/wo-2",
    });
  });

  it("does not let a customer portal user scan into work orders", async () => {
    await expect(
      resolveScanCode(customer, "O-261103-ABCD1234"),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("returns not_found when the work order is outside scope", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(resolveScanCode(technician, "100123")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
