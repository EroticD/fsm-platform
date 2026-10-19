import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  formatDateRange,
  inclusiveLastDay,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";

describe("parseDateOnly", () => {
  it("tolker en ren dato som UTC-midnatt", () => {
    const date = parseDateOnly("2026-10-19");
    expect(date?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("avviser ugyldige og tomme verdier", () => {
    expect(parseDateOnly("19.10.2026")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
  });
});

describe("toDateOnly", () => {
  it("formaterer dato og streng i UTC", () => {
    expect(toDateOnly(new Date("2026-10-19T00:00:00.000Z"))).toBe("2026-10-19");
    expect(toDateOnly("2026-10-19T00:00:00.000Z")).toBe("2026-10-19");
  });

  it("returnerer tom streng for manglende eller ugyldig dato", () => {
    expect(toDateOnly(null)).toBe("");
    expect(toDateOnly("ikke en dato")).toBe("");
  });
});

describe("addDaysUtc", () => {
  it("håndterer månedsskifte", () => {
    expect(toDateOnly(addDaysUtc(new Date("2026-10-31T00:00:00.000Z"), 1))).toBe(
      "2026-11-01",
    );
    expect(toDateOnly(addDaysUtc(new Date("2026-03-01T00:00:00.000Z"), -1))).toBe(
      "2026-02-28",
    );
  });
});

describe("inclusiveLastDay", () => {
  it("gjør eksklusiv sluttdato om til siste inkluderte dag", () => {
    expect(inclusiveLastDay("2026-10-22")).toBe("2026-10-21");
    expect(inclusiveLastDay(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-10-31");
  });

  it("returnerer tom streng uten dato", () => {
    expect(inclusiveLastDay(null)).toBe("");
  });
});

describe("formatDateRange", () => {
  it("viser én dato når start og slutt er samme dag", () => {
    const text = formatDateRange("2026-10-19", "2026-10-19");
    expect(text).toContain("19.");
    expect(text).not.toContain("–");
  });

  it("viser et intervall på tvers av dager", () => {
    const text = formatDateRange("2026-10-19", "2026-10-22");
    expect(text).toContain("–");
  });
});
