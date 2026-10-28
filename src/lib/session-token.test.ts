import { describe, expect, it } from "vitest";
import { isSecureUrl, PENDING_2FA_MAX_AGE } from "./session-token";

describe("PENDING_2FA_MAX_AGE", () => {
  it("gir brukeren 15 minutter på 2FA-steget", () => {
    expect(PENDING_2FA_MAX_AGE).toBe(15 * 60);
  });
});

describe("isSecureUrl", () => {
  it("gjenkjenner https og http", () => {
    expect(isSecureUrl("https://fsm.example")).toBe(true);
    expect(isSecureUrl("http://fsm.example")).toBe(false);
  });

  it("returnerer null for manglende eller ugyldig URL", () => {
    expect(isSecureUrl(undefined)).toBeNull();
    expect(isSecureUrl("ikke-en-url")).toBeNull();
  });
});
