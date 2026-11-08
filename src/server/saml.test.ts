import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map<string, { value: string; expiresAt: Date }>());

const mocks = vi.hoisted(() => ({
  resolveSsoUser: vi.fn(),
  recordSsoLogin: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    samlCacheEntry: {
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { key: string };
          update: { value: string; expiresAt: Date };
          create: { key: string; value: string; expiresAt: Date };
        }) => {
          const existing = cache.get(where.key);
          const row = existing
            ? { ...existing, ...update }
            : { ...create };
          cache.set(where.key, {
            value: row.value,
            expiresAt: row.expiresAt,
          });
          return { key: where.key, ...row };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const row = cache.get(where.key);
        return row ? { key: where.key, ...row } : null;
      }),
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { key?: string; expiresAt?: { lte: Date } };
        }) => {
          let count = 0;
          for (const [key, row] of cache.entries()) {
            if (where.key !== undefined && key !== where.key) continue;
            if (where.expiresAt && row.expiresAt > where.expiresAt.lte) continue;
            cache.delete(key);
            count += 1;
          }
          return { count };
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { key: string; value: string; expiresAt: Date };
        }) => {
          if (cache.has(data.key)) {
            const error = new Error("unique") as Error & { code: string };
            error.code = "P2002";
            throw error;
          }
          cache.set(data.key, {
            value: data.value,
            expiresAt: data.expiresAt,
          });
          return data;
        },
      ),
    },
  },
}));

vi.mock("@/server/sso", () => ({
  resolveSsoUser: mocks.resolveSsoUser,
  recordSsoLogin: mocks.recordSsoLogin,
}));

import {
  buildSignedSamlResponse,
  samlResponseBase64,
  testSamlConfig,
} from "@/test/saml-fixture";
import {
  createSamlRelayState,
  handleSamlResponse,
  readSamlRelayState,
} from "./saml";

const sessionUser = {
  id: "u1",
  email: "kari@example.no",
  name: "Kari Test",
  role: "OFFICE",
  isActive: true,
  isTwoFactorEnabled: false,
  sessionVersion: 1,
  departmentId: "dep-a",
  customerId: null,
};

function validResponse(overrides: Parameters<typeof buildSignedSamlResponse>[0] = {}) {
  return buildSignedSamlResponse({
    requestId: "_request-1",
    assertionId: "_assertion-1",
    ...overrides,
  });
}

beforeEach(() => {
  cache.clear();
  vi.clearAllMocks();
  mocks.resolveSsoUser.mockResolvedValue({
    ok: true,
    user: sessionUser,
    provisioned: false,
    linked: true,
    roleChanged: false,
    matchedGroups: ["FSM-Office"],
  });
  mocks.recordSsoLogin.mockResolvedValue(undefined);
});

describe("SAML RelayState", () => {
  it("binder callback til en engangsnøkkel og avviser gjenbruk", async () => {
    const nonce = await createSamlRelayState("test", "/kunder/1?tab=mer");
    expect(nonce.length).toBeLessThan(80);
    expect(await readSamlRelayState("test", nonce)).toBe(
      "/kunder/1?tab=mer",
    );
    expect(await readSamlRelayState("test", nonce)).toBe("/");
    expect(await readSamlRelayState("annen", nonce)).toBe("/");
  });

  it("avviser eksterne callback-adresser", async () => {
    const nonce = await createSamlRelayState(
      "test",
      "https://evil.example/",
    );
    expect(await readSamlRelayState("test", nonce)).toBe("/");
  });
});

describe("handleSamlResponse", () => {
  it("validerer en signert assertion og videresender claims til kontokoblingen", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(validResponse()),
      RelayState: "nonce",
    });

    expect(result.ok).toBe(true);
    expect(mocks.resolveSsoUser).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "test", protocol: "saml" }),
      expect.objectContaining({
        sub: "subject-1",
        email: "kari@example.no",
        email_verified: true,
        groups: ["FSM-Office"],
      }),
    );
    expect(mocks.recordSsoLogin).toHaveBeenCalled();
  });

  it("avviser en assertion som er endret etter signering", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const xml = validResponse().replace(
      "kari@example.no",
      "angriper@example.no",
    );
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(xml),
    });

    expect(result).toEqual({ ok: false, reason: "invalid_assertion" });
    expect(mocks.resolveSsoUser).not.toHaveBeenCalled();
  });

  it("avviser feil audience", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(
        validResponse({ audience: "https://other.example/metadata" }),
      ),
    });

    expect(result).toEqual({ ok: false, reason: "invalid_assertion" });
  });

  it("avviser feil recipient", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(
        validResponse({ recipient: "https://evil.example/acs" }),
      ),
    });

    expect(result).toEqual({ ok: false, reason: "invalid_assertion" });
  });

  it("avviser en assertion utenfor tidsvinduet", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(
        validResponse({
          notBefore: new Date(Date.now() - 600_000),
          notOnOrAfter: new Date(Date.now() - 300_000),
        }),
      ),
    });

    expect(result).toEqual({ ok: false, reason: "invalid_assertion" });
  });

  it("avviser replay av samme assertion", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = validResponse();
    const first = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(response),
    });
    // En ny request-id skal ikke gjøre en allerede brukt assertion gyldig.
    cache.set("_request-2", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const second = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(response),
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "invalid_assertion" });
  });

  it("avviser SP-initierte svar uten InResponseTo", async () => {
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(
        validResponse({ includeInResponseTo: false }),
      ),
    });

    expect(result).toEqual({ ok: false, reason: "invalid_assertion" });
  });

  it("avviser usignert assertion", async () => {
    cache.set("_request-1", {
      value: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await handleSamlResponse(testSamlConfig(), {
      SAMLResponse: samlResponseBase64(
        validResponse({ includeSignature: false }),
      ),
    });

    expect(result).toEqual({ ok: false, reason: "invalid_assertion" });
  });
});
