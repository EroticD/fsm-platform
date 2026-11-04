import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type SiteResult =
    | {
        ok: true;
        data: {
          sites: Array<{
            id: string;
            customerId: string;
            name: string;
            address: string | null;
            postalCode: string | null;
            city: string | null;
            isPrimary: boolean;
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
    getCustomerSiteOptions: vi.fn(
      async (): Promise<SiteResult> => ({
        ok: true,
        data: { sites: [], total: 0, query: "" },
      }),
    ),
  };
});

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/customer-sites", () => ({
  CUSTOMER_SITE_OPTION_MAX: 200,
  getCustomerSiteOptions: mocks.getCustomerSiteOptions,
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

function request(customerId?: string, q?: string) {
  const params = new URLSearchParams();
  if (customerId) params.set("customerId", customerId);
  if (q) params.set("q", q);
  const suffix = params.toString();
  return new Request(`http://localhost/api/kunder/steder${suffix ? `?${suffix}` : ""}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.getCustomerSiteOptions.mockResolvedValue({
    ok: true,
    data: { sites: [], total: 0, query: "" },
  });
});

describe("GET /api/kunder/steder", () => {
  it("nekter kundeportal, inaktive brukere og manglende rettigheter", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...user(), role: "CUSTOMER" });
    expect((await GET(request("cust-1"))).status).toBe(403);

    mocks.getCurrentUser.mockResolvedValue({ ...user(), isActive: false });
    expect((await GET(request("cust-1"))).status).toBe(403);

    mocks.getCurrentUser.mockResolvedValue(user());
    mocks.hasPermission.mockReturnValue(false);
    expect((await GET(request("cust-1"))).status).toBe(403);
    expect(mocks.getCustomerSiteOptions).not.toHaveBeenCalled();
  });

  it("respekterer rate limit", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 7,
    });

    const response = await GET(request("cust-1"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getCustomerSiteOptions).not.toHaveBeenCalled();
  });

  it("sender kunde og søk videre til den kundeavgrensede tjenesten", async () => {
    mocks.getCustomerSiteOptions.mockResolvedValue({
      ok: true,
      data: {
        sites: [
          {
            id: "s1",
            customerId: "cust-1",
            name: "Lager sør",
            address: "Gata 1",
            postalCode: "0001",
            city: "Oslo",
            isPrimary: true,
          },
        ],
        total: 1,
        query: "lager",
      },
    });

    const response = await GET(request("cust-1", "lager"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.getCustomerSiteOptions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "cust-1",
      { query: "lager", limit: 200 },
    );
    const body = (await response.json()) as {
      sites: Array<{ name: string; customerId: string }>;
    };
    expect(body.sites).toEqual([
      expect.objectContaining({ name: "Lager sør", customerId: "cust-1" }),
    ]);
  });

  it("returnerer tomt uten å slå opp når kunde mangler", async () => {
    const response = await GET(request(undefined, "lager"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sites: [],
      total: 0,
      query: "lager",
    });
    expect(mocks.getCustomerSiteOptions).not.toHaveBeenCalled();
  });

  it("mapper ukjent kunde til 404 uten å lekke rader", async () => {
    mocks.getCustomerSiteOptions.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });

    const response = await GET(request("borte"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
