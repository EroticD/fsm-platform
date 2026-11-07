import { describe, expect, it } from "vitest";
import {
  deriveFieldStatus,
  isAbsentAllDay,
  sortFieldStatusRows,
  type FieldStatusRow,
  type FieldVisitInput,
} from "./dashboard-field-status";

const dayStart = new Date("2026-11-07T00:00:00.000Z");
const dayEnd = new Date("2026-11-08T00:00:00.000Z");
const now = new Date("2026-11-07T12:00:00.000Z");

function visit(
  id: string,
  status: FieldVisitInput["status"],
  overrides: Partial<FieldVisitInput> = {},
): FieldVisitInput {
  return {
    id,
    workOrderId: `wo-${id}`,
    title: `Oppdrag ${id}`,
    customerName: "Testkunde",
    status,
    startsAt: new Date("2026-11-07T09:00:00.000Z"),
    endsAt: new Date("2026-11-07T11:00:00.000Z"),
    allDay: false,
    ...overrides,
  };
}

function derive(
  visits: FieldVisitInput[],
  absences: Array<{ startsAt: Date; endsAt: Date }> = [],
) {
  return deriveFieldStatus({
    userId: "tech-1",
    name: "Ola",
    visits,
    absences,
    dayStart,
    dayEnd,
    now,
  });
}

describe("feltstatus – presedens", () => {
  it("velger ON_SITE foran EN_ROUTE og tildelte visiter", () => {
    const active = visit("aktiv", "ON_SITE", {
      onSiteAt: new Date("2026-11-07T11:55:00.000Z"),
    });
    const result = derive([
      visit("senere", "ASSIGNED", {
        startsAt: new Date("2026-11-07T14:00:00.000Z"),
      }),
      visit("paa-vei", "EN_ROUTE"),
      active,
    ]);

    expect(result.status).toBe("ON_SITE");
    expect(result.visit?.id).toBe("aktiv");
  });

  it("velger EN_ROUTE når ingen er på stedet", () => {
    const result = derive([
      visit("tildelt", "ASSIGNED"),
      visit("paa-vei", "EN_ROUTE", {
        enRouteAt: new Date("2026-11-07T11:30:00.000Z"),
      }),
    ]);

    expect(result.status).toBe("EN_ROUTE");
    expect(result.visit?.id).toBe("paa-vei");
  });

  it("viser nærmeste start når flere visiter bare er tildelt", () => {
    const result = derive([
      visit("langt-fram", "ASSIGNED", {
        startsAt: new Date("2026-11-07T16:00:00.000Z"),
      }),
      visit("naer", "PLANNED", {
        startsAt: new Date("2026-11-07T12:15:00.000Z"),
      }),
      visit("tidligere", "ASSIGNED", {
        startsAt: new Date("2026-11-07T08:00:00.000Z"),
      }),
    ]);

    expect(result.status).toBe("ASSIGNED");
    expect(result.visit?.id).toBe("naer");
  });

  it("viser DONE når alle dagens visiter er ferdige", () => {
    const result = derive([
      visit("ferdig", "DONE", {
        doneAt: new Date("2026-11-07T10:30:00.000Z"),
      }),
    ]);

    expect(result.status).toBe("DONE");
    expect(result.visit?.id).toBe("ferdig");
  });

  it("viser AVAILABLE når montøren ikke har visiter", () => {
    expect(derive([]).status).toBe("AVAILABLE");
  });

  it("ignorerer kansellerte visiter", () => {
    const result = derive([
      visit("kansellert", "CANCELLED"),
      visit("planlagt", "PLANNED", {
        startsAt: new Date("2026-11-07T13:00:00.000Z"),
      }),
    ]);

    expect(result.status).toBe("ASSIGNED");
    expect(result.visit?.id).toBe("planlagt");
  });
});

describe("feltstatus – fravær", () => {
  it("gir ABSENT når fraværet dekker hele dagen og ingen visitt er aktiv", () => {
    const result = derive([], [{ startsAt: dayStart, endsAt: dayEnd }]);
    expect(result.status).toBe("ABSENT");
  });

  it("lar en aktiv visitt vinne over heldagsfravær", () => {
    const result = derive(
      [visit("paa-stedet", "ON_SITE")],
      [{ startsAt: dayStart, endsAt: dayEnd }],
    );
    expect(result.status).toBe("ON_SITE");
  });

  it("gir ABSENT foran tildelt visitt når fraværet er heldags", () => {
    const result = derive(
      [visit("tildelt", "ASSIGNED")],
      [{ startsAt: dayStart, endsAt: dayEnd }],
    );
    expect(result.status).toBe("ABSENT");
  });

  it("godtar ikke delvis fravær som heldag", () => {
    const result = derive(
      [],
      [
        {
          startsAt: new Date("2026-11-07T09:00:00.000Z"),
          endsAt: new Date("2026-11-07T12:00:00.000Z"),
        },
      ],
    );
    expect(result.status).toBe("AVAILABLE");
    expect(
      isAbsentAllDay(
        [
          {
            startsAt: new Date("2026-11-07T09:00:00.000Z"),
            endsAt: new Date("2026-11-07T12:00:00.000Z"),
          },
        ],
        dayStart,
        dayEnd,
      ),
    ).toBe(false);
  });
});

describe("feltstatus – posisjon", () => {
  it("returnerer ingen posisjon når det ikke finnes ping", () => {
    const result = derive([visit("paa-vei", "EN_ROUTE")]);
    expect(result.lastPositionAt).toBeNull();
  });

  it("returnerer tidspunktet for siste delte posisjon", () => {
    const ping = new Date("2026-11-07T11:58:00.000Z");
    const result = derive([
      visit("paa-vei", "EN_ROUTE", { lastPingAt: ping }),
    ]);
    expect(result.lastPositionAt).toEqual(ping);
  });

  it("bruker nyeste ping når flere visiter har delt posisjon", () => {
    const older = new Date("2026-11-07T10:00:00.000Z");
    const newer = new Date("2026-11-07T11:45:00.000Z");
    const result = derive([
      visit("eldre", "DONE", { lastPingAt: older }),
      visit("nyere", "EN_ROUTE", { lastPingAt: newer }),
    ]);
    expect(result.lastPositionAt).toEqual(newer);
  });
});

describe("feltstatus – sortering", () => {
  it("sorterer aktive først og deretter på navn", () => {
    const rows: FieldStatusRow[] = [
      { userId: "1", name: "B", status: "AVAILABLE", visit: null, lastPositionAt: null },
      { userId: "2", name: "A", status: "EN_ROUTE", visit: null, lastPositionAt: null },
      { userId: "3", name: "C", status: "ON_SITE", visit: null, lastPositionAt: null },
    ];

    expect(sortFieldStatusRows(rows).map((row) => row.userId)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });
});
