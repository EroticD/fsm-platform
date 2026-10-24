import { describe, expect, it } from "vitest";
import { buildTotpUri, createTotpSecret, generateTotp, verifyTotp } from "./two-factor";

describe("two-factor", () => {
  it("genererer en hemmelighet", () => {
    const secret = createTotpSecret();
    expect(secret.length).toBeGreaterThan(10);
    expect(createTotpSecret()).not.toBe(secret);
  });

  it("verifiserer en gyldig kode", () => {
    const secret = createTotpSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("avviser feil kode", () => {
    const secret = createTotpSecret();
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(verifyTotp(secret, "abc")).toBe(false);
    expect(verifyTotp(secret, "")).toBe(false);
  });

  it("bygger otpauth-URI", () => {
    const secret = createTotpSecret();
    const uri = buildTotpUri(secret, "test@example.com", "FSM");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(secret);
    expect(uri).toContain("issuer=FSM");
  });
});
