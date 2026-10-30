import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  isOpenAt,
  nextOpening,
  osloWallTimeToUtc,
  type BusinessCalendar,
} from "./business-hours";
import { dateOnlyInOslo, toDateOnly } from "./dates";

const office: BusinessCalendar = {
  windows: [0, 1, 2, 3, 4].map((weekday) => ({
    weekday,
    openMinute: 8 * 60,
    closeMinute: 16 * 60,
  })),
  holidays: [],
};

function local(iso: string) {
  return new Date(iso);
}

describe("business-hours", () => {
  it("kjenner helg og helligdager", () => {
    const saturday = local("2027-03-27T10:00:00.000Z");
    expect(isOpenAt(saturday, office)).toBe(false);
    expect(toDateOnly(nextOpening(saturday, office))).toBe("2027-03-29");

    const holiday: BusinessCalendar = {
      ...office,
      holidays: ["2027-03-29"],
    };
    const monday = local("2027-03-29T09:00:00.000Z");
    expect(isOpenAt(monday, holiday)).toBe(false);
    expect(toDateOnly(nextOpening(monday, holiday))).toBe("2027-03-30");
  });

  it("flytter fra fredag ettermiddag over helgen til mandag", () => {
    const friday = osloWallTimeToUtc("2027-03-26", 15 * 60 + 30);
    const result = addBusinessMinutes(friday, 60, office);
    expect(dateOnlyInOslo(result)).toBe("2027-03-29");
    expect(result.getTime()).toBe(
      osloWallTimeToUtc("2027-03-29", 8 * 60 + 30).getTime(),
    );
  });

  it("hopper over en helligdag", () => {
    const friday = osloWallTimeToUtc("2027-03-26", 15 * 60 + 30);
    const holiday: BusinessCalendar = {
      ...office,
      holidays: ["2027-03-29"],
    };
    const result = addBusinessMinutes(friday, 60, holiday);
    expect(dateOnlyInOslo(result)).toBe("2027-03-30");
    expect(result.getTime()).toBe(
      osloWallTimeToUtc("2027-03-30", 8 * 60 + 30).getTime(),
    );
  });

  it("håndterer sommertid våren 2027", () => {
    // Overgangen er natt til søndag 28. mars. Fredag 08–16 (8 t) + mandag
    // 08–16 (8 t) skal gi mandag 16:00, som er 14:00 UTC etter overgangen.
    const start = osloWallTimeToUtc("2027-03-26", 8 * 60);
    expect(start.toISOString()).toBe("2027-03-26T07:00:00.000Z");
    const result = addBusinessMinutes(start, 16 * 60, office);
    expect(dateOnlyInOslo(result)).toBe("2027-03-29");
    expect(result.toISOString()).toBe("2027-03-29T14:00:00.000Z");
  });

  it("håndterer sommertid høsten 2027", () => {
    // Overgangen er natt til søndag 31. oktober. Fredag + mandag gir
    // mandag 16:00, som er 15:00 UTC etter at klokken er stilt tilbake.
    const start = osloWallTimeToUtc("2027-10-29", 8 * 60);
    expect(start.toISOString()).toBe("2027-10-29T06:00:00.000Z");
    const result = addBusinessMinutes(start, 16 * 60, office);
    expect(dateOnlyInOslo(result)).toBe("2027-11-01");
    expect(result.toISOString()).toBe("2027-11-01T15:00:00.000Z");
  });

  it("regner åpningstidsminutter mellom to tidspunkter", () => {
    const monday = osloWallTimeToUtc("2027-03-29", 8 * 60);
    const tuesday = osloWallTimeToUtc("2027-03-30", 12 * 60);
    expect(businessMinutesBetween(monday, tuesday, office)).toBe(12 * 60);
  });

  it("starter utenfor åpningstid på neste åpning", () => {
    const saturday = osloWallTimeToUtc("2027-03-27", 10 * 60);
    const result = addBusinessMinutes(saturday, 60, office);
    expect(result.getTime()).toBe(
      osloWallTimeToUtc("2027-03-29", 9 * 60).getTime(),
    );
  });
});
