import { describe, expect, it } from "vitest";
import { WorkStatus } from "@prisma/client";
import { allowedTransitions, canTransition } from "./work-order-status";

describe("canTransition", () => {
  it("tillater normale overganger", () => {
    expect(canTransition("OPEN", "PLANNED", false)).toBe(true);
    expect(canTransition("PLANNED", "IN_PROGRESS", false)).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED", false)).toBe(true);
    expect(canTransition("WAITING", "PLANNED", false)).toBe(true);
  });

  it("avviser ulovlige overganger", () => {
    expect(canTransition("OPEN", "COMPLETED", false)).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS", false)).toBe(false);
    expect(canTransition("CANCELLED", "PLANNED", false)).toBe(false);
    expect(canTransition("PLANNED", "PLANNED", false)).toBe(false);
  });

  it("lar administrator gjenåpne lukkede oppdrag", () => {
    expect(canTransition("COMPLETED", "IN_PROGRESS", true)).toBe(true);
    expect(canTransition("CANCELLED", "PLANNED", true)).toBe(true);
    expect(canTransition("COMPLETED", "COMPLETED", true)).toBe(false);
  });
});

describe("allowedTransitions", () => {
  it("returnerer de lovlige valgene for vanlige brukere", () => {
    expect(allowedTransitions("OPEN", false)).toEqual(["PLANNED", "CANCELLED"]);
    expect(allowedTransitions("COMPLETED", false)).toEqual([]);
  });

  it("lar administrator velge alle andre statuser fra en lukket tilstand", () => {
    const options = allowedTransitions("COMPLETED", true);
    expect(options).toContain("IN_PROGRESS");
    expect(options).toContain("PLANNED");
    expect(options).not.toContain("COMPLETED");
    expect(options.length).toBe(Object.values(WorkStatus).length - 1);
  });
});
