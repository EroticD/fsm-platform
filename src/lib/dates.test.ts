import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  addMonthsUtc,
  firstOccurrenceOnOrAfter,
  formatDate,
  formatDateRange,
  formatDateTime,
  inclusiveLastDay,
  latestOccurrenceOnOrBefore,
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

describe("addMonthsUtc", () => {
  it("håndterer måneder med færre dager", () => {
    expect(toDateOnly(addMonthsUtc(new Date("2026-01-31T00:00:00.000Z"), 1))).toBe(
      "2026-02-28",
    );
  });

  it("regner fra opprinnelig dato, ikke fra forrige forekomst", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");
    expect(toDateOnly(addMonthsUtc(start, 2))).toBe("2026-03-31");
  });
});

describe("firstOccurrenceOnOrAfter", () => {
  it("finner første intervallforekomst på eller etter datoen", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");
    const notBefore = new Date("2026-03-01T00:00:00.000Z");
    expect(toDateOnly(firstOccurrenceOnOrAfter(start, 3, notBefore))).toBe("2026-04-30");
  });

  it("returnerer startdatoen når den allerede er innenfor", () => {
    const start = new Date("2026-10-21T00:00:00.000Z");
    expect(
      toDateOnly(firstOccurrenceOnOrAfter(start, 3, new Date("2026-10-21T00:00:00.000Z"))),
    ).toBe("2026-10-21");
  });
});

describe("latestOccurrenceOnOrBefore", () => {
  it("finner siste forfalte forekomst", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");
    const result = latestOccurrenceOnOrBefore(
      start,
      3,
      new Date("2026-10-21T00:00:00.000Z"),
    );
    expect(toDateOnly(result)).toBe("2026-07-31");
  });

  it("bruker siste dag i måneden når startdagen ikke finnes", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");
    const result = latestOccurrenceOnOrBefore(
      start,
      1,
      new Date("2026-04-15T00:00:00.000Z"),
    );
    expect(toDateOnly(result)).toBe("2026-03-31");
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

describe("formatDate", () => {
  it("formaterer dato som ISO 8601", () => {
    expect(formatDate(new Date("2026-10-19T00:00:00.000Z"))).toBe("2026-10-19");
  });

  it("bruker fallback når datoen mangler", () => {
    expect(formatDate(null, "Ingen dato")).toBe("Ingen dato");
  });
});

describe("formatDateTime", () => {
  it("formaterer dato og klokkeslett som ISO 8601 i lokal tid", () => {
    const date = new Date(2026, 9, 19, 14, 5);
    expect(formatDateTime(date)).toBe("2026-10-19T14:05");
  });

  it("returnerer tom streng for manglende dato", () => {
    expect(formatDateTime(null)).toBe("");
  });
});

describe("formatDateRange", () => {
  it("viser én ISO-dato når start og slutt er samme dag", () => {
    const text = formatDateRange("2026-10-19", "2026-10-19");
    expect(text).toBe("2026-10-19");
  });

  it("viser et ISO-intervall på tvers av dager", () => {
    const text = formatDateRange("2026-10-19", "2026-10-22");
    expect(text).toBe("2026-10-19 – 2026-10-22");
  });
});
