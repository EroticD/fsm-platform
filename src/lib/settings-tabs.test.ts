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
  canSla: false,
  canSms: false,
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
  canSla: true,
  canSms: true,
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

  it("viser SLA-fanen bare med sla.manage", () => {
    expect(isSettingsTabAllowed("sla", admin)).toBe(true);
    expect(isSettingsTabAllowed("sla", noPermissions)).toBe(false);
    expect(
      chooseSettingsTab("sla", { ...noPermissions, canSla: true }),
    ).toBe("sla");
  });

  it("viser SMS-fanen bare med settings.manage", () => {
    expect(isSettingsTabAllowed("sms", admin)).toBe(true);
    expect(isSettingsTabAllowed("sms", noPermissions)).toBe(false);
    expect(
      chooseSettingsTab("sms", { ...noPermissions, canSms: true }),
    ).toBe("sms");
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
