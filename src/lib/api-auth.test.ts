import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));

import {
  API_KEY_RATE_LIMIT,
  API_KEY_RATE_WINDOW_MS,
  apiBearerToken,
  authenticateApiRequest,
} from "./api-auth";
import { hashApiKeyToken } from "@/server/api-keys";

const TOKEN = `fsm_${"a".repeat(43)}`;

function request(authorization?: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers(extraHeaders);
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/v1/work-orders", { headers });
}

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    revokedAt: null,
    expiresAt: null,
    user: {
      id: "u1",
      name: "Kari",
      email: "kari@example.test",
      role: "TECHNICIAN",
      isActive: true,
      departmentId: "dep-a",
      customerId: null,
      contactId: null,
      permissions: ["workorders.view"],
      permissionsCustomized: false,
      department: { id: "dep-a", name: "Avdeling A", isActive: true },
      roleDefinition: { permissions: ["workorders.view", "reports.write"] },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.apiKey.findUnique.mockResolvedValue(null);
  mocks.prisma.apiKey.update.mockResolvedValue({ id: "key-1" });
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("apiBearerToken", () => {
  it("godtar Bearer uten å bry seg om store/små bokstaver", () => {
    expect(apiBearerToken(request(`bearer ${TOKEN}`))).toBe(TOKEN);
    expect(apiBearerToken(request(`Bearer   ${TOKEN}  `))).toBe(TOKEN);
  });

  it("avviser andre ordninger og manglende header", () => {
    expect(apiBearerToken(request(`Basic ${TOKEN}`))).toBeNull();
    expect(apiBearerToken(request("Bearer"))).toBeNull();
    expect(apiBearerToken(request())).toBeNull();
  });
});

describe("authenticateApiRequest", () => {
  it("autentiserer en aktiv nøkkel, oppdaterer lastUsedAt og returnerer aktøren", async () => {
    mocks.prisma.apiKey.findUnique.mockResolvedValue(keyRow());

    const result = await authenticateApiRequest(request(`Bearer ${TOKEN}`));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("forventet ok");
    expect(result.apiKeyId).toBe("key-1");
    expect(result.actor).toMatchObject({
      id: "u1",
      email: "kari@example.test",
      role: "TECHNICIAN",
      isActive: true,
      departmentId: "dep-a",
      department: { id: "dep-a", name: "Avdeling A", isActive: true },
      roleDefinition: { permissions: ["workorders.view", "reports.write"] },
    });

    expect(mocks.prisma.apiKey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { keyHash: hashApiKeyToken(TOKEN) },
      }),
    );
    const update = mocks.prisma.apiKey.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "key-1" });
    expect(update.data.lastUsedAt).toBeInstanceOf(Date);
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "api-key:key-1",
      API_KEY_RATE_LIMIT,
      API_KEY_RATE_WINDOW_MS,
    );
  });

  it.each([
    ["manglende Authorization", undefined],
    ["feil ordning", `Basic ${TOKEN}`],
    ["feil tokenformat", "Bearer fsm_kort"],
    ["Bearer uten token", "Bearer "],
  ])("avviser %s med 401 og WWW-Authenticate", async (_label, header) => {
    const result = await authenticateApiRequest(request(header));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("www-authenticate")).toContain("Bearer");
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("godtar aldri en sesjonscookie uten Bearer-token", async () => {
    const result = await authenticateApiRequest(
      request(undefined, { cookie: "next-auth.session-token=gyldig-økt" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(401);
    expect(mocks.prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("avviser ukjent, tilbakekalt og utløpt nøkkel", async () => {
    await expect(
      authenticateApiRequest(request(`Bearer ${TOKEN}`)),
    ).resolves.toMatchObject({ ok: false });

    mocks.prisma.apiKey.findUnique.mockResolvedValue(
      keyRow({ revokedAt: new Date() }),
    );
    let result = await authenticateApiRequest(request(`Bearer ${TOKEN}`));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(401);

    mocks.prisma.apiKey.findUnique.mockResolvedValue(
      keyRow({ expiresAt: new Date(Date.now() - 1_000) }),
    );
    result = await authenticateApiRequest(request(`Bearer ${TOKEN}`));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(401);
    expect(mocks.prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it("avviser nøkkel der brukeren er deaktivert", async () => {
    const row = keyRow();
    row.user.isActive = false;
    mocks.prisma.apiKey.findUnique.mockResolvedValue(row);

    const result = await authenticateApiRequest(request(`Bearer ${TOKEN}`));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(401);
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
  });

  it("returnerer 429 med Retry-After når nøkkelen er over grensen", async () => {
    mocks.prisma.apiKey.findUnique.mockResolvedValue(keyRow());
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });

    const result = await authenticateApiRequest(request(`Bearer ${TOKEN}`));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("retry-after")).toBe("30");
    expect(result.response.headers.get("www-authenticate")).toBeNull();
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(mocks.prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it("returnerer en kontrollert 500-feil ved databasefeil", async () => {
    mocks.prisma.apiKey.findUnique.mockRejectedValue(new Error("db nede"));

    const result = await authenticateApiRequest(request(`Bearer ${TOKEN}`));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("forventet avvisning");
    expect(result.response.status).toBe(500);
    await expect(result.response.json()).resolves.toMatchObject({
      error: { code: "server_error" },
    });
  });
});
