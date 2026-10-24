import { describe, expect, it } from "vitest";
import { WorkStatus } from "@prisma/client";
import { reportWhereFor } from "./report-filters";

describe("reportWhereFor", () => {
  it("beholder deletedAt-filteret for rapporter og oppdrag i alle tidsrom", () => {
    for (const range of ["denne-maneden", "forrige-maned", "alle"] as const) {
      const where = reportWhereFor(range);
      expect(where.AND).toContainEqual({ deletedAt: null });
      expect(where.AND).toContainEqual({
        workOrder: { deletedAt: null },
      });
    }
  });

  it("legger tidsrommet ved siden av deletedAt i stedet for å erstatte det", () => {
    const where = reportWhereFor("denne-maneden");
    const parts = where.AND as Array<Record<string, unknown>>;

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ deletedAt: null });
    expect(parts[1]).toHaveProperty("completedAt");
  });

  it("avgrenser ikke rapportlisten til brukerens avdeling", () => {
    const where = reportWhereFor("alle");
    const workOrder = (where.AND as Array<Record<string, unknown>>).find(
      (part) => "workOrder" in part,
    )?.workOrder as Record<string, unknown>;

    // Ansatte med reports.view skal se rapporter fra alle avdelinger, selv om
    // oppdragslistene deres er avdelingsavgrensede.
    expect(workOrder).not.toHaveProperty("departmentId");
    expect(workOrder.deletedAt).toBeNull();
  });

  it("skjuler kansellerte oppdrag for montører", () => {
    const where = reportWhereFor("alle", true);
    expect(where.AND).toContainEqual({
      workOrder: {
        deletedAt: null,
        status: { not: WorkStatus.CANCELLED },
      },
    });
  });
});
