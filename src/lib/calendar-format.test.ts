import { describe, expect, it } from "vitest";
import {
  calendarCompactDate,
  calendarDayHeaderText,
  calendarWeekdayText,
  isoWeekNumber,
} from "@/lib/calendar-format";

describe("isoWeekNumber", () => {
  it("regner ISO-uker på tvers av årsskiftet", () => {
    expect(isoWeekNumber(new Date(2026, 10, 2))).toBe(45);
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1);
  });
});

describe("calendarWeekdayText", () => {
  const date = new Date(2026, 10, 2);

  it("viser bare ukedag på norsk og engelsk", () => {
    expect(calendarWeekdayText(date, "nb")).toBe("man.");
    expect(calendarWeekdayText(date, "en")).toBe("Mon");
  });

  it("krymper til én bokstav når kolonnen er smal", () => {
    expect(calendarWeekdayText(date, "nb", true)).toBe("M");
    expect(calendarWeekdayText(date, "en", true)).toBe("M");
  });

  it("bruker lokalene også for polsk og tysk", () => {
    expect(calendarWeekdayText(date, "pl")).toBe("pon.");
    expect(calendarWeekdayText(date, "de")).toBe("Mo");
  });
});

describe("calendarCompactDate", () => {
  it("viser dag og måned med skråstrek", () => {
    expect(calendarCompactDate(new Date(2026, 9, 26), "nb")).toBe("26/10");
    expect(calendarCompactDate(new Date(2026, 9, 26), "en")).toBe("26/10");
  });

  it("viser bare dagnummer når cellen er smal", () => {
    expect(calendarCompactDate(new Date(2026, 9, 26), "nb", true)).toBe("26");
    expect(calendarCompactDate(new Date(2026, 9, 26), "en", true)).toBe("26");
  });

  it("regner riktig over måneds- og årsskifter", () => {
    expect(calendarCompactDate(new Date(2026, 9, 31), "nb")).toBe("31/10");
    expect(calendarCompactDate(new Date(2026, 10, 1), "nb")).toBe("1/11");
    expect(calendarCompactDate(new Date(2026, 11, 31), "nb")).toBe("31/12");
    expect(calendarCompactDate(new Date(2027, 0, 1), "nb")).toBe("1/1");
    expect(calendarCompactDate(new Date(2026, 11, 31), "nb", true)).toBe("31");
    expect(calendarCompactDate(new Date(2027, 0, 1), "nb", true)).toBe("1");
  });

  it("gir samme kompakte uttrykk i alle kalenderlokalene", () => {
    const date = new Date(2026, 10, 9);
    for (const locale of ["nb", "en", "pl", "de"]) {
      expect(calendarCompactDate(date, locale)).toBe("9/11");
      expect(calendarCompactDate(date, locale, true)).toBe("9");
    }
  });
});

describe("calendarDayHeaderText", () => {
  const date = new Date(2026, 10, 2);

  it("viser ukedag og dato på norsk", () => {
    expect(calendarDayHeaderText(date, "nb")).toContain("man");
    expect(calendarDayHeaderText(date, "nb")).toContain("2.11");
  });

  it("viser lang ukedag og måned i dagsvisningen", () => {
    const text = calendarDayHeaderText(date, "nb", true);
    expect(text).toContain("mandag");
    expect(text).toContain("november");
  });

  it("krymper til ren dato når kolonnen er smal", () => {
    expect(calendarDayHeaderText(date, "nb", false, true)).toBe("2.11.");
    expect(calendarDayHeaderText(date, "nb", true, true)).toBe("2.11.");
  });
});
