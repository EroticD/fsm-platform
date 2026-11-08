import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  moduleApiGuard: vi.fn(),
  assertSameOrigin: vi.fn(),
  allowRequestDb: vi.fn(),
  getRoutePlan: vi.fn(),
  applyRouteOrder: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/module-guards", () => ({
  moduleApiGuard: mocks.moduleApiGuard,
}));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/route-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/route-plan")>();
  return {
    ...actual,
    getRoutePlan: mocks.getRoutePlan,
    applyRouteOrder: mocks.applyRouteOrder,
  };
});

import { POST } from "./route";

const office = {
  id: "office-1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

const plan = {
  date: "2026-11-03",
  totalOvertimeMinutes: 25,
  plans: [
    {
      technicianId: "tech-1",
      technicianName: "Ola Montør",
      technicianEmail: "ola@example.test",
      stops: [
        { visitId: "visit-a" },
        { visitId: "visit-b" },
      ],
      skipped: [],
      totalDistanceKm: 10,
      totalTravelMinutes: 20,
      totalWaitingMinutes: 5,
      totalOvertimeMinutes: 25,
      baselineTravelMinutes: 35,
      baselineDistanceKm: 17.5,
      baselineOvertimeMinutes: 0,
      savedTravelMinutes: 15,
      savedDistanceKm: 7.5,
      orderChanged: true,
      startAt: new Date("2026-11-03T08:00:00.000Z"),
      finishAt: new Date("2026-11-03T11:00:00.000Z"),
      provider: "osrm",
      fallbackUsed: false,
    },
  ],
};

function request(body: unknown) {
  return new Request("http://localhost/api/ruteoptimalisering", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(office);
  mocks.hasPermission.mockImplementation(
    (_user: unknown, permission: string) =>
      ["workorders.view", "workorders.update", "workorders.assign"].includes(
        permission,
      ),
  );
  mocks.moduleApiGuard.mockResolvedValue(null);
  mocks.assertSameOrigin.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.getRoutePlan.mockResolvedValue({ ok: true, data: plan });
  mocks.applyRouteOrder.mockResolvedValue({
    ok: true,
    data: { applied: 2, skipped: [], moves: [] },
  });
});

describe("ruteoptimalisering-API", () => {
  it("gir 404 når kalendermodulen er av", async () => {
    mocks.moduleApiGuard.mockResolvedValue(
      new NextResponse(null, { status: 404 }),
    );

    const response = await POST(
      request({ date: "2026-11-03", technicianId: "tech-1" }),
    );

    expect(response.status).toBe(404);
    expect(mocks.getRoutePlan).not.toHaveBeenCalled();
  });

  it("krever innlogging og rettighet", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(
      (await POST(request({ date: "2026-11-03" }))).status,
    ).toBe(401);

    mocks.getCurrentUser.mockResolvedValue(office);
    mocks.hasPermission.mockReturnValue(false);
    expect(
      (await POST(request({ date: "2026-11-03" }))).status,
    ).toBe(403);
  });

  it("tørrkjører uten å flytte noe", async () => {
    const response = await POST(
      request({
        date: "2026-11-03",
        technicianId: "tech-1",
        visitIds: ["visit-a", "visit-b"],
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.applied).toBe(0);
    expect(body.plans[0].savedTravelMinutes).toBe(15);
    expect(body.plans[0].totalOvertimeMinutes).toBe(25);
    expect(body.totalOvertimeMinutes).toBe(25);
    expect(mocks.getRoutePlan).toHaveBeenCalledWith(office, {
      date: "2026-11-03",
      technicianId: "tech-1",
      departmentId: undefined,
      visitIds: ["visit-a", "visit-b"],
    });
    expect(mocks.applyRouteOrder).not.toHaveBeenCalled();
  });

  it("avviser ugyldig dato", async () => {
    const response = await POST(
      request({ date: "03.11.2026", technicianId: "tech-1" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.getRoutePlan).not.toHaveBeenCalled();
  });

  it("krever tildelingsrettighet for å bruke forslaget", async () => {
    mocks.hasPermission.mockImplementation(
      (_user: unknown, permission: string) => permission === "workorders.update",
    );

    const response = await POST(
      request({ date: "2026-11-03", technicianId: "tech-1", apply: true }),
    );

    expect(response.status).toBe(403);
    expect(mocks.applyRouteOrder).not.toHaveBeenCalled();
  });

  it("bruker rekkefølgen gjennom den revisjonsloggede tjenesten", async () => {
    const response = await POST(
      request({ date: "2026-11-03", technicianId: "tech-1", apply: true }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dryRun).toBe(false);
    expect(body.applied).toBe(2);
    expect(mocks.applyRouteOrder).toHaveBeenCalledWith(office, {
      date: "2026-11-03",
      technicianId: "tech-1",
      visitIds: ["visit-a", "visit-b"],
    });
  });

  it("returnerer 429 når takten er nådd", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 12,
    });

    const response = await POST(
      request({ date: "2026-11-03", technicianId: "tech-1" }),
    );

    expect(response.status).toBe(429);
    expect(mocks.getRoutePlan).not.toHaveBeenCalled();
  });
});
