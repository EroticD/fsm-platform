import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  findMany: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/prisma", () => ({
  default: { contact: { findMany: mocks.findMany } },
}));

import { GET } from "./route";

function user() {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
  };
}

function request(customerId?: string) {
  const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
  return new Request(`http://localhost/api/kunder/kontakter${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.findMany.mockResolvedValue([]);
});

describe("GET /api/kunder/kontakter", () => {
  it("returnerer kontakter uten mellomlagring", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "p1", name: "Ola", role: "Drift", customerId: "c1" },
    ]);

    const response = await GET(request("c1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toEqual({
      contacts: [{ id: "p1", name: "Ola", role: "Drift", customerId: "c1" }],
    });
  });

  it("setter no-store også på tomt svar og feilsvar", async () => {
    const empty = await GET(request());
    expect(empty.headers.get("cache-control")).toBe("private, no-store");
    expect(empty.headers.get("vary")).toBe("Cookie");

    mocks.getCurrentUser.mockResolvedValue({ ...user(), role: "CUSTOMER" });
    const denied = await GET(request("c1"));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(denied.headers.get("vary")).toBe("Cookie");
  });
});
