import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientIpFrom, trustedProxyHops } from "./client-ip";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

const originalTrustProxy = process.env.TRUST_PROXY;
const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;

beforeEach(() => {
  delete process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY_HOPS;
});

afterEach(() => {
  if (originalTrustProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = originalTrustProxy;
  }
  if (originalTrustProxyHops === undefined) {
    delete process.env.TRUST_PROXY_HOPS;
  } else {
    process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
  }
});

describe("clientIpFrom", () => {
  it("ignorerer X-Forwarded-For uten TRUST_PROXY", () => {
    process.env.TRUST_PROXY = "false";
    expect(clientIpFrom(headers({ "x-forwarded-for": "1.2.3.4" }))).toBeUndefined();
  });

  it("bruker siste X-Forwarded-For når proxy er betrodd", () => {
    process.env.TRUST_PROXY = "true";
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })),
    ).toBe("10.0.0.1");
  });

  it("stoler ikke på en venstrestilt verdi klienten kan ha sendt selv", () => {
    process.env.TRUST_PROXY = "true";
    expect(
      clientIpFrom(
        headers({ "x-forwarded-for": "203.0.113.9, 198.51.100.7, 10.0.0.1" }),
      ),
    ).toBe("10.0.0.1");
  });

  it("håndterer mellomrom og tomme oppføringer", () => {
    process.env.TRUST_PROXY = "true";
    expect(
      clientIpFrom(headers({ "x-forwarded-for": " 1.2.3.4 , 10.0.0.1 , " })),
    ).toBe("10.0.0.1");
  });

  it("faller tilbake til X-Real-IP når X-Forwarded-For mangler", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientIpFrom(headers({ "x-real-ip": "10.0.0.2" }))).toBe("10.0.0.2");
  });

  it("avviser tekst og for lange verdier", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientIpFrom(headers({ "x-forwarded-for": "ikke en ip" }))).toBeUndefined();
    expect(clientIpFrom(headers({ "x-real-ip": "a".repeat(101) }))).toBeUndefined();
  });

  it("bruker riktig hopp når to proxyer er betrodd", () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUST_PROXY_HOPS = "2";
    expect(
      clientIpFrom(
        headers({
          // Klienten har sendt «6.6.6.6» selv. Proxy1 og proxy2 legger til
          // henholdsvis klientadressen og sin egen adresse.
          "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1",
        }),
      ),
    ).toBe("203.0.113.9");
  });

  it("lar ikke en spoofet venstreverdi bli rate-limit-nøkkel", () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUST_PROXY_HOPS = "2";
    expect(
      clientIpFrom(
        headers({ "x-forwarded-for": "198.51.100.99, 203.0.113.9, 10.0.0.1" }),
      ),
    ).not.toBe("198.51.100.99");
  });

  it("gir opp når kjeden er kortere enn antallet betrodde hopp", () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUST_PROXY_HOPS = "2";
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9" })),
    ).toBeUndefined();
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.9" }))).toBeUndefined();
  });

  it("avviser ugyldig hoppantall i stedet for å falle tilbake til første verdi", () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUST_PROXY_HOPS = "0";
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    ).toBeUndefined();
    expect(trustedProxyHops()).toBeUndefined();
  });

  it("ignorerer hopp når proxy ikke er betrodd", () => {
    process.env.TRUST_PROXY = "false";
    process.env.TRUST_PROXY_HOPS = "2";
    expect(
      clientIpFrom(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })),
    ).toBeUndefined();
  });
});
