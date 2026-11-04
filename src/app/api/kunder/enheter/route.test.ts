import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type EquipmentResult =
    | {
        ok: true;
        data: {
          equipment: Array<{
            id: string;
            customerId: string;
            model: string;
            serialNumber: string | null;
            location: string | null;
          }>;
          total: number;
          query: string;
        };
      }
    | { ok: false; reason: string };
  return {
    getCurrentUser: vi.fn(),
    hasPermission: vi.fn(() => true),
    allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    getCustomerEquipmentOptions: vi.fn(
      async (): Promise<EquipmentResult> => ({
        ok: true,
        data: { equipment: [], total: 0, query: "" },
      }),
    ),
  };
});

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/equipment", () => ({
  getCustomerEquipmentOptions: mocks.getCustomerEquipmentOptions,
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

function request(customerId?: string, q?: string, excludeId?: string) {
  const params = new URLSearchParams();
  if (customerId) params.set("customerId", customerId);
  if (q) params.set("q", q);
  if (excludeId) params.set("excludeId", excludeId);
  const suffix = params.toString();
  return new Request(
    `http://localhost/api/kunder/enheter${suffix ? `?${suffix}` : ""}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.getCustomerEquipmentOptions.mockResolvedValue({
    ok: true,
    data: { equipment: [], total: 0, query: "" },
  });
});

describe("GET /api/kunder/enheter", () => {
  it("krever equipment.view og nekter kundeportal", async () => {
    mocks.hasPermission.mockReturnValue(false);
    expect((await GET(request("cust-1"))).status).toBe(403);

    mocks.hasPermission.mockReturnValue(true);
    mocks.getCurrentUser.mockResolvedValue({ ...user(), role: "CUSTOMER" });
    expect((await GET(request("cust-1"))).status).toBe(403);
    expect(mocks.getCustomerEquipmentOptions).not.toHaveBeenCalled();
  });

  it("respekterer rate limit", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 3,
    });

    const response = await GET(request("cust-1"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(mocks.getCustomerEquipmentOptions).not.toHaveBeenCalled();
  });

  it("sender kunde, søk og utelatt enhet videre", async () => {
    mocks.getCustomerEquipmentOptions.mockResolvedValue({
      ok: true,
      data: {
        equipment: [
          {
            id: "p1",
            customerId: "cust-1",
            model: "Pumpe",
            serialNumber: "SN-1",
            location: "Bygg A",
          },
        ],
        total: 1,
        query: "pumpe",
      },
    });

    const response = await GET(request("cust-1", "pumpe", "p9"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getCustomerEquipmentOptions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "cust-1",
      { query: "pumpe", excludeId: "p9" },
    );
    await expect(response.json()).resolves.toEqual({
      equipment: [
        {
          id: "p1",
          customerId: "cust-1",
          model: "Pumpe",
          serialNumber: "SN-1",
          location: "Bygg A",
        },
      ],
      total: 1,
      query: "pumpe",
    });
  });

  it("returnerer tomt uten kunde og 404 for ukjent kunde", async () => {
    const empty = await GET(request(undefined, "pumpe"));
    await expect(empty.json()).resolves.toEqual({
      equipment: [],
      total: 0,
      query: "pumpe",
    });
    expect(mocks.getCustomerEquipmentOptions).not.toHaveBeenCalled();

    mocks.getCustomerEquipmentOptions.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });
    expect((await GET(request("borte"))).status).toBe(404);
  });
});
