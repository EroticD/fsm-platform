import { describe, expect, it } from "vitest";
import {
  activeNavHref,
  CUSTOMER_NAV,
  hasAnyPermission,
  homePathForRole,
  isAuthPath,
  isMobileTabActive,
  menuNavFor,
  mobileTabItemsFor,
  navItemsFor,
  primaryNavFor,
  settingsNavItem,
  STAFF_NAV,
} from "./navigation";
import { defaultPermissionsForRole } from "./permissions";

const hrefs = (items: { href: string }[]) => items.map((item) => item.href);

describe("toppnavigasjon", () => {
  it("gir kontoret dashbord, oppdrag, kalender, kunder og rapporter", () => {
    const items = navItemsFor("OFFICE");
    expect(hrefs(primaryNavFor(items))).toEqual([
      "/",
      "/oppdrag",
      "/kalender",
      "/kunder",
      "/rapporter",
    ]);
  });

  it("gir montørene «I dag» som hjem i stedet for dashbordet", () => {
    const items = navItemsFor(
      "TECHNICIAN",
      defaultPermissionsForRole("TECHNICIAN"),
    );
    expect(hrefs(primaryNavFor(items))).toEqual([
      "/mine-oppdrag",
      "/oppdrag",
      "/kalender",
      "/kunder",
    ]);
    expect(primaryNavFor(items)[0].labelKey).toBe("today");
  });

  it("samler alle gjenværende montørvalg i hamburgermenyen", () => {
    const items = navItemsFor(
      "TECHNICIAN",
      defaultPermissionsForRole("TECHNICIAN"),
    );
    expect(hrefs(menuNavFor(items))).toEqual([
      "/sok",
      "/rapporter",
      "/hms",
      "/dokumenter",
      "/kart",
      "/mine-oppdrag/ny",
      "/varsler",
      "/mine-oppdrag/kunder",
    ]);
    expect(settingsNavItem(items)?.href).toBe("/innstillinger");
  });

  it("samler kontorets gjenværende valg i hamburgermenyen", () => {
    const items = navItemsFor("OFFICE");
    expect(hrefs(menuNavFor(items))).toEqual([
      "/sok",
      "/hms",
      "/dokumenter",
      "/kart",
      "/oppdrag/ny",
      "/varsler",
    ]);
    expect(settingsNavItem(items)?.href).toBe("/innstillinger");
  });

  it("gir administrator samme hovedlinje som kontoret", () => {
    const items = navItemsFor("ADMIN", []);
    expect(hrefs(primaryNavFor(items))).toEqual([
      "/",
      "/oppdrag",
      "/kalender",
      "/kunder",
      "/rapporter",
    ]);
    expect(hrefs(menuNavFor(items))).toEqual([
      "/sok",
      "/hms",
      "/dokumenter",
      "/kart",
      "/oppdrag/ny",
      "/varsler",
    ]);
    expect(settingsNavItem(items)?.href).toBe("/innstillinger");
  });

  it("filtrerer bort sider en egendefinert rolle ikke har tilgang til", () => {
    const items = navItemsFor("SERVICELEDER", [
      "documents.view",
      "reports.view",
    ]);
    expect(hrefs(items)).toContain("/dokumenter");
    expect(hrefs(items)).toContain("/rapporter");
    expect(hrefs(items)).not.toContain("/kunder");
    expect(hrefs(items)).not.toContain("/oppdrag");
    expect(hrefs(items)).not.toContain("/mine-oppdrag/kunder");
  });

  it("lar administrator se hele menyen", () => {
    const items = navItemsFor("ADMIN", []);
    expect(hrefs(items)).toContain("/innstillinger");
    expect(hrefs(items)).toContain("/oppdrag/ny");
    expect(hrefs(items)).toContain("/rapporter");
  });

  it("gir kundeportalbrukere portalen og egen kontosikkerhet", () => {
    const items = navItemsFor("CUSTOMER");
    expect(hrefs(items)).toEqual([
      "/kundeportal",
      "/innstillinger?tab=sikkerhet",
    ]);
    expect(settingsNavItem(items)?.labelKey).toBe("accountSecurity");
    expect(hrefs(items)).not.toContain("/innstillinger");
  });

  it("markerer kundens sikkerhetsfane som aktiv uten query i stien", () => {
    expect(activeNavHref(navItemsFor("CUSTOMER"), "/innstillinger")).toBe(
      "/innstillinger?tab=sikkerhet",
    );
  });

  it("sender montører til feltportalen for nytt oppdrag", () => {
    const items = navItemsFor(
      "TECHNICIAN",
      defaultPermissionsForRole("TECHNICIAN"),
    );
    expect(hrefs(items)).toContain("/mine-oppdrag/ny");
    expect(hrefs(items)).not.toContain("/oppdrag/ny");
  });

  it("holder /enheter utenfor menyen", () => {
    for (const role of ["ADMIN", "OFFICE", "TECHNICIAN"]) {
      expect(hrefs(navItemsFor(role, []))).not.toContain("/enheter");
    }
  });

  it("gjør hver arbeidsflate nåbar for minst én rolle", () => {
    const all = new Set<string>();
    for (const role of ["ADMIN", "OFFICE", "TECHNICIAN"]) {
      for (const href of hrefs(navItemsFor(role, []))) all.add(href);
    }

    const featureRoutes = [
      "/",
      "/mine-oppdrag",
      "/oppdrag",
      "/kalender",
      "/kunder",
      "/rapporter",
      "/sok",
      "/hms",
      "/dokumenter",
      "/kart",
      "/oppdrag/ny",
      "/mine-oppdrag/ny",
      "/varsler",
      "/mine-oppdrag/kunder",
      "/innstillinger",
    ];
    for (const route of featureRoutes) {
      expect(all.has(route), `Siden ${route} mangler i navigasjonen`).toBe(true);
    }
  });

  it("markerer den lengste treffende stien som aktiv", () => {
    const items = navItemsFor("ADMIN", ["workorders.view", "workorders.create"]);
    expect(activeNavHref(items, "/oppdrag/ny")).toBe("/oppdrag/ny");
    expect(activeNavHref(items, "/oppdrag/abc")).toBe("/oppdrag");
    expect(activeNavHref(items, "/")).toBe("/");
    expect(activeNavHref(items, "/ukjent")).toBeNull();
  });

  it("markerer varsler og innstillinger når de åpnes fra menyen", () => {
    const items = navItemsFor("ADMIN", []);
    expect(activeNavHref(items, "/varsler")).toBe("/varsler");
    expect(activeNavHref(items, "/varsler/innstillinger")).toBe("/varsler");
    expect(activeNavHref(items, "/innstillinger")).toBe("/innstillinger");
  });

  it("sjekker én eller flere rettigheter", () => {
    const permissions = new Set(["reports.view"]);
    expect(hasAnyPermission(permissions, "reports.view")).toBe(true);
    expect(hasAnyPermission(permissions, ["users.view", "reports.view"])).toBe(
      true,
    );
    expect(hasAnyPermission(permissions, "users.view")).toBe(false);
    expect(hasAnyPermission(permissions, undefined)).toBe(true);
  });

  it("bruker monokrome ikonnavn i stedet for emoji", () => {
    for (const item of [...STAFF_NAV, ...CUSTOMER_NAV]) {
      expect(item.icon, item.href).toMatch(/^[a-z][a-zA-Z]+$/);
      expect(item.icon, item.href).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("har et stabilt ikon per arbeidsflate", () => {
    const icons = Object.fromEntries(
      [...STAFF_NAV, ...CUSTOMER_NAV].map((item) => [item.href, item.icon]),
    );
    expect(icons).toMatchObject({
      "/": "home",
      "/mine-oppdrag": "route",
      "/oppdrag": "clipboard",
      "/kalender": "calendar",
      "/kunder": "building",
      "/sok": "search",
      "/rapporter": "chart",
      "/hms": "shield",
      "/dokumenter": "file",
      "/kart": "map",
      "/oppdrag/ny": "plus",
      "/varsler": "bell",
      "/mine-oppdrag/kunder": "wrench",
      "/innstillinger": "settings",
      "/kundeportal": "user",
      "/innstillinger?tab=sikkerhet": "shield",
    });
  });
});

describe("rollehjem", () => {
  it("sender montører til I dag, kunder til portalen og kontoret til dashbordet", () => {
    expect(homePathForRole("TECHNICIAN")).toBe("/mine-oppdrag");
    expect(homePathForRole("CUSTOMER")).toBe("/kundeportal");
    expect(homePathForRole("OFFICE")).toBe("/");
    expect(homePathForRole("ADMIN")).toBe("/");
    expect(homePathForRole(undefined)).toBe("/");
  });
});

describe("mobil bunnlinje", () => {
  it("gir montørene I dag, Oppdrag og Varsler", () => {
    const items = mobileTabItemsFor(
      "TECHNICIAN",
      defaultPermissionsForRole("TECHNICIAN"),
    );
    expect(hrefs(items)).toEqual(["/mine-oppdrag", "/oppdrag", "/varsler"]);
  });

  it("gir kontoret Dashbord, Oppdrag og Kalender", () => {
    expect(hrefs(mobileTabItemsFor("OFFICE"))).toEqual([
      "/",
      "/oppdrag",
      "/kalender",
    ]);
    expect(hrefs(mobileTabItemsFor("ADMIN", []))).toEqual([
      "/",
      "/oppdrag",
      "/kalender",
    ]);
  });

  it("gir kundeportalen ingen bunnlinje", () => {
    expect(mobileTabItemsFor("CUSTOMER")).toEqual([]);
  });

  it("markerer rotnivået bare på nøyaktig sti", () => {
    expect(isMobileTabActive("/", "/")).toBe(true);
    expect(isMobileTabActive("/", "/oppdrag")).toBe(false);
    expect(isMobileTabActive("/mine-oppdrag", "/mine-oppdrag/abc")).toBe(true);
    expect(isMobileTabActive("/oppdrag", "/oppdrag/ny")).toBe(true);
  });

  it("gjenkjenner innloggingssidene", () => {
    expect(isAuthPath("/logg-inn")).toBe(true);
    expect(isAuthPath("/logg-inn/2fa")).toBe(true);
    expect(isAuthPath("/glemt-passord")).toBe(true);
    expect(isAuthPath("/oppdrag")).toBe(false);
  });
});
