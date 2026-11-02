import { describe, expect, it } from "vitest";
import {
  requiredTwoFactorRoles,
  requiresTwoFactorEnrollment,
} from "./two-factor-policy";

describe("requiredTwoFactorRoles", () => {
  it("leser kommaseparerte roller uten hensyn til store/små bokstaver", () => {
    expect(
      requiredTwoFactorRoles({ REQUIRE_2FA_ROLES: " admin, Office ,," }),
    ).toEqual(["ADMIN", "OFFICE"]);
  });

  it("er tom når variabelen ikke er satt", () => {
    expect(requiredTwoFactorRoles({})).toEqual([]);
  });
});

describe("requiresTwoFactorEnrollment", () => {
  const env = { REQUIRE_2FA_ROLES: "ADMIN,OFFICE" };

  it("krever oppsett for privilegert rolle uten 2FA", () => {
    expect(
      requiresTwoFactorEnrollment(
        { role: "ADMIN", isTwoFactorEnabled: false },
        env,
      ),
    ).toBe(true);
    expect(
      requiresTwoFactorEnrollment(
        { role: "OFFICE", isTwoFactorEnabled: false },
        env,
      ),
    ).toBe(true);
  });

  it("krever ikke oppsett når 2FA allerede er slått på", () => {
    expect(
      requiresTwoFactorEnrollment(
        { role: "ADMIN", isTwoFactorEnabled: true },
        env,
      ),
    ).toBe(false);
  });

  it("påvirker ikke roller utenfor policyen", () => {
    expect(
      requiresTwoFactorEnrollment(
        { role: "TECHNICIAN", isTwoFactorEnabled: false },
        env,
      ),
    ).toBe(false);
  });

  it("er av når policyen er tom", () => {
    expect(
      requiresTwoFactorEnrollment(
        { role: "ADMIN", isTwoFactorEnabled: false },
        {},
      ),
    ).toBe(false);
  });
});
