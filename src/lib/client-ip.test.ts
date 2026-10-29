import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip";

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

const originalTrustProxy = process.env.TRUST_PROXY;

beforeEach(() => {
  delete process.env.TRUST_PROXY;
});

afterEach(() => {
  if (originalTrustProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = originalTrustProxy;
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
});
