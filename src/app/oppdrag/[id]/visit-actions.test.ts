import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  getCurrentUser: vi.fn(),
  createVisit: vi.fn(),
  moveVisit: vi.fn(),
  assignVisit: vi.fn(),
  updateVisit: vi.fn(),
  deleteVisit: vi.fn(),
  setVisitStatus: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/work-orders", () => ({}));
vi.mock("@/server/reports", () => ({ setReportLock: vi.fn() }));
vi.mock("@/server/visits", () => ({
  createVisit: mocks.createVisit,
  moveVisit: mocks.moveVisit,
  assignVisit: mocks.assignVisit,
  updateVisit: mocks.updateVisit,
  deleteVisit: mocks.deleteVisit,
  setVisitStatus: mocks.setVisitStatus,
}));

import {
  createVisit,
  deleteVisit,
  moveVisit,
  setVisitStatus,
} from "./actions";

const user = {
  id: "u1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
});

describe("visitt-handlinger på kontorsiden", () => {
  it("tolker dato og klokkeslett i Oslo og oppretter via tjenesten", async () => {
    mocks.createVisit.mockResolvedValue({ ok: true, data: { id: "visit-1" } });

    await expect(
      createVisit(
        form({
          workOrderId: "wo-1",
          startsOn: "2026-10-30",
          startTime: "09:30",
          endsOn: "2026-10-30",
          endTime: "11:00",
          notes: "Ta med nøkkel",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo-1?ok=visitt-opprettet#planlegging",
    );

    expect(mocks.createVisit).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        workOrderId: "wo-1",
        startsAt: new Date("2026-10-30T08:30:00.000Z"),
        endsAt: new Date("2026-10-30T10:00:00.000Z"),
        allDay: false,
        notes: "Ta med nøkkel",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/oppdrag/wo-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mine-oppdrag/wo-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kart");
  });

  it("lager heldagsvisitt med eksklusiv slutt ved midnatt", async () => {
    mocks.createVisit.mockResolvedValue({ ok: true, data: { id: "visit-1" } });

    await expect(
      createVisit(
        form({
          workOrderId: "wo-1",
          startsOn: "2026-10-30",
          endsOn: "2026-10-31",
          allDay: "on",
        }),
      ),
    ).rejects.toThrow("ok=visitt-opprettet");

    expect(mocks.createVisit).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        startsAt: new Date("2026-10-29T23:00:00.000Z"),
        endsAt: new Date("2026-10-31T23:00:00.000Z"),
        allDay: true,
      }),
    );
  });

  it("avviser ugyldig tidsrom før tjenesten kalles", async () => {
    await expect(
      createVisit(
        form({
          workOrderId: "wo-1",
          startsOn: "2026-10-30",
          startTime: "11:00",
          endsOn: "2026-10-30",
          endTime: "09:00",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo-1?planningError=invalidTimeRange#planlegging",
    );

    expect(mocks.createVisit).not.toHaveBeenCalled();
  });

  it("oversetter overlappfeil til en inline feilkode", async () => {
    mocks.createVisit.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "visits.errors.overlap" },
    });

    await expect(
      createVisit(
        form({
          workOrderId: "wo-1",
          startsOn: "2026-10-30",
          startTime: "09:00",
          endsOn: "2026-10-30",
          endTime: "10:00",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo-1?planningError=overlap#planlegging",
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("flytter en heldagsvisitt med datoer i Oslo", async () => {
    mocks.moveVisit.mockResolvedValue({ ok: true, data: { id: "visit-1" } });

    await expect(
      moveVisit(
        form({
          workOrderId: "wo-1",
          visitId: "visit-1",
          startsOn: "2026-10-30",
          endsOn: "2026-10-31",
          allDay: "true",
        }),
      ),
    ).rejects.toThrow("ok=visitt-flyttet");

    expect(mocks.moveVisit).toHaveBeenCalledWith(user, "visit-1", {
      startsAt: new Date("2026-10-29T23:00:00.000Z"),
      endsAt: new Date("2026-10-31T23:00:00.000Z"),
    });
  });

  it("sletter via tjenesten og kvitterer på oppdragssiden", async () => {
    mocks.deleteVisit.mockResolvedValue({ ok: true, data: undefined });

    await expect(
      deleteVisit(form({ workOrderId: "wo-1", visitId: "visit-1" })),
    ).rejects.toThrow("ok=visitt-slettet");

    expect(mocks.deleteVisit).toHaveBeenCalledWith(user, "visit-1");
  });

  it("sender statusvalget videre uten å gjette overgangen", async () => {
    mocks.setVisitStatus.mockResolvedValue({
      ok: true,
      data: { id: "visit-1" },
    });

    await expect(
      setVisitStatus(
        form({
          workOrderId: "wo-1",
          visitId: "visit-1",
          status: "ON_SITE",
        }),
      ),
    ).rejects.toThrow("ok=visitt-status");

    expect(mocks.setVisitStatus).toHaveBeenCalledWith(
      user,
      "visit-1",
      "ON_SITE",
    );
  });
});
