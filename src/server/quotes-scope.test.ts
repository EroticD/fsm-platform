import { describe, expect, it } from "vitest";
import type { ServiceActor } from "./actor";
import { quoteScopeFor } from "./quotes";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Bruker",
    email: null,
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep1",
    customerId: null,
    permissionsCustomized: true,
    permissions: [],
    roleDefinition: null,
    ...overrides,
  };
}

describe("quoteScopeFor", () => {
  it("gir administrator tilgang til alle tilbud", () => {
    expect(quoteScopeFor(actor({ role: "ADMIN" }))).toEqual({});
  });

  it("begrenser kontor og teknikere med lesetilgang til egen avdeling", () => {
    for (const permission of ["customers.view", "customers.manage", "workorders.view"]) {
      expect(
        quoteScopeFor(actor({ role: "OFFICE", permissions: [permission] })),
      ).toEqual({
        departmentId: "dep1",
        department: { isActive: true },
      });
    }
    expect(
      quoteScopeFor(actor({ role: "TECHNICIAN", permissions: ["customers.view"] })),
    ).toEqual({
      departmentId: "dep1",
      department: { isActive: true },
    });
  });

  it("gir ingen tilbud uten leserettighet eller avdeling", () => {
    expect(quoteScopeFor(actor({ permissions: [] }))).toEqual({ id: { in: [] } });
    expect(
      quoteScopeFor(actor({ departmentId: null, permissions: ["customers.view"] })),
    ).toEqual({ id: { in: [] } });
  });

  it("isolerer kundeportalen til innlogget kunde", () => {
    expect(
      quoteScopeFor(actor({ role: "CUSTOMER", customerId: "cust-a", departmentId: null })),
    ).toEqual({ customerId: "cust-a" });
    expect(
      quoteScopeFor(actor({ role: "CUSTOMER", customerId: null, departmentId: null })),
    ).toEqual({ id: { in: [] } });
  });

  it("stenger ute inaktive kontoer", () => {
    expect(
      quoteScopeFor(actor({ role: "ADMIN", isActive: false })),
    ).toEqual({ id: { in: [] } });
  });
});
