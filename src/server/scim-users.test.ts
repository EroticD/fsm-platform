import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScimTokenActor } from "./scim-tokens";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
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

import {
  createScimUser,
  deactivateScimUser,
  getScimUser,
  listScimUsers,
  patchScimUser,
  updateScimUser,
} from "./scim-users";

const actor: ScimTokenActor = {
  tokenId: "token-1",
  tokenName: "Entra",
  createdById: "admin-1",
};

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "kari@example.no",
    name: "Kari",
    scimExternalId: "ext-1",
    isActive: true,
    role: "TECHNICIAN",
    departmentId: "dep-a",
    department: { id: "dep-a", name: "Oslo" },
    customerId: null,
    ...overrides,
  };
}

function scimUser(overrides: Record<string, unknown> = {}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "kari@example.no",
    externalId: "ext-1",
    active: true,
    name: { givenName: "Kari", familyName: "Firma" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.user.findFirst.mockResolvedValue(null);
  mocks.prisma.user.findUnique.mockResolvedValue(user());
  mocks.prisma.user.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...user(),
      ...data,
    }),
  );
  mocks.prisma.user.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...user(),
      ...data,
      sessionVersion: 4,
    }),
  );
  mocks.prisma.user.count.mockResolvedValue(1);
  mocks.prisma.user.findMany.mockResolvedValue([user()]);
  mocks.prisma.role.findUnique.mockImplementation(
    async ({ where }: { where: { key: string } }) => ({ key: where.key }),
  );
  mocks.prisma.department.findFirst.mockResolvedValue({ id: "dep-a" });
  mocks.audit.mockResolvedValue(undefined);
});

describe("createScimUser", () => {
  it("oppretter inaktiv bruker med standardrolle og uten passord", async () => {
    const result = await createScimUser(
      { ...scimUser(), active: undefined },
      actor,
      {},
    );
    expect(result.ok).toBe(true);

    const data = mocks.prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: "kari@example.no",
      name: "Kari Firma",
      role: "USER",
      isActive: false,
      scimExternalId: "ext-1",
    });
    expect(data).not.toHaveProperty("password");
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "Opprettet bruker via SCIM",
        metadata: expect.objectContaining({
          source: "scim",
          scimTokenId: "token-1",
        }),
      }),
    );
  });

  it("aktiverer brukeren når active=true", async () => {
    const result = await createScimUser(scimUser({ active: true }), actor, {});
    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.create.mock.calls[0][0].data.isActive).toBe(true);
  });

  it("avviser duplikat e-post med 409", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(user());
    const result = await createScimUser(scimUser(), actor, {});
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("avviser e-postdomene utenfor tillatt liste", async () => {
    const result = await createScimUser(scimUser(), actor, {
      SCIM_ALLOWED_EMAIL_DOMAINS: "firma.no",
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("avviser ADMIN uten SCIM_ALLOW_ADMIN", async () => {
    const result = await createScimUser(
      scimUser({ roles: [{ value: "ADMIN" }] }),
      actor,
      {},
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      detail: expect.stringContaining("SCIM_ALLOW_ADMIN"),
    });
  });

  it("tillater ADMIN når det er eksplisitt slått på", async () => {
    const result = await createScimUser(
      scimUser({ roles: [{ value: "ADMIN" }] }),
      actor,
      { SCIM_ALLOW_ADMIN: "true" },
    );
    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.create.mock.calls[0][0].data.role).toBe("ADMIN");
  });

  it("avviser CUSTOMER og ukjente roller", async () => {
    expect(
      await createScimUser(scimUser({ roles: [{ value: "CUSTOMER" }] }), actor, {}),
    ).toMatchObject({ ok: false, status: 400 });

    mocks.prisma.role.findUnique.mockResolvedValue(null);
    expect(
      await createScimUser(scimUser({ roles: [{ value: "UKJENT" }] }), actor, {}),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("mapper grupper til rolle når mappingen er eksplisitt", async () => {
    const result = await createScimUser(
      scimUser({ groups: [{ display: "FSM-Office" }] }),
      actor,
      { SCIM_GROUP_ROLE_MAP: '{"FSM-Office":"OFFICE"}' },
    );
    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.create.mock.calls[0][0].data.role).toBe("OFFICE");
  });

  it("avviser avdeling som ikke finnes", async () => {
    mocks.prisma.department.findFirst.mockResolvedValue(null);
    const result = await createScimUser(
      scimUser({
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
          department: "Ukjent",
        },
      }),
      actor,
      {},
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("listScimUsers", () => {
  it("returnerer totalResults og filtrerer på userName", async () => {
    const result = await listScimUsers(
      {
        filter: 'userName eq "Kari@Example.NO"',
        startIndex: 1,
        count: 25,
      },
      "https://fsm.example",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalResults).toBe(1);
    expect(result.data.resources).toHaveLength(1);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ email: "kari@example.no" }] },
        take: 25,
        skip: 0,
      }),
    );
  });

  it("avviser ugyldig filter med 400", async () => {
    const result = await listScimUsers(
      { filter: "userName xx 1", startIndex: 1, count: 100 },
      "",
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("update og patch", () => {
  it("bevarer avdelingen ved PUT uten enterprise-extension", async () => {
    const result = await updateScimUser("u1", scimUser(), actor, undefined, {});
    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ departmentId: "dep-a" }),
      }),
    );
  });

  it("PATCH active=false øker sessionVersion", async () => {
    const result = await patchScimUser(
      "u1",
      { Operations: [{ op: "replace", path: "active", value: false }] },
      actor,
      {},
    );
    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          fields: expect.arrayContaining(["active"]),
        }),
      }),
    );
  });

  it("avviser endring av kundeportalbruker med 403", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      user({ role: "CUSTOMER", customerId: "c1" }),
    );
    const result = await patchScimUser(
      "u1",
      { Operations: [{ op: "replace", path: "active", value: false }] },
      actor,
      {},
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("gir 404 for ukjent bruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    expect(await getScimUser("ukjent")).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("deactivateScimUser", () => {
  it("myk-deaktiverer og ugyldiggjør økter", async () => {
    const result = await deactivateScimUser("u1", actor);
    expect(result.ok).toBe(true);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "Deaktiverte bruker via SCIM" }),
    );
  });

  it("nekter å deaktivere kundeportalbruker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      user({ role: "CUSTOMER", customerId: "c1" }),
    );
    expect(await deactivateScimUser("u1", actor)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
