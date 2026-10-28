import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  searchNormalizedIds: vi.fn(async () => [] as Array<{ id: string; score: number }>),
  findMany: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/search-sql", () => ({
  searchNormalizedIds: mocks.searchNormalizedIds,
}));
vi.mock("@/lib/prisma", () => ({
  default: { customer: { findMany: mocks.findMany } },
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

function search(query: string) {
  return GET(
    new Request(`http://localhost/api/kunder/sok?q=${encodeURIComponent(query)}`),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.searchNormalizedIds.mockResolvedValue([]);
  mocks.findMany.mockResolvedValue([]);
});

describe("GET /api/kunder/sok", () => {
  it("nekter kundeportal og inaktive brukere", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      ...user(),
      role: "CUSTOMER",
    });
    expect((await search("kari")).status).toBe(403);

    mocks.getCurrentUser.mockResolvedValue({ ...user(), isActive: false });
    expect((await search("kari")).status).toBe(403);
  });

  it("nekter brukere uten kunde-, oppdrags- eller redigeringstilgang", async () => {
    mocks.hasPermission.mockReturnValue(false);

    expect((await search("kari")).status).toBe(403);
    expect(mocks.searchNormalizedIds).not.toHaveBeenCalled();
  });

  it("respekterer rate limit", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 12,
    });

    const response = await search("kari");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(mocks.searchNormalizedIds).not.toHaveBeenCalled();
  });

  it("returnerer tomt uten å søke når q mangler", async () => {
    const response = await GET(new Request("http://localhost/api/kunder/sok?q=%20%20"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ customers: [] });
    expect(mocks.searchNormalizedIds).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("søker i alle kundekortfelter via den normaliserte hjelperen", async () => {
    await search("+47 123 45 678");

    expect(mocks.searchNormalizedIds).toHaveBeenCalledWith(
      "Customer",
      "+47 123 45 678",
      20,
    );
  });

  it("henter bare aktive kunder med visningsfeltene, i treffrekkefølge", async () => {
    mocks.searchNormalizedIds.mockResolvedValue([
      { id: "c2", score: 1 },
      { id: "c1", score: 0.8 },
    ]);
    mocks.findMany.mockResolvedValue([
      { id: "c1", name: "Alfa", city: "Oslo", customerNumber: "1001" },
      {
        id: "c2",
        name: "Beta",
        city: "Bergen",
        customerNumber: "1002",
        phone: "12345678",
        orgNumber: "999888777",
        email: "beta@example.test",
        notes: "intern",
      },
    ]);

    const response = await search("12345678");

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, id: { in: ["c2", "c1"] } },
      select: { id: true, name: true, city: true, customerNumber: true },
      take: 20,
    });
    await expect(response.json()).resolves.toEqual({
      customers: [
        { id: "c2", name: "Beta", city: "Bergen", customerNumber: "1002" },
        { id: "c1", name: "Alfa", city: "Oslo", customerNumber: "1001" },
      ],
    });
  });

  it("hopper over databaseoppslaget når søket ikke gir treff", async () => {
    mocks.searchNormalizedIds.mockResolvedValue([]);

    const response = await search("finnes-ikke");

    expect(mocks.findMany).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ customers: [] });
  });
});
