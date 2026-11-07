import { describe, expect, it } from "vitest";
import {
  CUSTOMER_NAV,
  menuNavFor,
  navItemsFor,
  primaryNavFor,
} from "./navigation";
import {
  chooseSettingsTab,
  isSettingsTabAllowed,
  type SettingsTabPermissions,
} from "./settings-tabs";
import type { ModuleKey } from "./modules";

const allAdmin: SettingsTabPermissions = {
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

const coreOnly: ModuleKey[] = ["core"];

describe("navigasjon med moduler", () => {
  it("skjuler modulvalg når modulen er av, men beholder kjernen", () => {
    const items = navItemsFor("ADMIN", undefined, coreOnly);
    const hrefs = items.map((item) => item.href);
    expect(hrefs).toEqual([
      "/",
      "/oppdrag",
      "/kunder",
      "/sok",
      "/oppdrag/ny",
      "/varsler",
      "/innstillinger",
    ]);
    expect(hrefs).not.toContain("/kalender");
    expect(hrefs).not.toContain("/rapporter");
    expect(hrefs).not.toContain("/dokumenter");
    expect(hrefs).not.toContain("/kart");
  });

  it("viser modulvalg når modulen er på", () => {
    const items = navItemsFor("ADMIN", undefined, [
      "core",
      "calendar",
      "reports",
      "equipment",
      "contracts",
      "sms",
      "booking",
      "documents",
      "map",
      "portal",
    ]);
    expect(primaryNavFor(items).map((item) => item.href)).toContain("/kalender");
    expect(menuNavFor(items).map((item) => item.href)).toContain("/dokumenter");
  });

  it("gjemmer kundeportalen når portal-modulen er av", () => {
    expect(
      navItemsFor("CUSTOMER", undefined, coreOnly).map((item) => item.href),
    ).toEqual(["/innstillinger?tab=sikkerhet"]);
    expect(
      navItemsFor("CUSTOMER", undefined, ["core", "portal"]).map(
        (item) => item.href,
      ),
    ).toEqual([...CUSTOMER_NAV.map((item) => item.href)]);
  });

  it("beholder gammel oppførsel når moduldata ikke er oppgitt", () => {
    expect(navItemsFor("OFFICE").map((item) => item.href)).toContain(
      "/kalender",
    );
  });
});

describe("innstillingsfaner med moduler", () => {
  it("skjuler faner for avslåtte moduler", () => {
    const tabs = [
      "kart",
      "maler",
      "tags",
      "utstyr",
      "bevis",
      "statistikk",
      "sla",
      "sms",
      "dispatch",
      "api",
      "sso",
      "kundeoverforing",
    ] as const;
    for (const tab of tabs) {
      expect(isSettingsTabAllowed(tab, allAdmin, coreOnly)).toBe(false);
    }
  });

  it("beholder kjernеfanene og moduler-fanen", () => {
    for (const tab of [
      "branding",
      "ansatte",
      "kompetanse",
      "roller",
      "avdelinger",
      "auditlog",
      "sikkerhet",
      "moduler",
    ] as const) {
      expect(isSettingsTabAllowed(tab, allAdmin, coreOnly)).toBe(true);
    }
  });

  it("viser tags når minst én av reports/documents er på", () => {
    expect(
      isSettingsTabAllowed("tags", allAdmin, ["core", "documents"]),
    ).toBe(true);
    expect(
      isSettingsTabAllowed("tags", allAdmin, ["core", "reports"]),
    ).toBe(true);
    expect(isSettingsTabAllowed("tags", allAdmin, ["core", "sms"])).toBe(false);
  });

  it("faller tilbake til en tillatt fane når en modulfane er av", () => {
    expect(chooseSettingsTab("sla", allAdmin, coreOnly)).toBe("branding");
    expect(
      chooseSettingsTab("sla", allAdmin, ["core", "contracts"]),
    ).toBe("sla");
  });

  it("viser moduler-fanen bare for administrator", () => {
    expect(
      isSettingsTabAllowed("moduler", { ...allAdmin, isAdmin: false }),
    ).toBe(false);
  });
});
