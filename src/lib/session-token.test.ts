import { describe, expect, it } from "vitest";
import { isSecureUrl } from "./session-token";

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
