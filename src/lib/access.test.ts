import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    user: null as null | {
      id: string;
      role: string;
      isActive: boolean;
      departmentId: string | null;
      customerId?: string | null;
      permissions?: string[];
    },
  },
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { workOrder: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => mocks.state.user),
}));

import {
  canAccessWorkOrder,
  requireWorkOrderAccess,
  workOrderScope,
} from "@/lib/access";

const technician = {
  id: "tech",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-a",
  customerId: null,
  permissions: [] as string[],
};

beforeEach(() => {
  mocks.state.user = technician;
  mocks.findFirst.mockReset();
});

describe("workOrderScope", () => {
  it("lar administrator se alle oppdrag", () => {
    expect(
      workOrderScope({ ...technician, role: "ADMIN" } as never),
    ).toEqual({ deletedAt: null });
  });

  it("begrenser ansatte til egen avdeling", () => {
    expect(workOrderScope(technician as never)).toEqual({
      departmentId: "dep-a",
      deletedAt: null,
    });
  });

  it("lar ansatte uten avdeling se ingen oppdrag", () => {
    expect(
      workOrderScope({ ...technician, departmentId: null } as never),
    ).toEqual({ id: { in: [] } });
  });

  it("lar en USER med utvidet oppdragstilgang se egen avdeling", () => {
    expect(
      workOrderScope({
        ...technician,
        role: "USER",
        permissions: ["workorders.view"],
      } as never),
    ).toEqual({ departmentId: "dep-a", deletedAt: null });
  });

  it("gir ikke en USER uten oppdragsrettigheter tilgang", () => {
    expect(
      workOrderScope({
        ...technician,
        role: "USER",
        permissions: ["documents.view"],
      } as never),
    ).toEqual({ id: { in: [] } });
  });

  it("begrenser kundeportalbrukere til egen kunde", () => {
    expect(
      workOrderScope({
        ...technician,
        role: "CUSTOMER",
        customerId: "customer-1",
      } as never),
    ).toEqual({ customerId: "customer-1", deletedAt: null });
  });

  it("gir ingen oppdrag til inaktive brukere", () => {
    expect(
      workOrderScope({ ...technician, isActive: false } as never),
    ).toEqual({ id: { in: [] } });
  });
});

describe("canAccessWorkOrder", () => {
  it("sammenligner avdeling for ansatte", () => {
    expect(
      canAccessWorkOrder(technician as never, {
        departmentId: "dep-a",
        customerId: "customer-1",
      }),
    ).toBe(true);
    expect(
      canAccessWorkOrder(technician as never, {
        departmentId: "dep-b",
        customerId: "customer-1",
      }),
    ).toBe(false);
  });

  it("sammenligner kunde for kundeportalbrukere", () => {
    const customer = {
      ...technician,
      role: "CUSTOMER",
      customerId: "customer-1",
    };
    expect(
      canAccessWorkOrder(customer as never, {
        departmentId: "dep-b",
        customerId: "customer-1",
      }),
    ).toBe(true);
    expect(
      canAccessWorkOrder(customer as never, {
        departmentId: "dep-b",
        customerId: "customer-2",
      }),
    ).toBe(false);
  });
});

describe("requireWorkOrderAccess", () => {
  it("skjuler kansellerte oppdrag for montører", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "customer-1",
      status: "CANCELLED",
    });

    await expect(
      requireWorkOrderAccess("workorders.update", "wo-1"),
    ).resolves.toBeNull();
  });

  it("lar kontoret følge opp kansellerte oppdrag", async () => {
    mocks.state.user = {
      ...technician,
      role: "OFFICE",
      permissions: ["workorders.update"],
    };
    mocks.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "customer-1",
      status: "CANCELLED",
    });

    const access = await requireWorkOrderAccess("workorders.update", "wo-1");
    expect(access?.workOrder.id).toBe("wo-1");
  });

  it("avviser oppdrag utenfor brukerens avdeling", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      requireWorkOrderAccess("workorders.update", "wo-2"),
    ).resolves.toBeNull();
  });
});
