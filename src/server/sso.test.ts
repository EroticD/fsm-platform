import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SsoProviderConfig } from "@/lib/sso";

const mocks = vi.hoisted(() => ({
  prisma: {
    ssoIdentity: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    role: { findUnique: vi.fn() },
    department: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

import { resolveSsoUser } from "./sso";

function config(overrides: Partial<SsoProviderConfig> = {}): SsoProviderConfig {
  return {
    slug: "entra",
    id: "sso-entra",
    displayName: "Entra",
    issuer: "https://login.example.no/tenant/v2.0",
    discoveryUrl:
      "https://login.example.no/tenant/v2.0/.well-known/openid-configuration",
    clientId: "client",
    clientSecret: "secret",
    scopes: ["openid", "email", "profile"],
    autoProvision: false,
    autoProvisionActive: false,
    defaultRole: "USER",
    defaultDepartment: null,
    allowedEmailDomains: [],
    groupsClaim: "groups",
    groupRoleMap: {},
    syncRoles: false,
    ...overrides,
  };
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    sub: "subject-1",
    email: "kari@example.no",
    email_verified: true,
    name: "Kari",
    ...overrides,
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "kari@example.no",
    name: "Kari",
    role: "TECHNICIAN",
    isActive: true,
    isTwoFactorEnabled: false,
    sessionVersion: 3,
    departmentId: "dep-a",
    customerId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.ssoIdentity.findUnique.mockResolvedValue(null);
  mocks.prisma.ssoIdentity.update.mockResolvedValue({ id: "identity-1" });
  mocks.prisma.ssoIdentity.create.mockResolvedValue({ id: "identity-1" });
  mocks.prisma.user.findUnique.mockResolvedValue(null);
  mocks.prisma.user.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...user(),
      role: (data.role as string) ?? "TECHNICIAN",
      sessionVersion: 4,
    }),
  );
  mocks.prisma.user.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...user(),
      ...data,
    }),
  );
  mocks.prisma.role.findUnique.mockResolvedValue({ key: "USER" });
  mocks.prisma.department.findFirst.mockResolvedValue({ id: "dep-a" });
  mocks.audit.mockResolvedValue(undefined);
});

describe("resolveSsoUser – eksisterende identitet", () => {
  it("logger inn en aktiv bruker uten å endre rollen når rollestyring er av", async () => {
    mocks.prisma.ssoIdentity.findUnique.mockResolvedValue({
      id: "identity-1",
      userId: "u1",
      user: user(),
    });

    const result = await resolveSsoUser(config(), claims());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.role).toBe("TECHNICIAN");
    expect(result.user.sessionVersion).toBe(3);
    expect(result.linked).toBe(false);
    expect(result.roleChanged).toBe(false);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    expect(mocks.prisma.ssoIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "identity-1" } }),
    );
  });

  it("avviser en deaktivert bruker", async () => {
    mocks.prisma.ssoIdentity.findUnique.mockResolvedValue({
      id: "identity-1",
      userId: "u1",
      user: user({ isActive: false }),
    });

    const result = await resolveSsoUser(config(), claims());
    expect(result).toEqual({ ok: false, reason: "inactive" });
  });

  it("oppdaterer rollen når SYNC_ROLES er slått eksplisitt på", async () => {
    mocks.prisma.ssoIdentity.findUnique.mockResolvedValue({
      id: "identity-1",
      userId: "u1",
      user: user(),
    });
    mocks.prisma.role.findUnique.mockResolvedValue({ key: "OFFICE" });

    const result = await resolveSsoUser(
      config({
        syncRoles: true,
        groupRoleMap: { "FSM-Office": "OFFICE" },
      }),
      claims({ groups: ["FSM-Office"] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roleChanged).toBe(true);
    expect(result.user.role).toBe("OFFICE");
    expect(result.user.sessionVersion).toBe(4);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: "OFFICE", sessionVersion: { increment: 1 } },
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: expect.stringContaining("rolle oppdatert fra grupper"),
      }),
    );
  });
  it("avviser en rolle som ikke finnes ved rollestyring", async () => {
    mocks.prisma.ssoIdentity.findUnique.mockResolvedValue({
      id: "identity-1",
      userId: "u1",
      user: user(),
    });
    mocks.prisma.role.findUnique.mockResolvedValue(null);

    const result = await resolveSsoUser(
      config({
        syncRoles: true,
        groupRoleMap: { "FSM-Office": "OFFICE" },
      }),
      claims({ groups: ["FSM-Office"] }),
    );

    expect(result).toEqual({ ok: false, reason: "invalid_role" });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("resolveSsoUser – kobling", () => {
  it("kobler til en eksisterende aktiv bruker med bekreftet e-post", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(user());

    const result = await resolveSsoUser(config(), claims());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.linked).toBe(true);
    expect(result.provisioned).toBe(false);
    expect(mocks.prisma.ssoIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "entra",
          subject: "subject-1",
          userId: "u1",
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("avviser uverifisert e-post uten å slå opp brukeren", async () => {
    const result = await resolveSsoUser(
      config(),
      claims({ email_verified: false }),
    );

    expect(result).toEqual({ ok: false, reason: "unverified_email" });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("avviser e-post utenfor tillatte domener", async () => {
    const result = await resolveSsoUser(
      config({ allowedEmailDomains: ["firma.no"] }),
      claims(),
    );
    expect(result).toEqual({ ok: false, reason: "domain_not_allowed" });
  });

  it("kobler aldri en kundeportalbruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      user({ role: "CUSTOMER", customerId: "c1" }),
    );

    const result = await resolveSsoUser(config(), claims());
    expect(result).toEqual({ ok: false, reason: "customer_account" });
    expect(mocks.prisma.ssoIdentity.create).not.toHaveBeenCalled();
  });

  it("avviser en inaktiv eksisterende bruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(user({ isActive: false }));

    const result = await resolveSsoUser(config(), claims());
    expect(result).toEqual({ ok: false, reason: "inactive" });
  });
});

describe("resolveSsoUser – provisjonering", () => {
  it("avviser brukere som ikke finnes når auto-provisjonering er av", async () => {
    const result = await resolveSsoUser(config(), claims());
    expect(result).toEqual({ ok: false, reason: "not_provisioned" });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("oppretter inaktiv bruker med laveste rolle og uten passord", async () => {
    const result = await resolveSsoUser(
      config({ autoProvision: true }),
      claims({ email_verified: true }),
    );

    expect(result).toEqual({ ok: false, reason: "inactive" });
    expect(mocks.prisma.user.create).toHaveBeenCalledTimes(1);
    const data = mocks.prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: "kari@example.no",
      name: "Kari",
      role: "USER",
      isActive: false,
    });
    expect(data).not.toHaveProperty("password");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "SSO: opprettet bruker via entra",
      }),
    );
  });

  it("aktiverer brukeren når AUTO_PROVISION_ACTIVE er slått på", async () => {
    const result = await resolveSsoUser(
      config({ autoProvision: true, autoProvisionActive: true }),
      claims(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provisioned).toBe(true);
    expect(result.user.isActive).toBe(true);
    expect(mocks.prisma.user.create.mock.calls[0][0].data.isActive).toBe(true);
  });

  it("bruker gruppemapping ved provisjonering", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue({ key: "OFFICE" });

    const result = await resolveSsoUser(
      config({
        autoProvision: true,
        autoProvisionActive: true,
        groupRoleMap: { "FSM-Office": "OFFICE" },
      }),
      claims({ groups: ["FSM-Office"] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.role).toBe("OFFICE");
    expect(mocks.prisma.user.create.mock.calls[0][0].data.role).toBe("OFFICE");
  });

  it("avviser rollekonflikt i gruppene", async () => {
    const result = await resolveSsoUser(
      config({
        autoProvision: true,
        groupRoleMap: { A: "OFFICE", B: "ADMIN" },
      }),
      claims({ groups: ["A", "B"] }),
    );
    expect(result).toEqual({ ok: false, reason: "role_conflict" });
  });

  it("avviser en rolle som ikke finnes i databasen", async () => {
    mocks.prisma.role.findUnique.mockResolvedValue(null);
    const result = await resolveSsoUser(
      config({ autoProvision: true }),
      claims(),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_role" });
  });

  it("avviser en konfigurert standardavdeling som ikke finnes", async () => {
    mocks.prisma.department.findFirst.mockResolvedValue(null);
    const result = await resolveSsoUser(
      config({ autoProvision: true, defaultDepartment: "Ukjent" }),
      claims(),
    );
    expect(result).toEqual({ ok: false, reason: "invalid_department" });
  });

  it("avviser manglende sub og e-post", async () => {
    expect(await resolveSsoUser(config(), {})).toEqual({
      ok: false,
      reason: "invalid_claims",
    });
    expect(
      await resolveSsoUser(config(), { sub: "s", email_verified: true }),
    ).toEqual({ ok: false, reason: "missing_email" });
  });
});
