import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  departmentFindMany: vi.fn(),
  listSkills: vi.fn(),
  listWorkforceStaff: vi.fn(),
  listUserSkills: vi.fn(),
  listUserAvailability: vi.fn(),
  listAbsences: vi.fn(),
  listCapacityPlans: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { department: { findMany: mocks.departmentFindMany } },
}));
vi.mock("./workforce", () => ({
  listSkills: mocks.listSkills,
  listWorkforceStaff: mocks.listWorkforceStaff,
  listUserSkills: mocks.listUserSkills,
  listUserAvailability: mocks.listUserAvailability,
  listAbsences: mocks.listAbsences,
}));
vi.mock("./dispatch", () => ({
  listCapacityPlans: mocks.listCapacityPlans,
}));

import { getWorkforceAdminView } from "./workforce-admin";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    contactId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["users.view", "users.manage", "dispatch.configure"],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.departmentFindMany.mockResolvedValue([
    { id: "dep-a", name: "Hovedavdeling" },
  ]);
  mocks.listSkills.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "skill-1",
        key: "hms.sja",
        label: "SJA",
        category: "HMS",
        userCount: 1,
        workOrderCount: 0,
      },
    ],
  });
  mocks.listWorkforceStaff.mockResolvedValue({
    ok: true,
    data: [
      {
        id: "staff-1",
        name: "Ola Montør",
        email: "ola@example.test",
        departmentId: "dep-a",
        departmentName: "Hovedavdeling",
      },
    ],
  });
  mocks.listUserSkills.mockResolvedValue({ ok: true, data: [] });
  mocks.listUserAvailability.mockResolvedValue({ ok: true, data: [] });
  mocks.listAbsences.mockResolvedValue({ ok: true, data: [] });
  mocks.listCapacityPlans.mockResolvedValue({ ok: true, data: [] });
});

describe("getWorkforceAdminView", () => {
  it("avviser aktører uten lese- eller dispatchtilgang", async () => {
    const result = await getWorkforceAdminView(
      actor({ roleDefinition: { permissions: [] } }),
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.departmentFindMany).not.toHaveBeenCalled();
  });

  it("gir katalog og ansattliste med users.view, men ikke persondetaljer", async () => {
    const result = await getWorkforceAdminView(
      actor({
        roleDefinition: { permissions: ["users.view"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skills).toHaveLength(1);
    expect(result.data.staff).toHaveLength(1);
    expect(result.data.selectedStaffId).toBe("staff-1");
    expect(result.data.userSkills).toEqual([]);
    expect(mocks.listUserSkills).not.toHaveBeenCalled();
    expect(mocks.listCapacityPlans).not.toHaveBeenCalled();
  });

  it("leser valgt ansatt med users.manage og kapasitet med dispatch.configure", async () => {
    const result = await getWorkforceAdminView(actor(), {
      staffId: "staff-1",
      departmentId: "dep-a",
      from: "2026-11-02",
      to: "2026-11-08",
    });

    expect(result.ok).toBe(true);
    expect(mocks.listUserSkills).toHaveBeenCalledWith(expect.anything(), "staff-1");
    expect(mocks.listUserAvailability).toHaveBeenCalledWith(
      expect.anything(),
      "staff-1",
    );
    expect(mocks.listAbsences).toHaveBeenCalledWith(expect.anything(), "staff-1");
    expect(mocks.listCapacityPlans).toHaveBeenCalledWith(expect.anything(), {
      departmentId: "dep-a",
      from: "2026-11-02",
      to: "2026-11-08",
    });
  });

  it("faller tilbake til gyldig periode og første avdeling", async () => {
    const result = await getWorkforceAdminView(actor(), {
      departmentId: "dep-ukjent",
      from: "2026-02-30",
      to: "ugyldig",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.capacityDepartmentId).toBe("dep-a");
    expect(result.data.capacityFrom).toBe(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Oslo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
  });
});
