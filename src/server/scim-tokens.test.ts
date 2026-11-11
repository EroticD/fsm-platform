import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    scimToken: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  auditStandalone: vi.fn(),
  auditRequestContext: vi.fn(),
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({
  audit: mocks.audit,
  auditStandalone: mocks.auditStandalone,
  auditRequestContext: mocks.auditRequestContext,
}));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));

import {
  authenticateScimRequest,
  createScimToken,
  generateScimToken,
  hashScimToken,
  isScimToken,
  listScimTokens,
  revokeScimToken,
  rotateScimToken,
  SCIM_TOKEN_PATTERN,
} from "./scim-tokens";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "admin-1",
    name: "Admin",
    email: "admin@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: [] },
    ...overrides,
  };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    name: "Entra",
    prefix: "scim_abcdefgh",
    createdById: "admin-1",
    createdAt: new Date("2026-11-03T10:00:00.000Z"),
    lastUsedAt: null,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

function request(token?: string) {
  return new Request("https://fsm.example/api/scim/v2/Users", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.scimToken.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...storedRow(),
      ...data,
    }),
  );
  mocks.prisma.scimToken.findMany.mockResolvedValue([storedRow()]);
  mocks.prisma.scimToken.findUnique.mockResolvedValue(storedRow());
  mocks.prisma.scimToken.update.mockResolvedValue({ id: "token-1" });
  mocks.prisma.user.findUnique.mockResolvedValue({ isActive: true });
  mocks.prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.auditStandalone.mockResolvedValue(undefined);
  mocks.auditRequestContext.mockResolvedValue({ ip: "203.0.113.9" });
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("SCIM-tokenformat", () => {
  it("genererer et token med riktig prefiks og hash", () => {
    const token = generateScimToken();
    expect(token).toMatch(SCIM_TOKEN_PATTERN);
    expect(isScimToken(token)).toBe(true);
    expect(hashScimToken(token)).toHaveLength(64);
    expect(hashScimToken(token)).not.toBe(token);
  });

  it("avviser token med feil prefiks", () => {
    expect(isScimToken("fsm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      false,
    );
  });
});

describe("createScimToken", () => {
  it("returnerer klartekst én gang og lagrer bare hash", async () => {
    const result = await createScimToken(actor(), { name: "Entra" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = mocks.prisma.scimToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashScimToken(result.token));
    expect(data.prefix).toBe(result.token.slice(0, 12));
    expect(JSON.stringify(data)).not.toContain(result.token);
    expect(result.scimToken.prefix).toBe(data.prefix);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: expect.stringContaining("Opprettet SCIM-token") }),
    );
  });

  it("avviser en ikke-administrator med 403", async () => {
    const result = await createScimToken(actor({ role: "OFFICE" }), {
      name: "Entra",
    });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.prisma.scimToken.create).not.toHaveBeenCalled();
  });

  it("avviser ugyldig navn og utløpsdato", async () => {
    expect(
      await createScimToken(actor(), { name: "" }),
    ).toEqual({ ok: false, error: "validation_error" });
    expect(
      await createScimToken(actor(), {
        name: "Entra",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "validation_error" });
  });
});

describe("list og revoke", () => {
  it("lister tokens uten hash", async () => {
    const result = await listScimTokens(actor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens[0]).not.toHaveProperty("tokenHash");
    expect(result.tokens[0].prefix).toBe("scim_abcdefgh");
  });

  it("avviser list for ikke-administrator", async () => {
    expect(await listScimTokens(actor({ role: "TECHNICIAN" }))).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("tilbakekaller og revisjonslogger", async () => {
    const result = await revokeScimToken(actor(), "token-1");
    expect(result.ok).toBe(true);
    expect(mocks.prisma.scimToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token-1" },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: expect.stringContaining("Tilbakekalte SCIM-token"),
      }),
    );
  });

  it("returnerer not_found for ukjent token", async () => {
    mocks.prisma.scimToken.findUnique.mockResolvedValueOnce(null);
    expect(await revokeScimToken(actor(), "ukjent")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("rotateScimToken", () => {
  it("tilbakekaller gammelt token og oppretter nytt i samme transaksjon", async () => {
    const result = await rotateScimToken(actor(), "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mocks.prisma.scimToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token-1" },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
    expect(mocks.prisma.scimToken.create).toHaveBeenCalled();
    const created = mocks.prisma.scimToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(hashScimToken(result.token));
    expect(result.scimToken.name).toBe("Entra");
    expect(mocks.audit).toHaveBeenCalledTimes(2);
  });
});

describe("authenticateScimRequest", () => {
  it("avviser manglende token med 401 og WWW-Authenticate", async () => {
    const result = await authenticateScimRequest(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("www-authenticate")).toContain("Bearer");
    const body = await result.response.json();
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
    expect(body.status).toBe("401");
  });

  it("avviser feil tokenformat uten databasesøk", async () => {
    const result = await authenticateScimRequest(request("fsm_abc"));
    expect(result.ok).toBe(false);
    expect(mocks.prisma.scimToken.findUnique).not.toHaveBeenCalled();
  });

  it("avviser tilbakekalt og utløpt token", async () => {
    mocks.prisma.scimToken.findUnique.mockResolvedValueOnce(
      storedRow({ revokedAt: new Date() }),
    );
    expect((await authenticateScimRequest(request(generateScimToken()))).ok).toBe(
      false,
    );

    mocks.prisma.scimToken.findUnique.mockResolvedValueOnce(
      storedRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect((await authenticateScimRequest(request(generateScimToken()))).ok).toBe(
      false,
    );
  });

  it("gir 403 når administratoren som opprettet tokenet er inaktiv", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ isActive: false });
    const result = await authenticateScimRequest(request(generateScimToken()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("godtar gyldig token, oppdaterer sist brukt og logger bruk", async () => {
    const result = await authenticateScimRequest(request(generateScimToken()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.id).toBe("token-1");
    expect(mocks.prisma.scimToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastUsedAt: expect.any(Date) } }),
    );
    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "ScimToken",
        entityId: "token-1",
        actionCode: "scim.token.used",
        outcome: "SUCCESS",
      }),
    );
  });

  it("gir 429 med Retry-After når grensen er nådd", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const result = await authenticateScimRequest(request(generateScimToken()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("42");
    const body = await result.response.json();
    expect(body.status).toBe("429");
  });

  it("revisjonslogger 401 som scim.auth.failed uten å lagre tokenet", async () => {
    const token = generateScimToken();
    mocks.prisma.scimToken.findUnique.mockResolvedValueOnce(
      storedRow({ revokedAt: new Date() }),
    );
    const result = await authenticateScimRequest(request(token));
    expect(result.ok).toBe(false);

    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "ScimToken",
        actionCode: "scim.auth.failed",
        outcome: "DENIED",
        metadata: expect.objectContaining({ reason: "unknown_or_revoked" }),
      }),
    );
    expect(JSON.stringify(mocks.auditStandalone.mock.calls)).not.toContain(
      token,
    );
  });

  it("revisjonslogger 429 som scim.auth.failed", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 5,
    });
    await authenticateScimRequest(request(generateScimToken()));

    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "scim.auth.failed",
        metadata: expect.objectContaining({ reason: "rate_limited" }),
      }),
    );
  });
});
