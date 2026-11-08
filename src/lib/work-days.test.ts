import { describe, expect, it } from "vitest";
import { dateOnlyInOslo, osloDayStart } from "@/lib/dates";
import {
  coversOneWorkDay,
  enumerateWorkDays,
  planBackfillSplit,
  planLegacyTimedNormalisation,
  workDayPeriod,
  type LegacyTimedVisit,
} from "@/lib/work-days";

describe("arbeidsdager", () => {
  it("lister alle dager i et inklusivt intervall", () => {
    const days = enumerateWorkDays(
      new Date("2026-10-19T00:00:00.000Z"),
      new Date("2026-10-21T00:00:00.000Z"),
    );

    expect(days.map((day) => day.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ]);
    expect(days.map((day) => day.sequence)).toEqual([0, 1, 2]);
    expect(days[0].startsAt).toEqual(osloDayStart("2026-10-19"));
    expect(days[0].endsAt).toEqual(osloDayStart("2026-10-20"));
  });

  it("gir én dag når sluttdato mangler eller er før start", () => {
    expect(
      enumerateWorkDays(new Date("2026-10-19T00:00:00.000Z"), null).map(
        (day) => day.date,
      ),
    ).toEqual(["2026-10-19"]);
    expect(
      enumerateWorkDays(
        new Date("2026-10-19T00:00:00.000Z"),
        new Date("2026-10-18T00:00:00.000Z"),
      ).map((day) => day.date),
    ).toEqual(["2026-10-19"]);
  });

  it("holder Oslo-midnatt over sommertidsovergangen", () => {
    const period = workDayPeriod("2026-03-29");
    expect(dateOnlyInOslo(period.startsAt)).toBe("2026-03-29");
    expect(dateOnlyInOslo(new Date(period.endsAt.getTime() - 1))).toBe(
      "2026-03-29",
    );
    // Søndag 29. mars 2026 er overgangen til sommertid; dagen er 23 timer.
    expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it("gjenkjenner økter som dekker én arbeidsdag", () => {
    expect(
      coversOneWorkDay(
        osloDayStart("2026-10-19"),
        osloDayStart("2026-10-20"),
      ),
    ).toBe(true);
    expect(
      coversOneWorkDay(
        osloDayStart("2026-10-19"),
        osloDayStart("2026-10-22"),
      ),
    ).toBe(false);
  });
});

describe("backfill av flerdagersvisiter", () => {
  it("deler en flerdagers heldagsvisitt og beholder første dag", () => {
    const plan = planBackfillSplit({
      id: "visit-1",
      startsAt: osloDayStart("2026-10-19"),
      endsAt: osloDayStart("2026-10-22"),
      allDay: true,
      sequence: 0,
    });

    expect(plan?.keep).toMatchObject({
      id: "visit-1",
      startsAt: osloDayStart("2026-10-19"),
      endsAt: osloDayStart("2026-10-20"),
      sequence: 0,
    });
    expect(plan?.create.map((day) => day.date)).toEqual([
      "2026-10-20",
      "2026-10-21",
    ]);
  });

  it("hopper over éndags- og tidsstyrte visiter", () => {
    expect(
      planBackfillSplit({
        id: "visit-2",
        startsAt: osloDayStart("2026-10-19"),
        endsAt: osloDayStart("2026-10-20"),
        allDay: true,
        sequence: 0,
      }),
    ).toBeNull();

    expect(
      planBackfillSplit({
        id: "visit-3",
        startsAt: osloDayStart("2026-10-19"),
        endsAt: osloDayStart("2026-10-22"),
        allDay: false,
        sequence: 0,
      }),
    ).toBeNull();
  });
});

describe("normalisering av eldre tidsstyrte visiter", () => {
  function legacy(
    overrides: Partial<LegacyTimedVisit> = {},
  ): LegacyTimedVisit {
    return {
      id: "timed-1",
      startsAt: new Date("2026-10-19T08:00:00.000Z"),
      endsAt: new Date("2026-10-19T12:00:00.000Z"),
      allDay: false,
      sequence: 0,
      enRouteAt: new Date("2026-10-19T07:30:00.000Z"),
      onSiteAt: new Date("2026-10-19T08:00:00.000Z"),
      doneAt: new Date("2026-10-19T11:30:00.000Z"),
      travelFromEndedAt: null,
      ...overrides,
    };
  }

  it("utvider en entydig enkeltdagsvisitt til hele arbeidsdagen", () => {
    const plan = planLegacyTimedNormalisation(legacy());

    expect(plan).toMatchObject({
      date: "2026-10-19",
      startsAt: osloDayStart("2026-10-19"),
      endsAt: osloDayStart("2026-10-20"),
    });
  });

  it("rapporterer flerdagers tidsstyrte visiter uten å planlegge endring", () => {
    expect(
      planLegacyTimedNormalisation(
        legacy({
          startsAt: new Date("2026-10-19T08:00:00.000Z"),
          endsAt: new Date("2026-10-21T12:00:00.000Z"),
          doneAt: new Date("2026-10-21T11:30:00.000Z"),
        }),
      ),
    ).toEqual({ reason: "multi-day" });
  });

  it("rapporterer tidsstempler som ligger utenfor visittdagen", () => {
    expect(
      planLegacyTimedNormalisation(
        legacy({ doneAt: new Date("2026-10-20T00:30:00.000Z") }),
      ),
    ).toEqual({ reason: "timestamp-outside-day" });
  });

  it("rapporterer ugyldig eller allerede normalisert tidsrom", () => {
    expect(
      planLegacyTimedNormalisation(
        legacy({ endsAt: new Date("2026-10-19T08:00:00.000Z") }),
      ),
    ).toEqual({ reason: "invalid-range" });
    expect(
      planLegacyTimedNormalisation(legacy({ allDay: true })),
    ).toEqual({ reason: "invalid-range" });
  });
});
