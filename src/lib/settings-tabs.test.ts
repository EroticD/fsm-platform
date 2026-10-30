import { describe, expect, it } from "vitest";
import {
  chooseSettingsTab,
  isSettingsTabAllowed,
  type SettingsTabPermissions,
} from "./settings-tabs";

const noPermissions: SettingsTabPermissions = {
  canBranding: false,
  canMap: false,
  canUsers: false,
  canTemplates: false,
  canDocuments: false,
  canAudit: false,
  canStats: false,
  isAdmin: false,
};

const admin: SettingsTabPermissions = {
  ...noPermissions,
  canBranding: true,
  canMap: true,
  canUsers: true,
  canTemplates: true,
  canDocuments: true,
  canAudit: true,
  canStats: true,
  isAdmin: true,
};

describe("chooseSettingsTab", () => {
  it("beholder en tillatt fane fra lenken", () => {
    expect(chooseSettingsTab("statistikk", admin)).toBe("statistikk");
  });

  it("faller tilbake til første tillatte fane for en ugyldig fane", () => {
    expect(chooseSettingsTab("finnes-ikke", admin)).toBe("branding");
  });

  it("gir aldri en tom admin-fane til en bruker uten tilgang", () => {
    const office: SettingsTabPermissions = {
      ...noPermissions,
      canUsers: true,
      canTemplates: true,
    };

    expect(chooseSettingsTab("roller", office)).toBe("ansatte");
    expect(chooseSettingsTab("avdelinger", office)).toBe("ansatte");
    expect(chooseSettingsTab("api", office)).toBe("ansatte");
  });

  it("lar bare administrator åpne API-fanen", () => {
    expect(chooseSettingsTab("api", admin)).toBe("api");
    expect(isSettingsTabAllowed("api", admin)).toBe(true);
    expect(isSettingsTabAllowed("api", noPermissions)).toBe(false);
  });

  it("lar alle innloggede åpne sikkerhetsfanen", () => {
    expect(chooseSettingsTab("sikkerhet", noPermissions)).toBe("sikkerhet");
    expect(isSettingsTabAllowed("sikkerhet", noPermissions)).toBe(true);
  });

  it("velger sikkerhet når ingen andre faner er tillatt", () => {
    expect(chooseSettingsTab(undefined, noPermissions)).toBe("sikkerhet");
  });
});
