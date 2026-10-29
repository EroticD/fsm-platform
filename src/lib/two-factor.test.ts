import { describe, expect, it, vi } from "vitest";
import {
  acceptTotpTimeStep,
  buildTotpUri,
  createTotpSecret,
  generateTotp,
  verifyTotp,
  verifyTotpStep,
} from "./two-factor";

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

  it("avviser gjenbruk av samme tidssteg", () => {
    const secret = createTotpSecret();
    const code = generateTotp(secret);
    const first = verifyTotpStep(secret, code);

    expect(first.valid).toBe(true);
    if (!first.valid) return;

    expect(verifyTotpStep(secret, code, first.timeStep).valid).toBe(false);
    expect(verifyTotp(secret, code, first.timeStep)).toBe(false);
  });

  it("lagrer bare et nyere tidssteg atomisk", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = { user: { updateMany } };

    await expect(acceptTotpTimeStep(tx as never, "u1", 120)).resolves.toBe(true);
    await expect(acceptTotpTimeStep(tx as never, "u1", 120)).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "u1",
        OR: [
          { lastTotpTimeStep: null },
          { lastTotpTimeStep: { lt: 120 } },
        ],
      },
      data: { lastTotpTimeStep: 120 },
    });
  });

  it("avviser ugyldige tidssteg", async () => {
    const updateMany = vi.fn();
    const tx = { user: { updateMany } };

    await expect(acceptTotpTimeStep(tx as never, "u1", -1)).resolves.toBe(false);
    await expect(
      acceptTotpTimeStep(tx as never, "u1", 1.5),
    ).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
