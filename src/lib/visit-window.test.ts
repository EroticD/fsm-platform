import { describe, expect, it } from "vitest";
import { defaultVisitWindow } from "./visit-window";

describe("defaultVisitWindow", () => {
  it("lager en firetimersblokk kl. 08–12 i Oslo", () => {
    const window = defaultVisitWindow(new Date("2026-10-24T00:00:00.000Z"));
    expect(window.startsAt.toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-10-24T10:00:00.000Z");
  });

  it("holder veggklokketiden over sommertid", () => {
    const window = defaultVisitWindow(new Date("2026-12-01T00:00:00.000Z"));
    expect(window.startsAt.toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });
});
