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
    user: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(async () => mocks.state.admin),
  actorName: vi.fn(async () => "Admin"),
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
});
