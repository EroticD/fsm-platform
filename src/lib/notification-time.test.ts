import { describe, expect, it } from "vitest";
import { relativeTimeLabel } from "./notification-time";

const now = new Date("2026-10-28T12:00:00.000Z");

describe("relativeTimeLabel", () => {
  it("viser relative minutter og timer det første døgnet", () => {
    expect(
      relativeTimeLabel("2026-10-28T11:35:00.000Z", "nb", now),
    ).toContain("25");
    expect(
      relativeTimeLabel("2026-10-28T09:00:00.000Z", "nb", now),
    ).toContain("3");
    expect(
      relativeTimeLabel("2026-10-28T11:58:00.000Z", "en", now),
    ).toContain("2");
  });

  it("gir null for eldre varsler, slik at komponenten viser absolutt tid", () => {
    expect(
      relativeTimeLabel("2026-10-27T11:59:00.000Z", "nb", now),
    ).toBeNull();
    expect(relativeTimeLabel("2026-10-20T12:00:00.000Z", "nb", now)).toBeNull();
  });

  it("tåler ugyldige verdier", () => {
    expect(relativeTimeLabel(null, "nb", now)).toBeNull();
    expect(relativeTimeLabel("ikke en dato", "nb", now)).toBeNull();
  });
});
