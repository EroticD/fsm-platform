import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkOrderAccess: vi.fn(),
  assignTechnician: vi.fn(),
  unassignTechnician: vi.fn(),
  moveTechnician: vi.fn(),
  changeWorkOrderStatus: vi.fn(),
  assignVisit: vi.fn(),
  unassignVisit: vi.fn(),
  setVisitStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/access", () => ({
  requireWorkOrderAccess: mocks.requireWorkOrderAccess,
}));
vi.mock("@/server/work-orders", () => ({
  assignTechnician: mocks.assignTechnician,
  unassignTechnician: mocks.unassignTechnician,
  moveTechnician: mocks.moveTechnician,
  changeWorkOrderStatus: mocks.changeWorkOrderStatus,
}));
vi.mock("@/server/visits", () => ({
  assignVisit: mocks.assignVisit,
  unassignVisit: mocks.unassignVisit,
  setVisitStatus: mocks.setVisitStatus,
}));

import {
  assignVisitTechniciansAction,
  moveTechnicianAction,
  unassignVisitTechnicianAction,
  updateStatusAction,
  updateVisitStatusAction,
} from "./actions";

const user = { id: "u1", name: "Kari", email: "kari@example.com" };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkOrderAccess.mockResolvedValue({
    user,
    workOrder: { id: "wo-1", status: "OPEN" },
  });
});

describe("moveTechnicianAction", () => {
  it("sender både kilde og mål til tjenesten og revaliderer tavla", async () => {
    mocks.moveTechnician.mockResolvedValue({ ok: true });

    const result = await moveTechnicianAction(
      form({ workOrderId: "wo-1", fromTechnicianId: "tech-1", technicianId: "tech-2" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireWorkOrderAccess).toHaveBeenCalledWith(
      "workorders.assign",
      "wo-1",
    );
    expect(mocks.moveTechnician).toHaveBeenCalledWith(
      user,
      "wo-1",
      "tech-1",
      "tech-2",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/dispatch");
  });

  it("tillater slipp på uten montør uten målmontør", async () => {
    mocks.moveTechnician.mockResolvedValue({ ok: true });

    const result = await moveTechnicianAction(
      form({ workOrderId: "wo-1", fromTechnicianId: "tech-1" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.moveTechnician).toHaveBeenCalledWith(
      user,
      "wo-1",
      "tech-1",
      "",
    );
  });

  it("normaliserer kildkolonnen unassigned til tom id", async () => {
    mocks.moveTechnician.mockResolvedValue({ ok: true });

    const result = await moveTechnicianAction(
      form({
        workOrderId: "wo-1",
        fromTechnicianId: "unassigned",
        technicianId: "tech-2",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.moveTechnician).toHaveBeenCalledWith(
      user,
      "wo-1",
      "",
      "tech-2",
    );
  });

  it("avviser en forespørsel uten kilde og mål før tjenesten kalles", async () => {
    const result = await moveTechnicianAction(form({ workOrderId: "wo-1" }));

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.moveTechnician).not.toHaveBeenCalled();
  });

  it("videresender tjenestens avvisning uten å revalidere", async () => {
    mocks.moveTechnician.mockResolvedValue({
      ok: false,
      error: "workorder-locked",
    });

    const result = await moveTechnicianAction(
      form({ workOrderId: "wo-1", fromTechnicianId: "tech-1", technicianId: "tech-2" }),
    );

    expect(result).toEqual({ ok: false, error: "workorder-locked" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("assignVisitTechniciansAction", () => {
  it("sender hele den ønskede montørlisten til visittjenesten", async () => {
    mocks.assignVisit.mockResolvedValue({ ok: true });

    const result = await assignVisitTechniciansAction(
      form({
        workOrderId: "wo-1",
        visitId: "visit-1",
        technicianId: "tech-1",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireWorkOrderAccess).toHaveBeenCalledWith(
      "workorders.assign",
      "wo-1",
    );
    expect(mocks.assignVisit).toHaveBeenCalledWith(
      user,
      "visit-1",
      ["tech-1"],
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/dispatch");
  });

  it("støtter flere montører på samme visitt", async () => {
    mocks.assignVisit.mockResolvedValue({ ok: true });
    const data = form({
      workOrderId: "wo-1",
      visitId: "visit-1",
      technicianId: "tech-1",
    });
    data.append("technicianId", "tech-2");

    await assignVisitTechniciansAction(data);

    expect(mocks.assignVisit).toHaveBeenCalledWith(
      user,
      "visit-1",
      ["tech-1", "tech-2"],
    );
  });

  it("videresender overlappkoden uten å revalidere", async () => {
    mocks.assignVisit.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "visits.errors.overlap", conflicts: [] },
    });

    const result = await assignVisitTechniciansAction(
      form({
        workOrderId: "wo-1",
        visitId: "visit-1",
        technicianId: "tech-1",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "visits.errors.overlap",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("avviser tom montørliste før tjenesten kalles", async () => {
    const result = await assignVisitTechniciansAction(
      form({ workOrderId: "wo-1", visitId: "visit-1" }),
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.assignVisit).not.toHaveBeenCalled();
  });
});

describe("unassignVisitTechnicianAction", () => {
  it("fjerner én montør og beholder de øvrige", async () => {
    mocks.unassignVisit.mockResolvedValue({ ok: true });

    const result = await unassignVisitTechnicianAction(
      form({
        workOrderId: "wo-1",
        visitId: "visit-1",
        technicianId: "tech-1",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.unassignVisit).toHaveBeenCalledWith(
      user,
      "visit-1",
      "tech-1",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/dispatch");
  });

  it("avviser manglende montør før tjenesten kalles", async () => {
    const result = await unassignVisitTechnicianAction(
      form({ workOrderId: "wo-1", visitId: "visit-1" }),
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.unassignVisit).not.toHaveBeenCalled();
  });
});

describe("updateVisitStatusAction", () => {
  it("bruker visittens tilstandsmaskin", async () => {
    mocks.setVisitStatus.mockResolvedValue({ ok: true });

    const result = await updateVisitStatusAction(
      form({
        workOrderId: "wo-1",
        visitId: "visit-1",
        status: "ON_SITE",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireWorkOrderAccess).toHaveBeenCalledWith(
      "workorders.update",
      "wo-1",
    );
    expect(mocks.setVisitStatus).toHaveBeenCalledWith(
      user,
      "visit-1",
      "ON_SITE",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/dispatch");
  });

  it("videresender en ulovlig statusovergang", async () => {
    mocks.setVisitStatus.mockResolvedValue({
      ok: false,
      reason: "invalid",
      details: { code: "visits.errors.statusTransition" },
    });

    const result = await updateVisitStatusAction(
      form({
        workOrderId: "wo-1",
        visitId: "visit-1",
        status: "DONE",
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "visits.errors.statusTransition",
    });
  });

  it("avviser en uinnlogget/uten tilgang før tjenesten kalles", async () => {
    mocks.requireWorkOrderAccess.mockResolvedValue(null);

    const result = await updateVisitStatusAction(
      form({
        workOrderId: "wo-1",
        visitId: "visit-1",
        status: "DONE",
      }),
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
  });
});

describe("updateStatusAction", () => {
  it("bruker samme statusregler som oppdragsdetaljen", async () => {
    mocks.changeWorkOrderStatus.mockResolvedValue({ ok: true });

    const result = await updateStatusAction(
      form({ workOrderId: "wo-1", status: "COMPLETED" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireWorkOrderAccess).toHaveBeenCalledWith(
      "workorders.update",
      "wo-1",
    );
    expect(mocks.changeWorkOrderStatus).toHaveBeenCalledWith(
      user,
      "wo-1",
      "COMPLETED",
      "office",
      null,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kalender/dispatch");
  });

  it("avviser statusendring uten tilgang før tjenesten kalles", async () => {
    mocks.requireWorkOrderAccess.mockResolvedValue(null);

    const result = await updateStatusAction(
      form({ workOrderId: "wo-1", status: "COMPLETED" }),
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.changeWorkOrderStatus).not.toHaveBeenCalled();
  });

  it("videresender kanselleringsregelen fra tjenesten", async () => {
    mocks.changeWorkOrderStatus.mockResolvedValue({
      ok: false,
      error: "ugyldig-status",
    });

    const result = await updateStatusAction(
      form({ workOrderId: "wo-1", status: "CANCELLED" }),
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
