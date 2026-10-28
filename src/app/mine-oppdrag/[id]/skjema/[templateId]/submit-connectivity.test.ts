import { describe, expect, it } from "vitest";
import { canSubmitReport } from "./submit-connectivity";

describe("canSubmitReport", () => {
  it("tillater innsending når skjemaet er på nett og enhetskravet er oppfylt", () => {
    expect(canSubmitReport({ online: true })).toBe(true);
    expect(
      canSubmitReport({ online: true, pending: false, missingUnits: false }),
    ).toBe(true);
  });

  it("blokkerer innsending offline", () => {
    expect(canSubmitReport({ online: false })).toBe(false);
  });

  it("blokkerer innsending mens server-handlingen kjører", () => {
    expect(canSubmitReport({ online: true, pending: true })).toBe(false);
  });

  it("blokkerer innsending når malen krever enheter som mangler", () => {
    expect(canSubmitReport({ online: true, missingUnits: true })).toBe(false);
  });

  it("blokkerer innsending når både nett og enheter mangler", () => {
    expect(canSubmitReport({ online: false, missingUnits: true })).toBe(false);
  });
});
