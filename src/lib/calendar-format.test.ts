import { describe, expect, it } from "vitest";
import { calendarDayHeaderText, isoWeekNumber } from "@/lib/calendar-format";

describe("isoWeekNumber", () => {
  it("regner ISO-uker på tvers av årsskiftet", () => {
    expect(isoWeekNumber(new Date(2026, 10, 2))).toBe(45);
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1);
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
