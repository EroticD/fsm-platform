import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    role: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn() },
    department: { findFirst: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  createInviteToken: vi.fn(async () => "raa-token"),
  sendInviteEmail: vi.fn(async () => false),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/invite", () => ({
  createInviteToken: mocks.createInviteToken,
  buildInviteUrl: (token: string) =>
    `https://example.test/aktiver-konto?token=${token}`,
}));
vi.mock("@/lib/email", () => ({ sendInviteEmail: mocks.sendInviteEmail }));

import {
  changePermissions,
  changeRole,
  createUser,
  generateInvite,
} from "./users";

const roles = {
  ADMIN: {
    key: "ADMIN",
    label: "Administrator",
    permissions: [
      "settings.manage",
      "audit.view",
      "users.manage",
      "customers.manage",
    ],
  },
  OFFICE: {
    key: "OFFICE",
    label: "Kontor",
    permissions: [
      "workorders.view",
      "customers.manage",
      "users.manage",
      "users.view",
      "reports.write",
    ],
  },
  TECHNICIAN: {
    key: "TECHNICIAN",
    label: "Montør",
    permissions: ["workorders.view", "reports.write"],
  },
  USER: { key: "USER", label: "Standard", permissions: [] },
  CUSTOMER: { key: "CUSTOMER", label: "Kundeportal", permissions: [] },
};

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "Actor",
    email: "actor@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: roles.OFFICE.permissions },
    ...overrides,
  };
}

const admin = () => actor({ role: "ADMIN" });
const office = () => actor();
const noAccess = () =>
  actor({
    role: "USER",
    roleDefinition: { permissions: [] },
  });

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: "target",
    name: "Target",
    email: "target@example.test",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.role.findUnique.mockImplementation(
    async ({ where }: { where: { key: string } }) =>
      roles[where.key as keyof typeof roles] ?? null,
  );
  mocks.prisma.user.findUnique.mockResolvedValue(null);
  mocks.prisma.user.count.mockResolvedValue(1);
  mocks.prisma.user.update.mockResolvedValue({});
  mocks.prisma.user.delete.mockResolvedValue({});
  mocks.prisma.user.create.mockResolvedValue({
    id: "new-user",
    name: "Ny",
    email: "ny@example.test",
  });
  mocks.prisma.contact.findUnique.mockResolvedValue(null);
  mocks.prisma.department.findFirst.mockResolvedValue({ id: "dep-b" });
  mocks.prisma.department.findUnique.mockResolvedValue({ name: "Avdeling A" });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.createInviteToken.mockResolvedValue("raa-token");
  mocks.sendInviteEmail.mockResolvedValue(false);
});

describe("brukertjenesten – rettighetseskalering", () => {
  it("lar ikke kontor opprette en administrator", async () => {
    const result = await createUser(office(), {
      name: "Ny",
      email: "ny@example.test",
      role: "ADMIN",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("lar ikke kontor gjøre en bruker til administrator", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(target());

    const result = await changeRole(office(), { id: "target", role: "ADMIN" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar ikke kontor invitere en administrator", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "ADMIN", roleDefinition: roles.ADMIN }),
    );

    const result = await generateInvite(office(), { id: "target" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
  });

  it("lar ikke kontor invitere en bruker med rettigheter kontoret ikke har", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "USER",
        permissions: ["audit.view"],
        permissionsCustomized: true,
      }),
    );

    const result = await generateInvite(office(), { id: "target" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("lar ikke kontor endre tilpassede rettigheter", async () => {
    const result = await changePermissions(office(), {
      id: "target",
      permissions: ["settings.manage"],
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("nekter å opprette brukere uten users.manage", async () => {
    const result = await createUser(noAccess(), {
      name: "Ny",
      email: "ny@example.test",
      role: "TECHNICIAN",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("brukertjenesten – avdelingssperre", () => {
  it("lar ikke kontor endre rolle for bruker i en annen avdeling", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ departmentId: "dep-b" }),
    );

    const result = await changeRole(office(), {
      id: "target",
      role: "TECHNICIAN",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("plasserer nye ansatte i kontorets egen avdeling", async () => {
    const result = await createUser(office(), {
      name: "Ny",
      email: "ny@example.test",
      role: "TECHNICIAN",
      departmentId: "dep-b",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ departmentId: "dep-a" }),
    });
  });
});

describe("brukertjenesten – invitasjon og revisjon", () => {
  it("lager invitasjonslenke og revisjonslogg for vanlig bruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ roleDefinition: roles.TECHNICIAN }),
    );

    const result = await generateInvite(admin(), { id: "target" });

    expect(result.ok).toBe(true);
    expect(mocks.createInviteToken).toHaveBeenCalledWith("target", mocks.prisma);
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendInviteEmail).toHaveBeenCalled();
  });

  it("sender ikke e-post når revisjonsloggen feiler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ roleDefinition: roles.TECHNICIAN }),
    );
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("revisjonsloggen feilet");
            }),
          },
        }),
    );

    await expect(generateInvite(admin(), { id: "target" })).rejects.toThrow(
      "revisjonsloggen feilet",
    );
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });
});
