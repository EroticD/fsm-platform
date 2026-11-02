import { describe, expect, it } from "vitest";
import {
  apiKeyAllowsScope,
  normalizeApiKeyScopes,
  requiredScopeForRequest,
} from "./api-key-scopes";

describe("requiredScopeForRequest", () => {
  it.each([
    ["/api/v1/me", "GET", null],
    ["/api/v1/work-orders", "GET", "workorders:read"],
    ["/api/v1/work-orders", "POST", "workorders:write"],
    ["/api/v1/work-orders/wo1", "GET", "workorders:read"],
    ["/api/v1/work-orders/wo1", "PATCH", "workorders:write"],
    ["/api/v1/work-orders/wo1/visits", "GET", "visits:read"],
    ["/api/v1/work-orders/wo1/visits", "POST", "visits:write"],
    ["/api/v1/visits/v1", "GET", "visits:read"],
    ["/api/v1/visits/v1", "PATCH", "visits:write"],
    ["/api/v1/visits/v1", "DELETE", "visits:write"],
    ["/api/v1/customers", "GET", "customers:read"],
    ["/api/v1/customers/c1", "GET", "customers:read"],
    ["/api/v1/contracts", "GET", "contracts:read"],
    ["/api/v1/contracts", "POST", "contracts:write"],
    ["/api/v1/contracts/c1", "PATCH", "contracts:write"],
    ["/api/v1/contracts/c1/pdf", "GET", "contracts:read"],
    ["/api/v1/sla-policies", "GET", "sla:read"],
    ["/api/v1/equipment", "GET", "equipment:read"],
    ["/api/v1/equipment", "POST", "equipment:write"],
    ["/api/v1/equipment/e1", "PATCH", "equipment:write"],
    ["/api/v1/equipment/e1/meters", "GET", "equipment:read"],
    ["/api/v1/equipment/e1/meters", "POST", "equipment:write"],
    ["/api/v1/maintenance-plans", "GET", "maintenance:read"],
    ["/api/v1/maintenance-plans", "POST", "maintenance:write"],
    ["/api/v1/reports", "GET", "reports:read"],
    ["/api/v1/reports/r1", "GET", "reports:read"],
    ["/api/v1/reports/r1/pdf", "GET", "reports:read"],
    ["/api/v1/documents", "GET", "documents:read"],
    ["/api/v1/documents/d1", "GET", "documents:read"],
  ])("%s %s krever %s", (path, method, expected) => {
    expect(requiredScopeForRequest(method, path)).toBe(expected);
  });
});

describe("apiKeyAllowsScope", () => {
  it("tillater bare valgte scopes", () => {
    const key = { scopes: ["reports:read"], readOnly: false };

    expect(apiKeyAllowsScope(key, "GET", "/api/v1/reports")).toBe(true);
    expect(apiKeyAllowsScope(key, "GET", "/api/v1/work-orders")).toBe(false);
  });

  it("lar skrivebeskyttede nøkler lese uansett valgte scopes", () => {
    const key = { scopes: ["workorders:read"], readOnly: true };

    expect(apiKeyAllowsScope(key, "GET", "/api/v1/work-orders")).toBe(true);
    expect(apiKeyAllowsScope(key, "POST", "/api/v1/work-orders")).toBe(false);
  });

  it("behandler tom liste som alle scopes for eldre nøkler", () => {
    const key = { scopes: [], readOnly: false };

    expect(apiKeyAllowsScope(key, "GET", "/api/v1/reports")).toBe(true);
    expect(apiKeyAllowsScope(key, "POST", "/api/v1/equipment")).toBe(true);
  });
});

describe("normalizeApiKeyScopes", () => {
  it("fjerner duplikater og avviser ukjente scopes", () => {
    expect(
      normalizeApiKeyScopes(["reports:read", "reports:read", "sla:read"]),
    ).toEqual(["reports:read", "sla:read"]);
    expect(() => normalizeApiKeyScopes(["admin:alt"])).toThrow();
    expect(() => normalizeApiKeyScopes("reports:read")).toThrow();
  });
});
