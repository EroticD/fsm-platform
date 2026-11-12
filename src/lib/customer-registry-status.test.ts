import { describe, expect, it } from "vitest";
import {
  registryStatusFrom,
  registryStatusIsRisk,
  type RegistryStatus,
} from "./customer-registry-status";

describe("registryStatusFrom", () => {
  it("gir AKTIV for en enhet uten merknader", () => {
    expect(
      registryStatusFrom({ bankrupt: false, underLiquidation: false }),
    ).toBe("ACTIVE");
  });

  it("gir KONKURS når enheten er konkurs", () => {
    expect(
      registryStatusFrom({ bankrupt: true, underLiquidation: false }),
    ).toBe("BANKRUPT");
  });

  it("gir AVVIKLING når enheten er under avvikling", () => {
    expect(
      registryStatusFrom({ bankrupt: false, underLiquidation: true }),
    ).toBe("UNDER_LIQUIDATION");
  });

  it("lar konkurs gå foran avvikling", () => {
    expect(registryStatusFrom({ bankrupt: true, underLiquidation: true })).toBe(
      "BANKRUPT",
    );
  });
});

describe("registryStatusIsRisk", () => {
  it("flaggar konkurs og avvikling", () => {
    expect(registryStatusIsRisk("BANKRUPT")).toBe(true);
    expect(registryStatusIsRisk("UNDER_LIQUIDATION")).toBe(true);
  });

  it("flaggar ikke aktive, ukjente eller manglende statuser", () => {
    const safe: Array<string | null | undefined> = [
      "ACTIVE",
      "NOT_FOUND",
      "UNKNOWN",
      null,
      undefined,
    ];
    for (const status of safe) {
      expect(registryStatusIsRisk(status)).toBe(false);
    }
  });

  it("tåler ukjente verdier fra databasen uten å kaste", () => {
    expect(registryStatusIsRisk("SOMETHING_ELSE")).toBe(false);
  });

  it("dekker alle RegistryStatus-verdier", () => {
    const risky: RegistryStatus[] = ["BANKRUPT", "UNDER_LIQUIDATION"];
    const safe: RegistryStatus[] = ["ACTIVE", "NOT_FOUND", "UNKNOWN"];
    expect(risky.every(registryStatusIsRisk)).toBe(true);
    expect(safe.some(registryStatusIsRisk)).toBe(false);
  });
});
