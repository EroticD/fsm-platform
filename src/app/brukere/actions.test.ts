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
    targetPermissions: null as string[] | null,
    targetPermissionsCustomized: false,
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
      role: {
        findUnique: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      department: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(),
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
  bumpSessionVersion: vi.fn(async () => {}),
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

import { redirect } from "next/navigation";
import { changeRole, createUser, deleteUser, generateInvite } from "@/app/brukere/actions";

const mockedRedirect = vi.mocked(redirect);

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
  mocks.state.targetPermissions = null;
  mocks.state.targetPermissionsCustomized = false;
  mocks.state.activeAdminCount = 1;
  vi.clearAllMocks();
  const roles = {
    ADMIN: {
      key: "ADMIN",
      label: "Administrator",
      permissions: ["workorders.view", "settings.manage", "audit.view"],
    },
    OFFICE: {
      key: "OFFICE",
      label: "Kontor",
      permissions: ["workorders.view", "customers.manage", "users.manage"],
    },
    TECHNICIAN: {
      key: "TECHNICIAN",
      label: "Montør",
      permissions: ["workorders.view", "reports.write"],
    },
    USER: { key: "USER", label: "Standard", permissions: [] },
    CUSTOMER: { key: "CUSTOMER", label: "Kundeportal", permissions: [] },
  };
  mocks.prisma.role.findUnique.mockImplementation(
    async ({ where }: { where: { key: string } }) => roles[where.key as keyof typeof roles] ?? null,
  );
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
        permissions: mocks.state.targetPermissions,
        permissionsCustomized: mocks.state.targetPermissionsCustomized,
        roleDefinition: null,
      };
    }
    return null;
  });
  mocks.prisma.user.count.mockImplementation(async () => mocks.state.activeAdminCount);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
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
      data: {
        role: "TECHNICIAN",
        departmentId: "dep-a",
        permissions: [],
        permissionsCustomized: false,
        sessionVersion: { increment: 1 },
      },
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

  it("avviser en ekstern returnTo og faller tilbake til /brukere", async () => {
    mocks.state.actorRole = "OFFICE";
    await createUser(
      formData({
        name: "Ny",
        email: "ny@firma.no",
        role: "TECHNICIAN",
        returnTo: "https://evil.example/phishing",
      }),
    );

    expect(mockedRedirect).toHaveBeenCalled();
    for (const [target] of mockedRedirect.mock.calls) {
      const path = String(target);
      expect(path.startsWith("/")).toBe(true);
      expect(path.startsWith("//")).toBe(false);
      expect(path).not.toContain("evil.example");
    }
  });

  it("legger aldri den rå invitasjonsnøkkelen i redirect-URLen", async () => {
    mocks.state.actorRole = "OFFICE";
    await createUser(
      formData({
        name: "Ny",
        email: "ny@firma.no",
        role: "TECHNICIAN",
        returnTo: "/brukere",
      }),
    );

    expect(mockedRedirect).toHaveBeenCalled();
    for (const [target] of mockedRedirect.mock.calls) {
      expect(String(target)).not.toContain("raa-token");
      expect(String(target)).not.toContain("inviteToken");
    }
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
    mocks.state.targetActive = false;
    await generateInvite(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.createInviteToken).toHaveBeenCalled();
  });

  it("lar ikke en kontorbruker invitere en aktiv konto", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "TECHNICIAN";
    mocks.state.targetActive = true;
    await generateInvite(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("lar ikke en kontorbruker invitere en bruker med rettigheter aktøren ikke har", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "USER";
    mocks.state.targetPermissions = ["audit.view"];
    mocks.state.targetPermissionsCustomized = true;
    await generateInvite(formData({ id: "target", returnTo: "/brukere" }));
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("legger ikke invitasjonsnøkkelen i redirect-URLen", async () => {
    mocks.state.actorRole = "OFFICE";
    mocks.state.targetRole = "TECHNICIAN";
    mocks.state.targetActive = false;
    await generateInvite(formData({ id: "target", returnTo: "/brukere" }));

    expect(mockedRedirect).toHaveBeenCalled();
    for (const [target] of mockedRedirect.mock.calls) {
      expect(String(target)).not.toContain("raa-token");
      expect(String(target)).not.toContain("inviteToken");
      expect(String(target)).toContain("invite=target");
    }
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
