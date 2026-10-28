import { describe, expect, it } from "vitest";
import { activeNavHref, hasAnyPermission, navItemsFor } from "./navigation";
import { defaultPermissionsForRole } from "./permissions";

describe("toppnavigasjon", () => {
  it("gir kontoret de manglende kontorverktøyene", () => {
    const hrefs = navItemsFor("OFFICE").map((item) => item.href);
    expect(hrefs).toContain("/oppdrag");
    expect(hrefs).toContain("/kart");
    expect(hrefs).not.toContain("/rapporter");
    expect(hrefs).not.toContain("/enheter");
  });

  it("filtrerer bort sider en egendefinert rolle ikke har tilgang til", () => {
    const hrefs = navItemsFor("SERVICELEDER", [
      "documents.view",
      "reports.view",
    ]).map((item) => item.href);
    expect(hrefs).toContain("/dokumenter");
    expect(hrefs).not.toContain("/rapporter");
    expect(hrefs).not.toContain("/kunder");
    expect(hrefs).not.toContain("/oppdrag");
  });

  it("lar administrator se hele menyen", () => {
    const hrefs = navItemsFor("ADMIN", []).map((item) => item.href);
    expect(hrefs).toContain("/innstillinger");
    expect(hrefs).toContain("/oppdrag/ny");
  });

  it("gir kundeportalbrukere bare portalen", () => {
    expect(navItemsFor("CUSTOMER").map((item) => item.href)).toEqual([
      "/kundeportal",
    ]);
  });

  it("sender montører til feltportalen for nytt oppdrag", () => {
    const items = navItemsFor("TECHNICIAN", defaultPermissionsForRole("TECHNICIAN"));
    expect(items.map((item) => item.href)).toContain("/mine-oppdrag/ny");
    expect(items.map((item) => item.href)).not.toContain("/oppdrag/ny");
  });

  it("markerer den lengste treffende stien som aktiv", () => {
    const items = navItemsFor("ADMIN", ["workorders.view", "workorders.create"]);
    expect(activeNavHref(items, "/oppdrag/ny")).toBe("/oppdrag/ny");
    expect(activeNavHref(items, "/oppdrag/abc")).toBe("/oppdrag");
    expect(activeNavHref(items, "/")).toBe("/");
    expect(activeNavHref(items, "/ukjent")).toBeNull();
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
});
