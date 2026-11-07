import { describe, expect, it } from "vitest";
import {
  ACTIVE_MODULE_KEYS,
  MODULE_KEYS,
  MODULE_PRESETS,
  dependentsOf,
  disabledModulesFor,
  enabledDependents,
  enabledModulesFor,
  isModuleKey,
  missingDependencies,
  moduleForPath,
  moduleIsOn,
  moduleKeysForPreset,
  modulePresetFromEnv,
  modulesForSettingsTab,
  validateModuleCatalog,
} from "./modules";

describe("modulkatalogen", () => {
  it("er gyldig: unike nøkler, kjente avhengigheter og ingen sirkler", () => {
    expect(validateModuleCatalog()).toEqual([]);
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length);
  });

  it("har kjernen og alle avtalte modulnøkler", () => {
    for (const key of [
      "core",
      "calendar",
      "reports",
      "equipment",
      "contracts",
      "portal",
      "booking",
      "documents",
      "sms",
      "map",
      "tracking",
      "reviews",
      "transfer",
      "auditExport",
      "api",
      "sso",
      "offline",
      "quotes",
      "invoicing",
      "inventory",
      "fieldExpenses",
      "bi",
    ]) {
      expect(isModuleKey(key)).toBe(true);
    }
  });

  it("håndhever de dokumenterte avhengighetene", () => {
    expect(dependentsOf("portal")).toContain("booking");
    expect(dependentsOf("calendar")).toContain("booking");
    expect(dependentsOf("equipment")).toContain("transfer");
    expect(dependentsOf("documents")).toContain("transfer");
    expect(missingDependencies("booking", { portal: true })).toEqual([
      "calendar",
    ]);
    expect(
      enabledDependents("calendar", { booking: true, core: true }),
    ).toEqual(["booking"]);
  });

  it("har core-only og full som presets", () => {
    expect([...moduleKeysForPreset("core")]).toEqual(["core"]);
    expect(moduleKeysForPreset("full").has("calendar")).toBe(true);
    expect(moduleKeysForPreset("full").has("quotes")).toBe(true);
    expect(MODULE_PRESETS.full).toEqual(ACTIVE_MODULE_KEYS);
  });

  it("leser MODULE_PRESET med full som bakoverkompatibel standard", () => {
    expect(modulePresetFromEnv({} as NodeJS.ProcessEnv)).toBe("full");
    expect(modulePresetFromEnv({ MODULE_PRESET: "core" } as unknown as NodeJS.ProcessEnv)).toBe(
      "core",
    );
    expect(
      modulePresetFromEnv({ MODULE_PRESET: "ukjent" } as unknown as NodeJS.ProcessEnv),
    ).toBe("full");
  });

  it("kjernen er alltid på og planlagte moduler er av som standard", () => {
    expect(moduleIsOn({}, "core")).toBe(true);
    expect(moduleIsOn({}, "calendar")).toBe(false);
    expect(disabledModulesFor({ core: true })).toContain("calendar");
    expect(enabledModulesFor({ core: true })).toEqual(["core"]);
    expect(enabledModulesFor({ core: true, calendar: true })).toEqual([
      "core",
      "calendar",
    ]);
  });

  it("mapper stier til riktig modul", () => {
    expect(moduleForPath("/kalender")).toBe("calendar");
    expect(moduleForPath("/kalender/dispatch")).toBe("calendar");
    expect(moduleForPath("/enheter/abc")).toBe("equipment");
    expect(moduleForPath("/dokumenter")).toBe("documents");
    expect(moduleForPath("/kundeportal/bestillinger")).toBe("portal");
    expect(moduleForPath("/api/v1/contracts")).toBe("contracts");
    expect(moduleForPath("/api/v1/equipment/abc")).toBe("equipment");
    expect(moduleForPath("/api/v1/work-orders")).toBe("api");
    expect(moduleForPath("/oppdrag/abc")).toBeNull();
  });

  it("kobler innstillingsfaner til moduler", () => {
    expect(modulesForSettingsTab("kart")).toEqual(["map"]);
    expect(modulesForSettingsTab("maler")).toEqual(["reports"]);
    expect(modulesForSettingsTab("tags")).toEqual(["reports", "documents"]);
    expect(modulesForSettingsTab("sla")).toEqual(["contracts"]);
    expect(modulesForSettingsTab("moduler")).toEqual([]);
  });
});
