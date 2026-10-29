import { describe, expect, it } from "vitest";
import {
  cleanPermissions,
  defaultPermissionsForRole,
  effectivePermissions,
  hasPermission,
  PERMISSIONS,
  roleLabel,
  ROLE_LABEL_KEYS,
} from "@/lib/permissions";

describe("rettigheter", () => {
  it("gir administrator alle rettigheter, også når permissions er tom", () => {
    const admin = { role: "ADMIN", isActive: true, permissions: [] };
    expect(hasPermission(admin, "audit.view")).toBe(true);
    expect(hasPermission(admin, "settings.manage")).toBe(true);
  });

  it("gir kontor standardtilgang uten aktivitetslogg", () => {
    expect(defaultPermissionsForRole("OFFICE")).toContain("customers.manage");
    expect(defaultPermissionsForRole("OFFICE")).not.toContain("audit.view");
  });

  it("gir ikke rapporttilgang på tvers av avdelinger som standard", () => {
    expect(defaultPermissionsForRole("OFFICE")).not.toContain(
      "reports.viewAllDepartments",
    );
    expect(defaultPermissionsForRole("TECHNICIAN")).not.toContain(
      "reports.viewAllDepartments",
    );
    expect(defaultPermissionsForRole("ADMIN")).toContain(
      "reports.viewAllDepartments",
    );
    expect(
      hasPermission(
        { role: "ADMIN", isActive: true, permissions: [] },
        "reports.viewAllDepartments",
      ),
    ).toBe(true);
  });

  it("gir montør feltrettigheter, men ikke administrasjon", () => {
    const technician = { role: "TECHNICIAN", isActive: true, permissions: [] };
    expect(hasPermission(technician, "workorders.update")).toBe(true);
    expect(hasPermission(technician, "reports.write")).toBe(true);
    expect(hasPermission(technician, "workorders.edit")).toBe(false);
    expect(hasPermission(technician, "workorders.assign")).toBe(false);
    expect(hasPermission(technician, "customers.manage")).toBe(false);
    expect(hasPermission(technician, "users.view")).toBe(false);
  });

  it("lar administrator gi enkelte ekstra rettigheter", () => {
    const technician = {
      role: "TECHNICIAN",
      isActive: true,
      permissions: ["documents.manage", "audit.view"],
    };
    expect(hasPermission(technician, "documents.manage")).toBe(true);
    expect(hasPermission(technician, "audit.view")).toBe(true);
  });

  it("bruker rettighetene som er lagret på rollen", () => {
    const custom = {
      role: "SERVICELEDER",
      isActive: true,
      permissions: [],
      roleDefinition: { permissions: ["customers.manage", "reports.view"] },
    };
    expect(hasPermission(custom, "customers.manage")).toBe(true);
    expect(hasPermission(custom, "reports.view")).toBe(true);
    expect(hasPermission(custom, "workorders.edit")).toBe(false);
  });

  it("lar en tilpasset liste overstyre rollen helt", () => {
    const customized = {
      role: "TECHNICIAN",
      isActive: true,
      permissionsCustomized: true,
      permissions: ["documents.manage"],
      roleDefinition: { permissions: ["workorders.view", "reports.write"] },
    };
    expect(hasPermission(customized, "documents.manage")).toBe(true);
    expect(hasPermission(customized, "workorders.view")).toBe(false);
    expect(hasPermission(customized, "reports.write")).toBe(false);
  });

  it("gir ingen rettigheter til inaktive brukere", () => {
    const inactive = {
      role: "ADMIN",
      isActive: false,
      permissions: ["audit.view"],
    };
    expect(hasPermission(inactive, "workorders.view")).toBe(false);
    expect(effectivePermissions(inactive).size).toBe(0);
  });

  it("fjerner ukjente og dupliserte rettigheter", () => {
    expect(
      cleanPermissions(["customers.manage", "customers.manage", "slett.alt"]),
    ).toEqual(["customers.manage"]);
  });

  it("gir alle rettigheter i18n-nøkler for etikett og beskrivelse", () => {
    for (const permission of PERMISSIONS) {
      expect(permission.labelKey).toMatch(/^settings\.permissions\.items\./);
      expect(permission.descriptionKey).toMatch(
        /^settings\.permissions\.items\..+\.description$/,
      );
      expect(permission.groupKey).toMatch(/^settings\.permissions\.groups\./);
    }
  });

  it("oversetter innebygde roller og faller tilbake til norsk", () => {
    expect(ROLE_LABEL_KEYS.ADMIN).toBe("settings.roles.builtIn.admin");
    expect(roleLabel("ADMIN")).toBe("Administrator");
    expect(roleLabel("TECHNICIAN", (key) => `t:${key}`)).toBe(
      "t:settings.roles.builtIn.technician",
    );
    expect(roleLabel("SERVICELEDER")).toBe("SERVICELEDER");
  });
});
