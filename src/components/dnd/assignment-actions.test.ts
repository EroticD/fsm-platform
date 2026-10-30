import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkOrderAccess: vi.fn(),
  assignTechnician: vi.fn(),
  moveTechnician: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/access", () => ({
  requireWorkOrderAccess: mocks.requireWorkOrderAccess,
}));
vi.mock("@/server/work-orders", () => ({
  assignTechnician: mocks.assignTechnician,
  moveTechnician: mocks.moveTechnician,
}));

import { assignWorkOrderToTechnicianAction } from "@/app/assignment-actions";

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
  mocks.assignTechnician.mockResolvedValue({ ok: true });
  mocks.moveTechnician.mockResolvedValue({ ok: true });
});

describe("assignWorkOrderToTechnicianAction", () => {
  it("tildeler et kort uten kildemontør og revaliderer alle berørte flater", async () => {
    const result = await assignWorkOrderToTechnicianAction(
      form({ workOrderId: "wo-1", technicianId: "tech-1" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireWorkOrderAccess).toHaveBeenCalledWith(
      "workorders.assign",
      "wo-1",
    );
    expect(mocks.assignTechnician).toHaveBeenCalledWith(user, "wo-1", "tech-1");
    expect(mocks.moveTechnician).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
    for (const path of ["/", "/kalender", "/kalender/dispatch", "/oppdrag"]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("flytter kortet når kildemontøren er en annen enn målet", async () => {
    const result = await assignWorkOrderToTechnicianAction(
      form({
        workOrderId: "wo-1",
        technicianId: "tech-2",
        fromTechnicianId: "tech-1",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.moveTechnician).toHaveBeenCalledWith(
      user,
      "wo-1",
      "tech-1",
      "tech-2",
    );
    expect(mocks.assignTechnician).not.toHaveBeenCalled();
  });

  it("behandler «unassigned» som tom kilde og bruker tildeling", async () => {
    const result = await assignWorkOrderToTechnicianAction(
      form({
        workOrderId: "wo-1",
        technicianId: "tech-1",
        fromTechnicianId: "unassigned",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.assignTechnician).toHaveBeenCalledWith(user, "wo-1", "tech-1");
    expect(mocks.moveTechnician).not.toHaveBeenCalled();
  });

  it("tildeler på nytt når kilden er samme montør", async () => {
    const result = await assignWorkOrderToTechnicianAction(
      form({
        workOrderId: "wo-1",
        technicianId: "tech-1",
        fromTechnicianId: "tech-1",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.assignTechnician).toHaveBeenCalledWith(user, "wo-1", "tech-1");
    expect(mocks.moveTechnician).not.toHaveBeenCalled();
  });

  it("avviser ufullstendig data før tilgang sjekkes", async () => {
    const result = await assignWorkOrderToTechnicianAction(
      form({ workOrderId: "wo-1" }),
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.requireWorkOrderAccess).not.toHaveBeenCalled();
    expect(mocks.assignTechnician).not.toHaveBeenCalled();
    expect(mocks.moveTechnician).not.toHaveBeenCalled();
  });

  it("avviser uten server-side tilgang", async () => {
    mocks.requireWorkOrderAccess.mockResolvedValue(null);

    const result = await assignWorkOrderToTechnicianAction(
      form({ workOrderId: "wo-1", technicianId: "tech-1" }),
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.assignTechnician).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("videresender stabile feilkoder og revaliderer ikke ved avvisning", async () => {
    mocks.moveTechnician.mockResolvedValue({
      ok: false,
      error: "legal-hold",
    });

    const result = await assignWorkOrderToTechnicianAction(
      form({
        workOrderId: "wo-1",
        technicianId: "tech-2",
        fromTechnicianId: "tech-1",
      }),
    );

    expect(result).toEqual({ ok: false, error: "legal-hold" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("oversetter interne tjenestekoder til trygge UI-koder", async () => {
    mocks.assignTechnician.mockResolvedValue({
      ok: false,
      error: "ingen-endring",
    });
    expect(
      await assignWorkOrderToTechnicianAction(
        form({ workOrderId: "wo-1", technicianId: "tech-1" }),
      ),
    ).toEqual({ ok: false, error: "ugyldig-data" });

    mocks.assignTechnician.mockResolvedValue({
      ok: false,
      error: "kunde-last",
    });
    expect(
      await assignWorkOrderToTechnicianAction(
        form({ workOrderId: "wo-1", technicianId: "tech-1" }),
      ),
    ).toEqual({ ok: false, error: "ukjent" });

    mocks.assignTechnician.mockResolvedValue({
      ok: false,
      error: "avdeling",
    });
    expect(
      await assignWorkOrderToTechnicianAction(
        form({ workOrderId: "wo-1", technicianId: "tech-1" }),
      ),
    ).toEqual({ ok: false, error: "ikke-tilgang" });
  });

  it("gir ukjent feil når tjenesten kaster", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.assignTechnician.mockRejectedValue(new Error("db nede"));

    const result = await assignWorkOrderToTechnicianAction(
      form({ workOrderId: "wo-1", technicianId: "tech-1" }),
    );

    expect(result).toEqual({ ok: false, error: "ukjent" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
