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
    customer: { findUnique: vi.fn() },
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
  createPortalUser,
  createUser,
  generateInvite,
  resendPortalInvite,
  setActive,
  setPortalUserActive,
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
  mocks.prisma.customer.findUnique.mockResolvedValue({ deletedAt: null });
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

  it("lar ikke kontor endre rolle for en bruker med rettigheter kontoret mangler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "USER",
        isActive: false,
        permissions: ["audit.view"],
        permissionsCustomized: true,
        roleDefinition: roles.USER,
      }),
    );

    const result = await changeRole(office(), {
      id: "target",
      role: "TECHNICIAN",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar ikke kontor tildele en rolle med rettigheter kontoret mangler", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({
      key: "CUSTOM",
      label: "Egen rolle",
      permissions: ["settings.manage"],
    });
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "USER", roleDefinition: roles.USER }),
    );

    const result = await changeRole(office(), {
      id: "target",
      role: "CUSTOM",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar administrator endre rolle for en mer privilegert bruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "USER",
        permissions: ["audit.view"],
        permissionsCustomized: true,
        roleDefinition: roles.USER,
      }),
    );

    const result = await changeRole(admin(), { id: "target", role: "USER" });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalled();
  });
});

describe("brukertjenesten – aktivering og deaktivering", () => {
  it("lar ikke kontor deaktivere en bruker med rettigheter kontoret mangler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "USER",
        permissions: ["audit.view"],
        permissionsCustomized: true,
        roleDefinition: roles.USER,
      }),
    );

    const result = await setActive(office(), {
      id: "target",
      active: "false",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar ikke kontor reaktivere en bruker med rettigheter kontoret mangler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "USER",
        isActive: false,
        permissions: ["audit.view"],
        permissionsCustomized: true,
        roleDefinition: roles.USER,
      }),
    );

    const result = await setActive(office(), {
      id: "target",
      active: "true",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar ikke en vanlig bruker deaktivere seg selv", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ id: "actor", role: "USER", roleDefinition: roles.USER }),
    );

    const result = await setActive(office(), {
      id: "actor",
      active: "false",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar kontor deaktivere en bruker uten høyere rettigheter", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "USER", roleDefinition: roles.USER }),
    );

    const result = await setActive(office(), {
      id: "target",
      active: "false",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target" },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
  });

  it("krever users.manage for å reaktivere en deaktivert bruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "USER", isActive: false, roleDefinition: roles.USER }),
    );

    const result = await setActive(noAccess(), {
      id: "target",
      active: "true",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar ikke kontor reaktivere en administrator", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "ADMIN",
        isActive: false,
        roleDefinition: roles.ADMIN,
      }),
    );

    const result = await setActive(office(), {
      id: "target",
      active: "true",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("lar administrator reaktivere en mer privilegert bruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "USER",
        isActive: false,
        permissions: ["audit.view"],
        permissionsCustomized: true,
        roleDefinition: roles.USER,
      }),
    );

    const result = await setActive(admin(), {
      id: "target",
      active: "true",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target" },
      data: { isActive: true, sessionVersion: { increment: 1 } },
    });
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
      target({ roleDefinition: roles.TECHNICIAN, isActive: false }),
    );

    const result = await generateInvite(admin(), { id: "target" });

    expect(result.ok).toBe(true);
    expect(mocks.createInviteToken).toHaveBeenCalledWith("target", mocks.prisma);
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendInviteEmail).toHaveBeenCalled();
  });

  it("nekter å lage invitasjonslenke for en aktiv konto", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ roleDefinition: roles.TECHNICIAN, isActive: true }),
    );

    const result = await generateInvite(admin(), { id: "target" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("sender ikke e-post når revisjonsloggen feiler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ roleDefinition: roles.TECHNICIAN, isActive: false }),
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

describe("brukertjenesten – kundeportalbrukere", () => {
  it("oppretter en ekte kundeportalbruker koblet til kunden", async () => {
    mocks.prisma.contact.findUnique.mockResolvedValue({
      id: "contact-1",
      customerId: "kunde-1",
    });

    const result = await createPortalUser(office(), {
      customerId: "kunde-1",
      name: "Kari",
      email: "kari@example.test",
      contactId: "contact-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
      }),
    });
    expect(mocks.createInviteToken).toHaveBeenCalledWith("new-user", mocks.prisma);
    expect(mocks.sendInviteEmail).toHaveBeenCalled();
  });

  it("aktiverer en ekte kundeportalbruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "CUSTOMER", customerId: "kunde-1" }),
    );

    const result = await setPortalUserActive(office(), {
      customerId: "kunde-1",
      id: "target",
      active: "false",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target" },
      data: {
        isActive: false,
        sessionVersion: { increment: 1 },
      },
    });
  });

  it("sender ny invitasjon til en ekte kundeportalbruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "CUSTOMER", customerId: "kunde-1", isActive: false }),
    );

    const result = await resendPortalInvite(office(), {
      customerId: "kunde-1",
      id: "target",
    });

    expect(result.ok).toBe(true);
    expect(mocks.createInviteToken).toHaveBeenCalledWith("target", mocks.prisma);
    expect(mocks.sendInviteEmail).toHaveBeenCalled();
  });

  it("sender ikke ny invitasjon til en aktiv kundeportalbruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "CUSTOMER", customerId: "kunde-1", isActive: true }),
    );

    const result = await resendPortalInvite(office(), {
      customerId: "kunde-1",
      id: "target",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "OFFICE", "TECHNICIAN"])(
    "nekter å aktivere en %s med kundetilknytning via portalen",
    async (role) => {
      mocks.prisma.user.findUnique.mockResolvedValue(
        target({ role, customerId: "kunde-1" }),
      );

      const result = await setPortalUserActive(office(), {
        customerId: "kunde-1",
        id: "target",
        active: "false",
      });

      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it.each(["ADMIN", "OFFICE", "TECHNICIAN"])(
    "nekter å sende portalinvitasjon til en %s med kundetilknytning",
    async (role) => {
      mocks.prisma.user.findUnique.mockResolvedValue(
        target({ role, customerId: "kunde-1" }),
      );

      const result = await resendPortalInvite(office(), {
        customerId: "kunde-1",
        id: "target",
      });

      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(mocks.createInviteToken).not.toHaveBeenCalled();
      expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
    },
  );

  it("avviser å opprette portalbruker på en slettet kunde", async () => {
    mocks.prisma.customer.findUnique.mockResolvedValue({
      deletedAt: new Date(),
    });
    mocks.prisma.contact.findUnique.mockResolvedValue({
      id: "contact-1",
      customerId: "kunde-1",
    });

    const result = await createPortalUser(office(), {
      customerId: "kunde-1",
      name: "Kari",
      email: "kari@example.test",
      contactId: "contact-1",
    });

    expect(result).toEqual({ ok: false, reason: "customer_not_found" });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("avviser å aktivere portalbruker på en slettet kunde", async () => {
    mocks.prisma.customer.findUnique.mockResolvedValue({
      deletedAt: new Date(),
    });
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
      }),
    );

    const result = await setPortalUserActive(office(), {
      customerId: "kunde-1",
      id: "target",
      active: "true",
    });

    expect(result).toEqual({ ok: false, reason: "customer_not_found" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("avviser ny invitasjon til portalbruker på en slettet kunde", async () => {
    mocks.prisma.customer.findUnique.mockResolvedValue({
      deletedAt: new Date(),
    });
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
        isActive: false,
      }),
    );

    const result = await resendPortalInvite(office(), {
      customerId: "kunde-1",
      id: "target",
    });

    expect(result).toEqual({ ok: false, reason: "customer_not_found" });
    expect(mocks.createInviteToken).not.toHaveBeenCalled();
    expect(mocks.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("aktiverer portalbruker med gyldig kontakt på kunden", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
        isActive: false,
      }),
    );
    mocks.prisma.contact.findUnique.mockResolvedValue({
      id: "contact-1",
      customerId: "kunde-1",
    });

    const result = await setPortalUserActive(office(), {
      customerId: "kunde-1",
      id: "target",
      active: "true",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target" },
      data: { isActive: true },
    });
  });

  it("nekter å aktivere portalbruker uten gyldig kontakt", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
        isActive: false,
      }),
    );
    mocks.prisma.contact.findUnique.mockResolvedValue(null);

    const result = await setPortalUserActive(office(), {
      customerId: "kunde-1",
      id: "target",
      active: "true",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_contact" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("nekter å aktivere portalbruker når kontakten tilhører en annen kunde", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
        isActive: false,
      }),
    );
    mocks.prisma.contact.findUnique.mockResolvedValue({
      id: "contact-1",
      customerId: "kunde-2",
    });

    const result = await setPortalUserActive(office(), {
      customerId: "kunde-1",
      id: "target",
      active: "true",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_contact" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("brukertjenesten – kundetilknytning på ansatte", () => {
  it("kobler ikke en ansatt til en kunde selv om contactId sendes inn", async () => {
    mocks.prisma.contact.findUnique.mockResolvedValue({
      id: "contact-1",
      customerId: "kunde-1",
    });

    const result = await createUser(office(), {
      name: "Ny ansatt",
      email: "ansatt@example.test",
      role: "TECHNICIAN",
      contactId: "contact-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.contact.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "TECHNICIAN",
        customerId: null,
        contactId: null,
      }),
    });
  });

  it("kobler kundeportalbrukere til riktig kunde", async () => {
    mocks.prisma.contact.findUnique.mockResolvedValue({
      id: "contact-1",
      customerId: "kunde-1",
    });

    const result = await createUser(office(), {
      name: "Kari",
      email: "kari@example.test",
      role: "CUSTOMER",
      contactId: "contact-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: "CUSTOMER",
        customerId: "kunde-1",
        contactId: "contact-1",
      }),
    });
  });

  it("lar ikke en intern bruker bli kunde uten kundetilknytning", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      target({ role: "TECHNICIAN", customerId: null }),
    );

    const result = await changeRole(office(), {
      id: "target",
      role: "CUSTOMER",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});
