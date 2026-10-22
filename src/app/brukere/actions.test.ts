import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    actorRole: "OFFICE",
    actorActive: true,
    actorId: "actor",
    actorDepartmentId: "dep-a",
    targetRole: "OFFICE",
    targetActive: true,
    targetDepartmentId: "dep-a",
    activeAdminCount: 1,
  };
  return {
    state,
    prisma: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      department: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
      },
    },
    sendInviteEmail: vi.fn(async () => false),
    createInviteToken: vi.fn(async () => "raa-token"),
  };
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: mocks.state.actorId,
    role: mocks.state.actorRole,
    isActive: mocks.state.actorActive,
    departmentId: mocks.state.actorDepartmentId,
    name: "Actor",
  })),
  actorName: vi.fn(async () => "Actor"),
  isOffice: (role: string) => role === "ADMIN" || role === "OFFICE",
  requireOffice: vi.fn(
    async () =>
      mocks.state.actorActive &&
      (mocks.state.actorRole === "ADMIN" || mocks.state.actorRole === "OFFICE"),
  ),
  requireAdmin: vi.fn(
    async () => mocks.state.actorActive && mocks.state.actorRole === "ADMIN",
  ),
  requirePermission: vi.fn(
    async () =>
      mocks.state.actorActive &&
      (mocks.state.actorRole === "ADMIN" || mocks.state.actorRole === "OFFICE"),
  ),
}));
vi.mock("@/lib/invite", () => ({
  createInviteToken: mocks.createInviteToken,
  buildInviteUrl: (token: string) => `https://example.test/aktiver-konto?token=${token}`,
}));
vi.mock("@/lib/email", () => ({ sendInviteEmail: mocks.sendInviteEmail }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { changeRole, createUser, deleteUser, generateInvite } from "@/app/brukere/actions";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

beforeEach(() => {
  mocks.state.actorRole = "OFFICE";
  mocks.state.actorActive = true;
  mocks.state.actorId = "actor";
  mocks.state.actorDepartmentId = "dep-a";
  mocks.state.targetRole = "OFFICE";
  mocks.state.targetActive = true;
  mocks.state.targetDepartmentId = "dep-a";
  mocks.state.activeAdminCount = 1;
  vi.clearAllMocks();
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => {
    if (where.id === "actor") {
      return {
        id: "actor",
        role: mocks.state.actorRole,
        isActive: mocks.state.actorActive,
        departmentId: mocks.state.actorDepartmentId,
        name: "Actor",
      };
    }
    if (where.id === "target") {
      return {
        id: "target",
        role: mocks.state.targetRole,
        isActive: mocks.state.targetActive,
        departmentId: mocks.state.targetDepartmentId,
        name: "Target",
      };
    }
    return null;
  });
  mocks.prisma.user.count.mockImplementation(async () => mocks.state.activeAdminCount);
  mocks.prisma.user.update.mockResolvedValue({});
  mocks.prisma.user.delete.mockResolvedValue({});
  mocks.prisma.user.create.mockResolvedValue({ id: "ny-bruker", email: "ny@firma.no" });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.createInviteToken.mockResolvedValue("raa-token");
  mocks.sendInviteEmail.mockResolvedValue(false);
});

describe("changeRole", () => {
  it("lar ikke en kontorbruker gjøre noen til administrator", async () => {
    mocks.state.actorRole = "OFFICE";
    await changeRole(formData({ id: "target", role: "ADMIN" }));
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar ikke en kontorbruker endre rollen til en administrator", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "ADMIN";
    await changeRole(formData({ id: "target", role: "TECHNICIAN" }));
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar en administrator endre en vanlig brukers rolle", async () => {
    mocks.state.actorRole = "ADMIN";
    await changeRole(formData({ id: "target", role: "TECHNICIAN" }));
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target" },
      data: { role: "TECHNICIAN" },
    });
  });

  it("hindrer en kontorbruker i å endre brukere i en annen avdeling", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetDepartmentId = "dep-b";
    await changeRole(formData({ id: "target", role: "TECHNICIAN" }));
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("nekter å fjerne den siste aktive administratoren", async () => {
    mocks.state.actorRole = "ADMIN";
    mocks.state.targetRole = "ADMIN";
    mocks.state.activeAdminCount = 0;
    await changeRole(formData({ id: "target", role: "OFFICE" }));
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("tillater å endre en administrator når en annen finnes", async () => {
    mocks.state.actorRole = "ADMIN";
    mocks.state.targetRole = "ADMIN";
    mocks.state.activeAdminCount = 1;
    await changeRole(formData({ id: "target", role: "OFFICE" }));
    expect(mocks.prisma.user.update).toHaveBeenCalled();
  });
});

describe("createUser", () => {
  it("lar ikke en kontorbruker opprette en administrator", async () => {
    mocks.state.actorRole = "OFFICE";
    await createUser(
      formData({ name: "Ny", email: "ny@firma.no", role: "ADMIN", returnTo: "/brukere" }),
    );
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("lar en kontorbruker opprette en montør i egen avdeling", async () => {
    mocks.state.actorRole = "OFFICE";
    await createUser(
      formData({
        name: "Ny",
        email: "ny@firma.no",
        role: "TECHNICIAN",
        departmentId: "dep-b",
        returnTo: "/brukere",
      }),
    );
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ departmentId: "dep-a" }),
    });
  });
});

describe("generateInvite", () => {
  it("lar ikke en kontorbruker lage invitasjon til en administrator", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "ADMIN";
    await generateInvite(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("lar en kontorbruker lage invitasjon til en montør", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "TECHNICIAN";
    await generateInvite(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.createInviteToken).toHaveBeenCalled();
  });
});

describe("deleteUser", () => {
  it("lar ikke en bruker slette seg selv", async () => {
    mocks.state.actorRole = "ADMIN";
    mocks.state.actorId = "target";
    await deleteUser(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled();
  });

  it("lar ikke en kontorbruker slette en administrator", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "ADMIN";
    await deleteUser(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.prisma.user.delete).not.toHaveBeenCalled();
  });
});
