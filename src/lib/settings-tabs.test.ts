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
  canWorkforce: false,
  canTemplates: false,
  canDocuments: false,
  canEquipment: false,
  canAudit: false,
  canStats: false,
  canSla: false,
  canSms: false,
  canDispatch: false,
  isAdmin: false,
  canCustomerTransfer: false,
};

const admin: SettingsTabPermissions = {
  ...noPermissions,
  canBranding: true,
  canMap: true,
  canUsers: true,
  canWorkforce: true,
  canTemplates: true,
  canDocuments: true,
  canEquipment: true,
  canAudit: true,
  canStats: true,
  canSla: true,
  canSms: true,
  canDispatch: true,
  isAdmin: true,
  canCustomerTransfer: true,
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

  it("viser kundeoverføring bare for administrator med settings.manage", () => {
    expect(isSettingsTabAllowed("kundeoverforing", admin)).toBe(true);
    expect(
      isSettingsTabAllowed("kundeoverforing", {
        ...noPermissions,
        isAdmin: true,
      }),
    ).toBe(false);
    expect(
      chooseSettingsTab("kundeoverforing", {
        ...noPermissions,
        canUsers: true,
      }),
    ).toBe("ansatte");
  });

  it("viser SMS-fanen bare med settings.manage", () => {    expect(isSettingsTabAllowed("sms", admin)).toBe(true);
    expect(isSettingsTabAllowed("sms", noPermissions)).toBe(false);
    expect(
      chooseSettingsTab("sms", { ...noPermissions, canSms: true }),
    ).toBe("sms");
  });

  it("viser dispatch-fanen bare med dispatch.configure", () => {
    expect(isSettingsTabAllowed("dispatch", admin)).toBe(true);
    expect(isSettingsTabAllowed("dispatch", noPermissions)).toBe(false);
    expect(
      chooseSettingsTab("dispatch", { ...noPermissions, canDispatch: true }),
    ).toBe("dispatch");
  });

  it("viser bemanningsfanen med lesetilgang til ansatte eller dispatch", () => {
    expect(isSettingsTabAllowed("kompetanse", admin)).toBe(true);
    expect(isSettingsTabAllowed("kompetanse", noPermissions)).toBe(false);
    expect(
      chooseSettingsTab("kompetanse", { ...noPermissions, canWorkforce: true }),
    ).toBe("kompetanse");
  });

  it("lar bare administrator åpne API-fanen", () => {
    expect(chooseSettingsTab("api", admin)).toBe("api");
    expect(isSettingsTabAllowed("api", admin)).toBe(true);
    expect(isSettingsTabAllowed("api", noPermissions)).toBe(false);
  });

  it("lar bare administrator åpne SSO- og SCIM-fanen", () => {
    expect(chooseSettingsTab("sso", admin)).toBe("sso");
    expect(isSettingsTabAllowed("sso", admin)).toBe(true);
    expect(isSettingsTabAllowed("sso", noPermissions)).toBe(false);
    expect(chooseSettingsTab("sso", { ...noPermissions, canUsers: true })).toBe(
      "ansatte",
    );
  });

  it("lar bare administrator åpne bevisfanen", () => {
    expect(chooseSettingsTab("bevis", admin)).toBe("bevis");
    expect(isSettingsTabAllowed("bevis", admin)).toBe(true);
    expect(isSettingsTabAllowed("bevis", noPermissions)).toBe(false);
    expect(
      chooseSettingsTab("bevis", { ...noPermissions, canAudit: true }),
    ).toBe("auditlog");
  });

  it("lar brukere med utstyrstilgang åpne utstyrsfanen", () => {
    const equipment: SettingsTabPermissions = {
      ...noPermissions,
      canEquipment: true,
    };

    expect(chooseSettingsTab("utstyr", equipment)).toBe("utstyr");
    expect(chooseSettingsTab(undefined, equipment)).toBe("utstyr");
  });

  it("lar alle innloggede åpne sikkerhetsfanen", () => {
    expect(chooseSettingsTab("sikkerhet", noPermissions)).toBe("sikkerhet");
    expect(isSettingsTabAllowed("sikkerhet", noPermissions)).toBe(true);
  });

  it("velger sikkerhet når ingen andre faner er tillatt", () => {
    expect(chooseSettingsTab(undefined, noPermissions)).toBe("sikkerhet");
  });
});
