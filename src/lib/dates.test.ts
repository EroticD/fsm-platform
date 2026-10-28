import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  addMonthsUtc,
  firstOccurrenceOnOrAfter,
  formatDate,
  formatDateLocalized,
  formatDateRange,
  formatDateRangeLocalized,
  formatDateTime,
  formatDateTimeLocalized,
  inclusiveLastDay,
  latestOccurrenceOnOrBefore,
  osloDayEnd,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";

describe("todayInOslo", () => {
  it("bruker Oslo-dato rundt midnatt", () => {
    expect(todayInOslo(new Date("2026-01-15T23:30:00.000Z"))).toBe("2026-01-16");
    expect(todayInOslo(new Date("2026-07-01T21:30:00.000Z"))).toBe("2026-07-01");
    expect(todayInOslo(new Date("2026-07-01T22:30:00.000Z"))).toBe("2026-07-02");
  });
});

describe("osloDayStart / osloDayEnd", () => {
  it("regner vintertid (UTC+1)", () => {
    expect(osloDayStart("2026-01-01").toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("regner sommertid (UTC+2)", () => {
    expect(osloDayStart("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("håndterer overgangen til sommertid", () => {
    expect(osloDayStart("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(osloDayEnd("2026-03-29").toISOString()).toBe("2026-03-29T21:59:59.999Z");
  });

  it("håndterer overgangen til vintertid (25-timersdag)", () => {
    const start = osloDayStart("2026-10-25");
    const end = osloDayEnd("2026-10-25");
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-25T22:59:59.999Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000 - 1);
  });
});

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
    const date = new Date("2026-10-19T14:05:00");
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

describe("lokalisert visning", () => {
  it("formaterer rene datoer på norsk uten å flytte dagen", () => {
    const text = formatDateLocalized("2026-10-19", "nb");
    expect(text).toContain("19");
    expect(text.toLowerCase()).toContain("okt");
    expect(text).toContain("2026");
  });

  it("formaterer samme dato på engelsk", () => {
    const text = formatDateLocalized("2026-10-19", "en");
    expect(text).toContain("19");
    expect(text.toLowerCase()).toContain("oct");
    expect(text).toContain("2026");
  });

  it("behandler UTC-midnatt som ren dato, ikke som tidspunkt", () => {
    const date = new Date("2026-10-19T00:00:00.000Z");
    expect(formatDateLocalized(date, "nb")).toBe(
      formatDateLocalized("2026-10-19", "nb"),
    );
  });

  it("viser klokkeslett for tidsstempler", () => {
    const text = formatDateTimeLocalized("2026-10-19T12:05:00.000Z", "nb");
    expect(text).toContain("14:05");
  });

  it("viser én dato når perioden er samme dag", () => {
    expect(
      formatDateRangeLocalized("2026-10-19", "2026-10-19", "nb"),
    ).toBe(formatDateLocalized("2026-10-19", "nb"));
  });

  it("viser begge datoene i en flerdagersperiode", () => {
    const text = formatDateRangeLocalized("2026-10-19", "2026-10-22", "nb");
    expect(text).toContain("19");
    expect(text).toContain("22");
    expect(text).toContain("–");
  });

  it("bruker fallback for tomme verdier", () => {
    expect(formatDateLocalized(null, "nb", undefined, "Ingen dato")).toBe(
      "Ingen dato",
    );
    expect(formatDateRangeLocalized(null, null, "nb", "Ingen dato")).toBe(
      "Ingen dato",
    );
  });
});
