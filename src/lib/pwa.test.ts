import { describe, expect, it } from "vitest";
import { isStandaloneDisplayMode } from "./pwa";

describe("isStandaloneDisplayMode", () => {
  it("accepts display-mode standalone", () => {
    expect(isStandaloneDisplayMode({ displayModeStandalone: true })).toBe(true);
  });

  it("accepts the iOS navigator flag", () => {
    expect(isStandaloneDisplayMode({ navigatorStandalone: true })).toBe(true);
  });

  it("is false in a normal browser tab", () => {
    expect(
      isStandaloneDisplayMode({
        displayModeStandalone: false,
        navigatorStandalone: false,
      }),
    ).toBe(false);
    expect(isStandaloneDisplayMode({})).toBe(false);
  });
});
