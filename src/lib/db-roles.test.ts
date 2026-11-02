import { describe, expect, it } from "vitest";
import {
  roleCanDdl,
  runtimeRoleIsUnsafe,
  type DatabaseRoleInfo,
} from "./db-roles";

function role(overrides: Partial<DatabaseRoleInfo> = {}): DatabaseRoleInfo {
  return {
    currentUser: "fsm_app",
    superuser: false,
    createDb: false,
    createRole: false,
    schemaCreate: false,
    ...overrides,
  };
}

describe("db-roles", () => {
  it("godtar en ren DML-rolle", () => {
    expect(roleCanDdl(role())).toBe(false);
    expect(runtimeRoleIsUnsafe(role(), { NODE_ENV: "production" })).toBe(false);
  });

  it("oppdager superbruker, createdb og schema-create", () => {
    expect(roleCanDdl(role({ superuser: true }))).toBe(true);
    expect(roleCanDdl(role({ createDb: true }))).toBe(true);
    expect(roleCanDdl(role({ createRole: true }))).toBe(true);
    expect(roleCanDdl(role({ schemaCreate: true }))).toBe(true);
  });

  it("blokkerer DDL-rolle i produksjon", () => {
    expect(
      runtimeRoleIsUnsafe(role({ superuser: true }), { NODE_ENV: "production" }),
    ).toBe(true);
  });

  it("lar operatøren velge bort sjekken eksplisitt", () => {
    expect(
      runtimeRoleIsUnsafe(role({ superuser: true }), {
        NODE_ENV: "production",
        ALLOW_DB_DDL_ROLE: "true",
      }),
    ).toBe(false);
  });

  it("blokkerer ikke lokal utvikling", () => {
    expect(
      runtimeRoleIsUnsafe(role({ superuser: true }), { NODE_ENV: "development" }),
    ).toBe(false);
  });
});
