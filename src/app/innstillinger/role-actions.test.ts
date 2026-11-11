import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    admin: true,
    users: 0,
  },
  prisma: {
    role: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { count: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(async () => mocks.state.admin),
  getCurrentUser: vi.fn(async () => ({
    id: "admin-1",
    name: "Admin",
    email: "admin@example.test",
    departmentId: "dep-a",
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/innstillinger/role-actions";

function formData(values: Record<string, string>, permissions: string[] = []): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  for (const permission of permissions) form.append("permissions", permission);
  return form;
}

beforeEach(() => {
  mocks.state.admin = true;
  mocks.state.users = 0;
  vi.clearAllMocks();
  mocks.prisma.role.findUnique.mockResolvedValue(null);
  mocks.prisma.role.create.mockResolvedValue({});
  mocks.prisma.role.update.mockResolvedValue({});
  mocks.prisma.role.delete.mockResolvedValue({});
  mocks.prisma.user.count.mockImplementation(async () => mocks.state.users);
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.auditLog.findFirst.mockResolvedValue(null);
  // Revisjonsloggen skrives i samme transaksjon som rolleendringen.
  mocks.prisma.$transaction.mockImplementation(
    async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(mocks.prisma)
        : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("rolleadministrasjon", () => {
  it("lar ikke en ikke-administrator opprette roller", async () => {
    mocks.state.admin = false;
    await createRole(formData({ label: "Serviceleder" }));
    expect(mocks.prisma.role.create).not.toHaveBeenCalled();
  });

  it("oppretter en egendefinert rolle med valgte rettigheter", async () => {
    await expect(
      createRole(
        formData({ label: "Serviceleder", description: "Leder service" }, [
          "workorders.view",
          "customers.manage",
          "ukjent.rettighet",
        ]),
      ),
    ).rejects.toThrow("REDIRECT:/innstillinger?tab=roller&role=created");

    expect(mocks.prisma.role.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "SERVICELEDER",
        label: "Serviceleder",
        isSystem: false,
        permissions: ["workorders.view", "customers.manage"],
      }),
    });
  });

  it("lar ikke systemrollen ADMIN få endret rettighetslisten", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "ADMIN",
      label: "Administrator",
      permissions: ["settings.manage", "audit.view"],
      isSystem: true,
    });

    await expect(
      updateRole(formData({ key: "ADMIN", label: "Administrator" }, ["workorders.view"])),
    ).rejects.toThrow("REDIRECT");

    expect(mocks.prisma.role.update).toHaveBeenCalledWith({
      where: { key: "ADMIN" },
      data: expect.objectContaining({
        permissions: ["settings.manage", "audit.view"],
      }),
    });
  });

  it("nekter å slette en systemrolle", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "TECHNICIAN",
      label: "Montør",
      permissions: [],
      isSystem: true,
    });

    await expect(deleteRole(formData({ key: "TECHNICIAN" }))).rejects.toThrow(
      "REDIRECT:/innstillinger?tab=roller&error=systemrolle",
    );
    expect(mocks.prisma.role.delete).not.toHaveBeenCalled();
  });

  it("nekter å slette en rolle som er i bruk", async () => {
    mocks.state.users = 2;
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "SERVICELEDER",
      label: "Serviceleder",
      permissions: [],
      isSystem: false,
    });

    await expect(deleteRole(formData({ key: "SERVICELEDER" }))).rejects.toThrow(
      "REDIRECT:/innstillinger?tab=roller&error=rolle_i_bruk",
    );
    expect(mocks.prisma.role.delete).not.toHaveBeenCalled();
  });

  it("sletter en ubrukt egendefinert rolle", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "SERVICELEDER",
      label: "Serviceleder",
      permissions: [],
      isSystem: false,
    });

    await expect(deleteRole(formData({ key: "SERVICELEDER" }))).rejects.toThrow(
      "REDIRECT:/innstillinger?tab=roller&role=deleted",
    );
    expect(mocks.prisma.role.delete).toHaveBeenCalledWith({
      where: { key: "SERVICELEDER" },
    });
  });

  it("logger rettigheter som ble lagt til og fjernet, i samme transaksjon", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "SERVICELEDER",
      label: "Serviceleder",
      description: null,
      permissions: ["workorders.view", "customers.manage"],
      isSystem: false,
    });

    await expect(
      updateRole(
        formData({ key: "SERVICELEDER", label: "Serviceleder" }, [
          "workorders.view",
          "reports.view",
        ]),
      ),
    ).rejects.toThrow("REDIRECT:/innstillinger?tab=roller&role=updated");

    const entry = mocks.prisma.auditLog.create.mock.calls[0][0].data;
    expect(entry).toMatchObject({
      entityType: "Role",
      entityId: "SERVICELEDER",
      actionCode: "role.updated",
      outcome: "SUCCESS",
      actorId: "admin-1",
      departmentId: "dep-a",
    });
    expect(entry.metadata.permissionsAdded).toEqual(["reports.view"]);
    expect(entry.metadata.permissionsRemoved).toEqual(["customers.manage"]);
  });

  it("logger avvist sletting av systemrolle som DENIED", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "TECHNICIAN",
      label: "Montør",
      permissions: [],
      isSystem: true,
    });

    await expect(deleteRole(formData({ key: "TECHNICIAN" }))).rejects.toThrow(
      "REDIRECT:/innstillinger?tab=roller&error=systemrolle",
    );

    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Role",
        entityId: "TECHNICIAN",
        actionCode: "role.deleted",
        outcome: "DENIED",
      }),
    });
  });
});
