import { describe, expect, it } from "vitest";
import { resolveDateRange, scheduledOverlapFilters } from "@/lib/date-range";

const defaults = { defaultFrom: "2026-10-28", defaultTo: "2026-11-04" };

describe("resolveDateRange", () => {
  it("bruker standardperioden når filteret mangler", () => {
    const range = resolveDateRange({ params: {}, ...defaults });
    expect(range.fromText).toBe("2026-10-28");
    expect(range.toText).toBe("2026-11-04");
    expect(range.invalid).toBe(false);
  });

  it("behandler tomme verdier som «ingen grense»", () => {
    const range = resolveDateRange({
      params: { from: "", to: "" },
      ...defaults,
    });
    expect(range.from).toBeNull();
    expect(range.to).toBeNull();
    expect(range.invalid).toBe(false);
  });

  it("markerer fra etter til som ugyldig", () => {
    const range = resolveDateRange({
      params: { from: "2026-11-10", to: "2026-11-01" },
      ...defaults,
    });
    expect(range.invalid).toBe(true);
    expect(range.invalidOrder).toBe(true);
  });

  it("markerer ugyldig datoformat", () => {
    const range = resolveDateRange({
      params: { from: "10.11.2026", to: "2026-11-01" },
      ...defaults,
    });
    expect(range.invalid).toBe(true);
    expect(range.invalidOrder).toBe(false);
  });
});

describe("scheduledOverlapFilters", () => {
  it("tar med flerdagsoppdrag som overlapper perioden", () => {
    const from = new Date("2026-10-28T00:00:00.000Z");
    const to = new Date("2026-11-04T00:00:00.000Z");

    expect(scheduledOverlapFilters(from, to)).toEqual([
      { scheduledFor: { lte: to } },
      {
        OR: [
          { scheduledTo: { gte: from } },
          { scheduledTo: null, scheduledFor: { gte: from } },
        ],
      },
    ]);
  });

  it("utelater grenser som ikke er satt", () => {
    expect(scheduledOverlapFilters(null, null)).toEqual([]);
    expect(
      scheduledOverlapFilters(new Date("2026-10-28T00:00:00.000Z"), null),
    ).toHaveLength(1);
  });
});
