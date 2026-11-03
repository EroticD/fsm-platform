import { describe, expect, it } from "vitest";
import {
  deferForQuietHours,
  isWithinQuietHours,
} from "./quiet-hours";

// Norsk sommertid (UTC+2) i testdatoene nedenfor.
const at = (iso: string) => new Date(iso);

describe("stille timer for påminnelser", () => {
  it("gjenkjenner et vindu som går over midnatt", () => {
    expect(
      isWithinQuietHours(at("2026-07-01T21:30:00.000Z"), 22, 7, "Europe/Oslo"),
    ).toBe(true);
    expect(
      isWithinQuietHours(at("2026-07-01T04:30:00.000Z"), 22, 7, "Europe/Oslo"),
    ).toBe(true);
    expect(
      isWithinQuietHours(at("2026-07-01T12:00:00.000Z"), 22, 7, "Europe/Oslo"),
    ).toBe(false);
  });

  it("gjenkjenner et vindu innenfor samme dag", () => {
    expect(
      isWithinQuietHours(at("2026-07-01T11:00:00.000Z"), 12, 14, "Europe/Oslo"),
    ).toBe(true); // 13:00 lokal tid
    expect(
      isWithinQuietHours(at("2026-07-01T15:00:00.000Z"), 12, 14, "Europe/Oslo"),
    ).toBe(false);
  });

  it("flytter en påminnelse til slutten av stille periode", () => {
    const deferred = deferForQuietHours(
      at("2026-07-01T21:30:00.000Z"), // 23:30 lokal tid
      22,
      7,
      "Europe/Oslo",
    );
    expect(deferred.toISOString()).toBe("2026-07-02T05:00:00.000Z"); // 07:00 lokal
  });

  it("rører ikke et tidspunkt utenfor vinduet", () => {
    const input = at("2026-07-01T12:00:00.000Z");
    expect(deferForQuietHours(input, 22, 7, "Europe/Oslo")).toBe(input);
    expect(deferForQuietHours(input, null, null, "Europe/Oslo")).toBe(input);
  });

  it("ignorerer et tomt eller like langt vindu", () => {
    const input = at("2026-07-01T21:30:00.000Z");
    expect(isWithinQuietHours(input, 22, 22, "Europe/Oslo")).toBe(false);
  });
});
