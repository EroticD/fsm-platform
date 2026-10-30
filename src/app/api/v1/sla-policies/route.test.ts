import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  prisma: { slaPolicy: { findMany: vi.fn() } },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { GET } from "./route";

function actor(overrides: Record<string, unknown> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    roleDefinition: { permissions: ["contracts.view"] },
    ...overrides,
  } as ServiceActor;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true as const,
    actor: actor(),
    apiKeyId: "key-1",
  });
  mocks.prisma.slaPolicy.findMany.mockResolvedValue([]);
});

describe("GET /api/v1/sla-policies", () => {
  it("avgrenser til globale policyer og egen avdeling", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/sla-policies"),
    );

    expect(response.status).toBe(200);
    const call = mocks.prisma.slaPolicy.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      isActive: true,
      OR: [{ departmentId: null }, { departmentId: "dep-a" }],
    });
  });

  it("lar administrator se alle policyer", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: true as const,
      actor: actor({ role: "ADMIN" }),
      apiKeyId: "key-1",
    });

    await GET(new Request("http://localhost/api/v1/sla-policies"));
    const call = mocks.prisma.slaPolicy.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ isActive: true });
  });

  it("nekter aktører uten avtale- eller SLA-tilgang", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: true as const,
      actor: actor({ roleDefinition: { permissions: [] } }),
      apiKeyId: "key-1",
    });

    const response = await GET(
      new Request("http://localhost/api/v1/sla-policies"),
    );
    expect(response.status).toBe(403);
    expect(mocks.prisma.slaPolicy.findMany).not.toHaveBeenCalled();
  });
});
