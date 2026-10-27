import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

describe("clientIpFrom", () => {
  it("ignorerer X-Forwarded-For uten TRUST_PROXY", () => {
    const old = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "false";
    expect(clientIpFrom(headers({ "x-forwarded-for": "1.2.3.4" }))).toBeUndefined();
    process.env.TRUST_PROXY = old;
  });

  it("bruker første X-Forwarded-For når proxy er betrodd", () => {
    const old = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })),
    ).toBe("1.2.3.4");
    process.env.TRUST_PROXY = old;
  });

  it("avviser tekst og for lange verdier", () => {
    const old = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    expect(clientIpFrom(headers({ "x-forwarded-for": "ikke en ip" }))).toBeUndefined();
    expect(clientIpFrom(headers({ "x-real-ip": "a".repeat(101) }))).toBeUndefined();
    process.env.TRUST_PROXY = old;
  });
});
