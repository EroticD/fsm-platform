import { describe, expect, it } from "vitest";
import {
  BOOKING_HORIZON_DAYS,
  MAX_SLOTS_PER_DAY,
  UNCONFIGURED_AVAILABILITY_POLICY,
  generateDaySlots,
  horizonDates,
  isRangeBookable,
  isWithinBookingHorizon,
  type BlockingRange,
} from "./availability";

const businessHours = Array.from({ length: 5 }, (_, weekday) => ({
  weekday,
  openMinute: 8 * 60,
  closeMinute: 16 * 60,
}));
const availability = Array.from({ length: 5 }, (_, weekday) => ({
  weekday,
  startMinute: 8 * 60,
  endMinute: 16 * 60,
}));

const now = new Date("2026-11-01T12:00:00+01:00");
const monday = "2026-11-09";

function visit(
  startsAt: string,
  endsAt: string,
  extra: Partial<BlockingRange> = {},
): BlockingRange {
  return { startsAt: new Date(startsAt), endsAt: new Date(endsAt), ...extra };
}

describe("generateDaySlots", () => {
  it("genererer halvtimer og stopper etter tre per dag", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
    });

    expect(result.slots).toHaveLength(MAX_SLOTS_PER_DAY);
    expect(result.slots.map((slot) => slot.from)).toEqual([
      "08:00",
      "08:30",
      "09:00",
    ]);
    expect(result.slots.every((slot) => slot.minutes === 30)).toBe(true);
  });

  it("blokkerer fravær og fortsetter etter det", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
      absences: [visit("2026-11-09T09:00:00+01:00", "2026-11-09T10:00:00+01:00")],
    });

    expect(result.slots.map((slot) => slot.from)).toEqual([
      "08:00",
      "08:30",
      "10:00",
    ]);
  });

  it("lar DONE og CANCELLED visiter være uten blokkering", () => {
    for (const status of ["DONE", "CANCELLED"]) {
      const result = generateDaySlots({
        date: monday,
        now,
        businessHours,
        availability,
        visits: [
          visit("2026-11-09T08:00:00+01:00", "2026-11-09T12:00:00+01:00", {
            status,
          }),
        ],
      });
      expect(result.slots[0].from).toBe("08:00");
    }
  });

  it("blokkerer aktive visiter og slipper tiden etter", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
      visits: [
        visit("2026-11-09T08:00:00+01:00", "2026-11-09T12:00:00+01:00", {
          status: "PLANNED",
        }),
      ],
    });

    expect(result.slots.map((slot) => slot.from)).toEqual([
      "12:00",
      "12:30",
      "13:00",
    ]);
  });

  it("en heldagsvisitt stenger hele dagen", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
      visits: [
        visit("2026-11-08T00:00:00+01:00", "2026-11-10T00:00:00+01:00", {
          allDay: true,
          status: "PLANNED",
        }),
      ],
    });
    expect(result.slots).toHaveLength(0);
  });

  it("håndterer en flerdagersvisitt som startet dagen før", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
      visits: [
        visit("2026-11-08T14:00:00+01:00", "2026-11-09T09:00:00+01:00", {
          status: "PLANNED",
        }),
      ],
    });
    expect(result.slots.map((slot) => slot.from)).toEqual([
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("blokkerer aktive reservasjoner, men ikke en som er utenfor listen", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
      holds: [visit("2026-11-09T08:00:00+01:00", "2026-11-09T08:30:00+01:00")],
    });
    expect(result.slots[0].from).toBe("08:30");
  });

  it("bruker avdelingens åpningstider når montøren mangler arbeidstid", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability: [],
    });
    expect(result.availabilityConfigured).toBe(false);
    expect(result.unconfiguredPolicy).toBe(UNCONFIGURED_AVAILABILITY_POLICY);
    expect(result.slots).toHaveLength(3);
  });

  it("respekterer ledetiden på 24 timer", () => {
    const result = generateDaySlots({
      date: monday,
      now: new Date("2026-11-08T23:00:00+01:00"),
      businessHours,
      availability,
    });
    expect(result.slots).toHaveLength(0);
  });

  it("håndterer sommertidsovergangene med riktig UTC-tid", () => {
    const sundayHours = [
      { weekday: 6, openMinute: 8 * 60, closeMinute: 16 * 60 },
    ];
    const sundayAvailability = [
      { weekday: 6, startMinute: 8 * 60, endMinute: 16 * 60 },
    ];

    const spring = generateDaySlots({
      date: "2027-03-28",
      now: new Date("2027-03-01T12:00:00+01:00"),
      businessHours: sundayHours,
      availability: sundayAvailability,
    });
    expect(spring.slots[0].startsAt.toISOString()).toBe(
      "2027-03-28T06:00:00.000Z",
    );

    const autumn = generateDaySlots({
      date: "2027-10-31",
      now: new Date("2027-10-01T12:00:00+02:00"),
      businessHours: sundayHours,
      availability: sundayAvailability,
    });
    expect(autumn.slots[0].startsAt.toISOString()).toBe(
      "2027-10-31T07:00:00.000Z",
    );

    // 02:00–03:00 finnes ikke 28. mars. Første gyldige halvtime er 03:00.
    const skipped = generateDaySlots({
      date: "2027-03-28",
      now: new Date("2027-03-01T12:00:00+01:00"),
      businessHours: [{ weekday: 6, openMinute: 2 * 60, closeMinute: 4 * 60 }],
      availability: [{ weekday: 6, startMinute: 2 * 60, endMinute: 4 * 60 }],
    });
    expect(skipped.slots[0].from).toBe("03:00");
  });

  it("stenger helligdager", () => {
    const result = generateDaySlots({
      date: monday,
      now,
      businessHours,
      availability,
      holidays: [monday],
    });
    expect(result.slots).toHaveLength(0);
  });
});

describe("bestillingshorisonten", () => {
  it("er 60 dager og stopper utenfor vinduet", () => {
    const dates = horizonDates(now);
    expect(dates).toHaveLength(BOOKING_HORIZON_DAYS + 1);
    expect(dates[0]).toBe("2026-11-01");
    expect(dates.at(-1)).toBe("2026-12-31");
    expect(isWithinBookingHorizon("2026-11-01", now)).toBe(true);
    expect(isWithinBookingHorizon("2027-01-01", now)).toBe(false);
  });
});

describe("isRangeBookable", () => {
  it("krever at hele intervallet ligger innenfor arbeidstiden", () => {
    const full = {
      date: monday,
      now,
      businessHours,
      availability,
    };
    expect(
      isRangeBookable({
        ...full,
        startsAt: new Date("2026-11-09T08:00:00+01:00"),
        endsAt: new Date("2026-11-09T12:00:00+01:00"),
      }),
    ).toBe(true);
    expect(
      isRangeBookable({
        ...full,
        startsAt: new Date("2026-11-09T15:00:00+01:00"),
        endsAt: new Date("2026-11-09T17:00:00+01:00"),
      }),
    ).toBe(false);
  });
});
