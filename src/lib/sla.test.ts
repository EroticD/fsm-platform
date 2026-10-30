import { describe, expect, it } from "vitest";
import {
  slaBreachedAt,
  slaRemainingMinutes,
  slaStateAt,
  type SlaClockLike,
} from "./sla";

function clock(overrides: Partial<SlaClockLike> = {}): SlaClockLike {
  return {
    startedAt: new Date("2026-10-30T08:00:00.000Z"),
    respondBy: new Date("2026-10-30T10:00:00.000Z"),
    resolveBy: new Date("2026-10-30T16:00:00.000Z"),
    respondedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("sla-tilstand", () => {
  it("er i rute når begge fristene har god tid", () => {
    expect(
      slaStateAt(clock(), new Date("2026-10-30T08:30:00.000Z")),
    ).toBe("ON_TRACK");
  });

  it("blir i fare når svarets frist nærmer seg", () => {
    expect(
      slaStateAt(clock(), new Date("2026-10-30T09:50:00.000Z")),
    ).toBe("AT_RISK");
  });

  it("brytes når svaret er for sent", () => {
    const value = clock();
    expect(slaStateAt(value, new Date("2026-10-30T10:01:00.000Z"))).toBe(
      "BREACHED",
    );
    expect(slaBreachedAt(value, new Date("2026-10-30T10:01:00.000Z"))).toEqual(
      value.respondBy,
    );
  });

  it("blir oppfylt når svaret og løsningen er i tide", () => {
    const value = clock({
      respondedAt: new Date("2026-10-30T09:00:00.000Z"),
      resolvedAt: new Date("2026-10-30T15:00:00.000Z"),
    });
    expect(slaStateAt(value, new Date("2026-10-31T00:00:00.000Z"))).toBe("MET");
    expect(
      slaBreachedAt(value, new Date("2026-10-31T00:00:00.000Z")),
    ).toBeNull();
  });

  it("forblir brutt når løsningen kommer etter fristen", () => {
    const value = clock({
      respondedAt: new Date("2026-10-30T09:00:00.000Z"),
      resolvedAt: new Date("2026-10-30T17:00:00.000Z"),
    });
    expect(
      slaStateAt(value, new Date("2026-10-31T00:00:00.000Z")),
    ).toBe("BREACHED");
    expect(
      slaBreachedAt(value, new Date("2026-10-31T00:00:00.000Z")),
    ).toEqual(value.resolveBy);
  });

  it("regner minutter til neste frist", () => {
    expect(
      slaRemainingMinutes(clock(), new Date("2026-10-30T09:00:00.000Z")),
    ).toBe(60);
  });
});
