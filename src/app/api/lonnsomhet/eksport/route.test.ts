import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  moduleApiGuard: vi.fn(),
  exportProfitabilityCsv: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isOffice: (role?: string | null) => role === "ADMIN" || role === "OFFICE",
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/module-guards", () => ({
  moduleApiGuard: mocks.moduleApiGuard,
}));
vi.mock("@/server/bi", () => ({
  exportProfitabilityCsv: mocks.exportProfitabilityCsv,
}));

import { GET } from "./route";

const office = {
  id: "office-1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(office);
  mocks.hasPermission.mockReturnValue(true);
  mocks.moduleApiGuard.mockResolvedValue(null);
  mocks.exportProfitabilityCsv.mockResolvedValue({
    ok: true,
    data: {
      csv: "\uFEFFNivaa;Navn\r\n",
      fileName: "lonnsomhet-2026-11-01-2026-11-30.csv",
      checksum: "abc",
      rowCount: 1,
      filters: {
        from: "2026-11-01",
        to: "2026-11-30",
        departmentId: null,
        customerId: null,
        technicianId: null,
      },
    },
  });
});

describe("lønnsomhetseksportruten", () => {
  it("gir 404 når bi-modulen er av", async () => {
    mocks.moduleApiGuard.mockResolvedValue(
      new NextResponse(null, { status: 404 }),
    );

    const response = await GET(
      new Request("http://localhost/api/lonnsomhet/eksport"),
    );

    expect(response.status).toBe(404);
    expect(mocks.exportProfitabilityCsv).not.toHaveBeenCalled();
  });

  it("nekter montør", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...office, role: "TECHNICIAN" });

    const response = await GET(
      new Request("http://localhost/api/lonnsomhet/eksport"),
    );

    expect(response.status).toBe(403);
    expect(mocks.exportProfitabilityCsv).not.toHaveBeenCalled();
  });

  it("sender filtre videre og returnerer CSV", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/lonnsomhet/eksport?fra=2026-11-01&til=2026-11-30&avdeling=dep-a&kunde=cust-1&tekniker=tech-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.exportProfitabilityCsv).toHaveBeenCalledWith(office, {
      from: "2026-11-01",
      to: "2026-11-30",
      departmentId: "dep-a",
      customerId: "cust-1",
      technicianId: "tech-1",
    });
    await expect(response.text()).resolves.toContain("Nivaa");
  });

  it("oversetter tjenestefeil til HTTP-status", async () => {
    mocks.exportProfitabilityCsv.mockResolvedValue({
      ok: false,
      reason: "too_large",
    });

    const response = await GET(
      new Request("http://localhost/api/lonnsomhet/eksport"),
    );

    expect(response.status).toBe(413);
  });
});
