import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  applyRouteOrder: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/server/route-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/route-plan")>();
  return { ...actual, applyRouteOrder: mocks.applyRouteOrder };
});

import { applyRouteOrderAction, optimizeRouteAction } from "./actions";

const user = {
  id: "office-1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) data.append(key, item);
    } else {
      data.set(key, value);
    }
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.hasPermission.mockReturnValue(true);
  mocks.applyRouteOrder.mockResolvedValue({
    ok: true,
    data: { applied: 2, skipped: [], moves: [] },
  });
});

describe("applyRouteOrderAction", () => {  it("bruker rekkefølgen og redirecter med antall flyttede visiter", async () => {
    await expect(
      applyRouteOrderAction(
        form({
          dato: "2026-11-03",
          tekniker: "tech-1",
          visitId: ["visit-a", "visit-b"],
        }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/kalender/rute?dato=2026-11-03&tekniker=tech-1&anvendt=2",
    );

    expect(mocks.applyRouteOrder).toHaveBeenCalledWith(user, {
      date: "2026-11-03",
      technicianId: "tech-1",
      visitIds: ["visit-a", "visit-b"],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/rute");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/dispatch");
  });

  it("avviser brukere uten tildelingsrettighet før tjenestekallet", async () => {
    mocks.hasPermission.mockReturnValue(false);

    await expect(
      applyRouteOrderAction(
        form({ dato: "2026-11-03", tekniker: "tech-1", visitId: "visit-a" }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/kalender/rute?dato=2026-11-03&tekniker=tech-1&feil=route.errors.forbidden",
    );

    expect(mocks.applyRouteOrder).not.toHaveBeenCalled();
  });

  it("sender tjenestens konfliktkode tilbake til siden", async () => {
    mocks.applyRouteOrder.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "route.errors.absence" },
    });

    await expect(
      applyRouteOrderAction(
        form({
          dato: "2026-11-03",
          tekniker: "tech-1",
          visitId: ["visit-a", "visit-b"],
        }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/kalender/rute?dato=2026-11-03&tekniker=tech-1&feil=route.errors.absence",
    );
  });
});

describe("optimizeRouteAction", () => {
  it("åpner optimaliseringsforslaget uten å flytte noe", async () => {
    await expect(
      optimizeRouteAction(
        form({ dato: "2026-11-03", tekniker: "tech-1" }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/kalender/rute?dato=2026-11-03&tekniker=tech-1&optimaliser=1",
    );
  });

  it("avviser brukere uten oppdateringsrettighet", async () => {
    mocks.hasPermission.mockReturnValue(false);

    await expect(
      optimizeRouteAction(
        form({ dato: "2026-11-03", tekniker: "tech-1" }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/kalender/rute?dato=2026-11-03&tekniker=tech-1&feil=route.errors.forbidden",
    );
  });
});
