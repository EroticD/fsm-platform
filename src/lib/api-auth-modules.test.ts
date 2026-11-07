import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
  prisma: { apiKey: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/server/modules", () => ({ moduleEnabled: mocks.moduleEnabled }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { authenticateApiRequest } from "./api-auth";

function request(path = "/api/v1/work-orders") {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer fsm_${"a".repeat(43)}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API-modulen", () => {
  it("svarer 404 når api-modulen er av, uten å slå opp nøkkelen", async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const result = await authenticateApiRequest(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
    expect(mocks.prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("svarer 404 når endepunktets modul er av", async () => {
    mocks.moduleEnabled.mockImplementation(async (key: string) => key === "api");
    const result = await authenticateApiRequest(request("/api/v1/contracts"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
    expect(mocks.prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });
});
