import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  API_KEY_TOKEN_PATTERN,
  ApiKeyValidationError,
  createApiKey,
  createApiKeyForUser,
  generateApiKeyToken,
  hashApiKeyToken,
  listApiKeys,
  parseApiKeyInput,
  revokeApiKey,
} from "./api-keys";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
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
    id: "key-1",
    name: "Integrasjon",
    prefix: "fsm_abcdefgh",
    userId: "actor",
    createdAt: new Date("2026-10-30T10:00:00.000Z"),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    user: {
      id: "actor",
      name: "Admin",
      email: "admin@example.test",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.apiKey.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...storedRow(),
      ...data,
      id: "key-1",
      user: { id: data.userId, name: "Admin", email: "admin@example.test" },
    }),
  );
  mocks.prisma.apiKey.findMany.mockResolvedValue([]);
  mocks.prisma.apiKey.findUnique.mockResolvedValue(null);
  mocks.prisma.apiKey.update.mockResolvedValue({ id: "key-1" });
  mocks.prisma.user.findUnique.mockResolvedValue(null);
});

describe("API-nøkkelens tokenformat", () => {
  it("genererer fsm_ + 32 tilfeldige bytes som base64url", () => {
    const token = generateApiKeyToken();

    expect(token).toMatch(API_KEY_TOKEN_PATTERN);
    expect(token).toHaveLength(47);
    expect(token.slice(0, 4)).toBe("fsm_");
    expect(generateApiKeyToken()).not.toBe(token);
  });

  it("hasher med SHA-256 hex uten å lagre klarteksten", () => {
    const token = "fsm_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    const hash = hashApiKeyToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashApiKeyToken(token));
    expect(hash).not.toContain(token);
  });
});

describe("validering av API-nøkkelinput", () => {
  it("godtar navn på 1–80 tegn og en fremtidig utløpsdato", () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const parsed = parseApiKeyInput({ name: "a".repeat(80), expiresAt });

    expect(parsed.name).toHaveLength(80);
    expect(parsed.expiresAt?.getTime()).toBe(expiresAt.getTime());
  });

  it("avviser tomt navn, for langt navn og utløp i fortiden", () => {
    expect(() => parseApiKeyInput({ name: "" })).toThrow(ApiKeyValidationError);
    expect(() => parseApiKeyInput({ name: "a".repeat(81) })).toThrow(
      ApiKeyValidationError,
    );
    expect(() =>
      parseApiKeyInput({ name: "Test", expiresAt: new Date(Date.now() - 1) }),
    ).toThrow(ApiKeyValidationError);
    expect(() =>
      parseApiKeyInput({ name: "Test", expiresAt: "ikke-en-dato" }),
    ).toThrow(ApiKeyValidationError);
  });
});

describe("createApiKeyForUser", () => {
  it("lagrer bare hash og prefix, og returnerer tokenet én gang", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const result = await createApiKeyForUser("user-1", {
      name: "  Integrasjon  ",
      expiresAt: expiresAt.toISOString(),
    });

    expect(result.token).toMatch(API_KEY_TOKEN_PATTERN);
    expect(result.apiKey.prefix).toBe(result.token.slice(0, 12));
    expect(result.apiKey).not.toHaveProperty("keyHash");
    expect(JSON.stringify(result.apiKey)).not.toContain(result.token);

    const create = mocks.prisma.apiKey.create.mock.calls[0][0];
    expect(create.data).toEqual({
      name: "Integrasjon",
      keyHash: hashApiKeyToken(result.token),
      prefix: result.token.slice(0, 12),
      userId: "user-1",
      expiresAt: new Date(expiresAt),
    });
    expect(create.data).not.toHaveProperty("token");
    expect(create.data.keyHash).not.toBe(result.token);
  });

  it("avviser utløpsdato som ikke er i fremtiden", async () => {
    await expect(
      createApiKeyForUser("user-1", {
        name: "Gammel",
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toBeInstanceOf(ApiKeyValidationError);
    expect(mocks.prisma.apiKey.create).not.toHaveBeenCalled();
  });
});

describe("createApiKey", () => {
  it("lar bare administrator opprette nøkler", async () => {
    const result = await createApiKey(
      actor({ role: "OFFICE" }),
      { name: "Test" },
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(mocks.prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it("oppretter nøkkel for aktøren og returnerer token og visningsobjekt", async () => {
    const result = await createApiKey(actor(), {
      name: "Nettside",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("forventet ok");
    expect(result.token).toMatch(API_KEY_TOKEN_PATTERN);
    expect(result.key.name).toBe("Nettside");
    expect(result.key.user).toEqual({
      id: "actor",
      name: "Admin",
      email: "admin@example.test",
    });
    expect(result.key).not.toHaveProperty("keyHash");
  });

  it("avviser ugyldig input med stabil feilkode", async () => {
    const result = await createApiKey(actor(), { name: "" });

    expect(result).toEqual({ ok: false, error: "validation_error" });
  });

  it("nekter å lage nøkkel for en manglende eller inaktiv mottaker", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "other",
      isActive: false,
    });

    await expect(
      createApiKey(actor(), { name: "Test", userId: "other" }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(mocks.prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it("returnerer server_error når databasen feiler", async () => {
    mocks.prisma.apiKey.create.mockRejectedValue(new Error("db nede"));

    await expect(
      createApiKey(actor(), { name: "Test" }),
    ).resolves.toEqual({ ok: false, error: "server_error" });
  });
});

describe("listApiKeys", () => {
  it("er administratorstyrt og eksponerer aldri hash eller token", async () => {
    expect(await listApiKeys(actor({ role: "TECHNICIAN" }))).toEqual({
      ok: false,
      error: "forbidden",
    });

    mocks.prisma.apiKey.findMany.mockResolvedValue([
      storedRow({ keyHash: "hemmelig-hash" }),
    ]);

    const result = await listApiKeys(actor());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("forventet ok");
    expect(result.keys[0].user?.email).toBe("admin@example.test");
    expect(result.keys[0]).not.toHaveProperty("keyHash");
    expect(JSON.stringify(result)).not.toContain("hemmelig-hash");
  });
});

describe("revokeApiKey", () => {
  it("setter revokedAt én gang og er idempotent", async () => {
    mocks.prisma.apiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: null,
    });

    await expect(revokeApiKey(actor(), "key-1")).resolves.toEqual({ ok: true });
    const update = mocks.prisma.apiKey.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "key-1" });
    expect(update.data.revokedAt).toBeInstanceOf(Date);

    mocks.prisma.apiKey.update.mockClear();
    mocks.prisma.apiKey.findUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: new Date(),
    });
    await expect(revokeApiKey(actor(), "key-1")).resolves.toEqual({ ok: true });
    expect(mocks.prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it("avviser ikke-administrator og ukjent nøkkel", async () => {
    await expect(
      revokeApiKey(actor({ role: "OFFICE" }), "key-1"),
    ).resolves.toEqual({ ok: false, error: "forbidden" });

    mocks.prisma.apiKey.findUnique.mockResolvedValue(null);
    await expect(revokeApiKey(actor(), "ukjent")).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
