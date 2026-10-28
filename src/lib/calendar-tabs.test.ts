import { describe, expect, it } from "vitest";
import { calendarTabsFor } from "./calendar-tabs";

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

  it("beholder ressursfanen og rapportlenken", () => {
    const tabs = calendarTabsFor({ canDispatch: true, canReports: true });
    expect(tabs.find((tab) => tab.key === "resources")?.href).toBe("/kalender");
    expect(tabs.find((tab) => tab.key === "reports")?.href).toBe("/rapporter");
    expect(tabs.find((tab) => tab.key === "dispatch")?.href).toBe(
      "/kalender/dispatch",
    );
  });
});
