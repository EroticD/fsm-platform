import { describe, expect, it } from "vitest";
import { parseRouteSequence } from "./manual-route";

describe("parseRouteSequence", () => {
  it("tolker positive heltall og tomme verdier", () => {
    expect(parseRouteSequence("1")).toBe(1);
    expect(parseRouteSequence("4")).toBe(4);
    expect(parseRouteSequence("0")).toBeNull();
    expect(parseRouteSequence("")).toBeNull();
    expect(parseRouteSequence(null)).toBeNull();
  });

  it("avviser ugyldige og negative verdier som automatisk", () => {
    expect(parseRouteSequence("-1")).toBeNull();
    expect(parseRouteSequence("abc")).toBeNull();
    expect(parseRouteSequence(undefined)).toBeNull();
  });

  it("begrenser til 9999", () => {
    expect(parseRouteSequence("10000")).toBe(9999);
  });
});
