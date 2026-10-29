import { describe, expect, it } from "vitest";
import {
  calendarTabsFor,
  calendarViewHref,
  normalizeCalendarDate,
} from "./calendar-tabs";

const keys = (canDispatch: boolean, canReports: boolean) =>
  calendarTabsFor({ canDispatch, canReports }).map((tab) => tab.key);

describe("kalenderfaner", () => {
  it("viser dispatch og rapporter bare når brukeren har rettighetene", () => {
    expect(keys(false, false)).toEqual([
      "resources",
      "month",
      "week",
      "biweekly",
    ]);
    expect(keys(true, false)).toContain("dispatch");
    expect(keys(true, false)).not.toContain("reports");
    expect(keys(false, true)).not.toContain("dispatch");
    expect(keys(false, true)).toContain("reports");
    expect(keys(true, true)).toEqual([
      "resources",
      "month",
      "week",
      "biweekly",
      "dispatch",
      "reports",
    ]);
  });

  it("bruker én kalenderrute med vis-parameter", () => {
    const tabs = calendarTabsFor({ canDispatch: true, canReports: true });
    expect(tabs.find((tab) => tab.key === "resources")?.href).toBe("/kalender");
    expect(tabs.find((tab) => tab.key === "month")?.href).toBe(
      "/kalender?vis=maned",
    );
    expect(tabs.find((tab) => tab.key === "week")?.href).toBe(
      "/kalender?vis=uke",
    );
    expect(tabs.find((tab) => tab.key === "biweekly")?.href).toBe(
      "/kalender?vis=2uker",
    );
    expect(tabs.find((tab) => tab.key === "reports")?.href).toBe("/rapporter");
    expect(tabs.find((tab) => tab.key === "dispatch")?.href).toBe(
      "/kalender/dispatch",
    );
  });

  it("tar med dato og filtre når brukeren bytter periodevisning", () => {
    const tabs = calendarTabsFor({
      canDispatch: true,
      canReports: true,
      query: {
        date: "2026-10-19",
        technician: "user-1",
        status: "PLANNED",
        unassigned: false,
      },
    });

    expect(tabs.find((tab) => tab.key === "month")?.href).toBe(
      "/kalender?vis=maned&dato=2026-10-19&tekniker=user-1&status=PLANNED",
    );
    expect(tabs.find((tab) => tab.key === "week")?.href).toBe(
      "/kalender?vis=uke&dato=2026-10-19&tekniker=user-1&status=PLANNED",
    );
    expect(tabs.find((tab) => tab.key === "biweekly")?.href).toBe(
      "/kalender?vis=2uker&dato=2026-10-19&tekniker=user-1&status=PLANNED",
    );
    // Ressursoversikten og de separate sidene skal ikke arve perioden.
    expect(tabs.find((tab) => tab.key === "resources")?.href).toBe("/kalender");
    expect(tabs.find((tab) => tab.key === "dispatch")?.href).toBe(
      "/kalender/dispatch",
    );
    expect(tabs.find((tab) => tab.key === "reports")?.href).toBe("/rapporter");
  });

  it("tar med ufordelt-filteret i URL-en", () => {
    const tabs = calendarTabsFor({
      canDispatch: true,
      canReports: false,
      query: { date: "2026-10-19", unassigned: true },
    });

    expect(tabs.find((tab) => tab.key === "month")?.href).toBe(
      "/kalender?vis=maned&dato=2026-10-19&ufordelt=1",
    );
  });
});

describe("calendarViewHref", () => {
  it("utelater ugyldige datoer", () => {
    expect(
      calendarViewHref("maned", { date: "2026-02-31", status: "PLANNED" }),
    ).toBe("/kalender?vis=maned&status=PLANNED");
    expect(calendarViewHref(undefined, { date: "ikke-en-dato" })).toBe(
      "/kalender",
    );
  });
});

describe("normalizeCalendarDate", () => {
  it("beholder gyldige datoer og faller tilbake til dagens dato", () => {
    expect(normalizeCalendarDate("2026-10-19", "2026-10-29")).toBe(
      "2026-10-19",
    );
    expect(normalizeCalendarDate("2026-13-01", "2026-10-29")).toBe(
      "2026-10-29",
    );
    expect(normalizeCalendarDate(null, "2026-10-29")).toBe("2026-10-29");
  });
});
