import { describe, expect, it } from "vitest";
import {
  ongoingWorkMinutes,
  summarizeVisitDays,
  summarizeVisitTimes,
  summarizeWorkOrderTime,
  travelFromMinutes,
  travelMinutes,
  travelToMinutes,
  visitTimeMetrics,
  workMinutes,
} from "@/lib/visit-time";

const visit = {
  enRouteAt: new Date("2026-10-19T06:00:00.000Z"),
  onSiteAt: new Date("2026-10-19T06:30:00.000Z"),
  doneAt: new Date("2026-10-19T09:15:00.000Z"),
  travelFromEndedAt: new Date("2026-10-19T09:45:00.000Z"),
};

describe("visittid", () => {
  it("regner tilkjøring, arbeid og returkjøring i minutter", () => {
    expect(travelToMinutes(visit)).toBe(30);
    expect(travelMinutes(visit)).toBe(30);
    expect(workMinutes(visit)).toBe(165);
    expect(travelFromMinutes(visit)).toBe(30);
    expect(visitTimeMetrics(visit)).toMatchObject({
      travelToMinutes: 30,
      travelMinutes: 30,
      workMinutes: 165,
      travelFromMinutes: 30,
      totalMinutes: 225,
      started: true,
      completed: true,
    });
  });

  it("gir null når tidsstemplene mangler", () => {
    expect(
      travelToMinutes({ enRouteAt: null, onSiteAt: null, doneAt: null }),
    ).toBeNull();
    expect(
      workMinutes({
        enRouteAt: visit.enRouteAt,
        onSiteAt: null,
        doneAt: null,
      }),
    ).toBeNull();
    expect(
      travelFromMinutes({
        enRouteAt: null,
        onSiteAt: null,
        doneAt: visit.doneAt,
        travelFromEndedAt: null,
      }),
    ).toBeNull();
  });

  it("regner pågående arbeidstid fram til nå", () => {
    expect(
      ongoingWorkMinutes(
        { enRouteAt: null, onSiteAt: visit.onSiteAt, doneAt: null },
        new Date("2026-10-19T07:00:00.000Z"),
      ),
    ).toBe(30);
  });

  it("summerer flere økter og per dag med all reisetid", () => {
    const dayTwo = {
      enRouteAt: new Date("2026-10-20T06:00:00.000Z"),
      onSiteAt: new Date("2026-10-20T06:20:00.000Z"),
      doneAt: new Date("2026-10-20T08:20:00.000Z"),
      travelFromEndedAt: new Date("2026-10-20T08:40:00.000Z"),
    };

    expect(summarizeVisitTimes([visit, dayTwo])).toEqual({
      travelToMinutes: 50,
      workMinutes: 285,
      travelFromMinutes: 50,
      totalMinutes: 385,
      travelMinutes: 100,
      sessions: 2,
      completedSessions: 2,
      ongoingSessions: 0,
    });

    const days = summarizeVisitDays([
      { ...visit, startsAt: new Date("2026-10-18T22:00:00.000Z") },
      { ...dayTwo, startsAt: new Date("2026-10-19T22:00:00.000Z") },
    ]);
    expect(days).toEqual([
      {
        date: "2026-10-19",
        travelToMinutes: 30,
        workMinutes: 165,
        travelFromMinutes: 30,
        totalMinutes: 225,
        travelMinutes: 60,
        sessions: 1,
        completedSessions: 1,
        ongoingSessions: 0,
      },
      {
        date: "2026-10-20",
        travelToMinutes: 20,
        workMinutes: 120,
        travelFromMinutes: 20,
        totalMinutes: 160,
        travelMinutes: 40,
        sessions: 1,
        completedSessions: 1,
        ongoingSessions: 0,
      },
    ]);

    expect(
      summarizeWorkOrderTime([
        { ...visit, startsAt: new Date("2026-10-18T22:00:00.000Z") },
        { ...dayTwo, startsAt: new Date("2026-10-19T22:00:00.000Z") },
      ]),
    ).toMatchObject({
      travelToMinutes: 50,
      workMinutes: 285,
      travelFromMinutes: 50,
      totalMinutes: 385,
      travelMinutes: 100,
      sessions: 2,
      days: days,
    });
  });

  it("teller ikke samme tidssegment dobbelt i én visitt", () => {
    const metrics = visitTimeMetrics(visit);
    expect(metrics.totalMinutes).toBe(
      (metrics.travelToMinutes ?? 0) +
        (metrics.workMinutes ?? 0) +
        (metrics.travelFromMinutes ?? 0),
    );
  });
});
