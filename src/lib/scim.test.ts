import { describe, expect, it } from "vitest";
import {
  applyScimPatch,
  parseScimFilter,
  parseScimPagination,
  parseScimPatch,
  parseScimUser,
  scimErrorBody,
  scimFilterWhere,
  scimInputFromUser,
  scimUserResource,
  scimUserName,
} from "./scim";

const fullUser = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: "Kari@Example.NO",
  externalId: "ext-1",
  active: true,
  name: { givenName: "Kari", familyName: "Firma" },
  emails: [{ value: "kari@example.no", primary: true, type: "work" }],
  roles: [{ value: "OFFICE" }],
  groups: [{ display: "FSM-Office" }],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    department: "Oslo",
  },
  password: "skal-aldri-lagres",
};

describe("parseScimUser", () => {
  it("mapper userName, navn, e-post, roller, grupper og avdeling", () => {
    const result = parseScimUser(fullUser);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      userName: "kari@example.no",
      externalId: "ext-1",
      active: true,
      name: { formatted: null, givenName: "Kari", familyName: "Firma" },
      emails: [{ value: "kari@example.no", primary: true, type: "work" }],
      roles: ["OFFICE"],
      groups: ["FSM-Office"],
      department: "Oslo",
    });
    expect(result.data).not.toHaveProperty("password");
  });

  it("bruker primær e-post når userName ikke er en adresse", () => {
    const result = parseScimUser({
      userName: "kari.f",
      emails: [
        { value: "kari@example.no", primary: false },
        { value: "kari@firma.no", primary: true },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userName).toBe("kari@firma.no");
    expect(scimUserName(result.data)).toBe("kari@firma.no");
  });

  it("avviser bruker uten e-post", () => {
    expect(parseScimUser({ userName: "uten-epost" }).ok).toBe(false);
    expect(parseScimUser({ userName: "uten-epost", emails: [] }).ok).toBe(
      false,
    );
  });
});

describe("SCIM-filter", () => {
  it("leser eq og and", () => {
    const result = parseScimFilter('userName eq "Kari@Example.NO" and active eq true');
    expect(result).toEqual({
      ok: true,
      data: [
        { attribute: "userName", operator: "eq", value: "Kari@Example.NO" },
        { attribute: "active", operator: "eq", value: true },
      ],
    });
  });

  it("avviser or og ukjente operatorer", () => {
    expect(parseScimFilter('userName eq "a" or userName eq "b"').ok).toBe(false);
    expect(parseScimFilter('userName xx "a"').ok).toBe(false);
  });

  it("oversetter attributter til Prisma-filter", () => {
    const clauses = [
      { attribute: "userName", operator: "eq" as const, value: "Kari@Example.NO" },
      { attribute: "externalId", operator: "eq" as const, value: "ext-1" },
      { attribute: "active", operator: "eq" as const, value: false },
      { attribute: "id", operator: "eq" as const, value: "u1" },
    ];
    const where = scimFilterWhere(clauses);
    expect(where).toEqual({
      ok: true,
      data: {
        AND: [
          { email: "kari@example.no" },
          { scimExternalId: "ext-1" },
          { isActive: false },
          { id: "u1" },
        ],
      },
    });
  });

  it("avviser filtre på ukjente attributter", () => {
    const where = scimFilterWhere([
      { attribute: "hemmelighet", operator: "eq", value: "x" },
    ]);
    expect(where.ok).toBe(false);
  });

  it("støtter pr for nullable felt uten verdi", () => {
    const where = scimFilterWhere([
      { attribute: "externalId", operator: "pr", value: null },
      { attribute: "displayName", operator: "pr", value: null },
    ]);
    expect(where).toEqual({
      ok: true,
      data: {
        AND: [{ scimExternalId: { not: null } }, { name: { not: null } }],
      },
    });
  });
});

describe("parseScimPagination", () => {
  it("bruker standard og klemmer count til 100", () => {
    expect(parseScimPagination(new URL("https://x/api/scim/v2/Users"))).toEqual({
      startIndex: 1,
      count: 100,
      skip: 0,
    });
    expect(
      parseScimPagination(
        new URL("https://x/api/scim/v2/Users?startIndex=3&count=1000"),
      ),
    ).toEqual({ startIndex: 3, count: 100, skip: 200 });
    expect(
      parseScimPagination(
        new URL("https://x/api/scim/v2/Users?startIndex=0&count=0"),
      ),
    ).toEqual({ startIndex: 1, count: 0, skip: 0 });
  });
});

describe("PATCH", () => {
  it("leser og anvender replace på active, navn og roller", () => {
    const parsed = parseScimPatch({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "replace", path: "active", value: false },
        { op: "replace", path: "name.givenName", value: "Ola" },
        { op: "replace", path: "roles", value: [{ value: "OFFICE" }] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const base = scimInputFromUser({
      id: "u1",
      email: "kari@example.no",
      name: "Kari",
      scimExternalId: "ext-1",
      isActive: true,
      role: "TECHNICIAN",
      departmentId: "dep-a",
    });
    const result = applyScimPatch(base, parsed.data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.active).toBe(false);
    expect(result.data.name?.givenName).toBe("Ola");
    expect(result.data.roles).toEqual(["OFFICE"]);
  });

  it("støtter remove av avdeling og ekstern id", () => {
    const parsed = parseScimPatch({
      Operations: [
        { op: "remove", path: "externalId" },
        {
          op: "remove",
          path: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = applyScimPatch(
      {
        userName: "kari@example.no",
        externalId: "ext-1",
        active: true,
        name: null,
        emails: [],
        roles: [],
        groups: [],
        department: "dep-a",
      },
      parsed.data,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.externalId).toBeNull();
    expect(result.data.department).toBeNull();
  });

  it("avviser ukjent path og remove uten path", () => {
    const unknown = parseScimPatch({
      Operations: [{ op: "replace", path: "password", value: "x" }],
    });
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    expect(
      applyScimPatch(
        {
          userName: "a@b.no",
          externalId: null,
          active: true,
          name: null,
          emails: [],
          roles: [],
          groups: [],
          department: null,
        },
        unknown.data,
      ).ok,
    ).toBe(false);

    expect(parseScimPatch({ Operations: [{ op: "remove" }] }).ok).toBe(false);
  });
});

describe("scimUserResource", () => {
  it("inneholder ikke hemmeligheter og tar med avdeling", () => {
    const resource = scimUserResource({
      id: "u1",
      email: "kari@example.no",
      name: "Kari",
      scimExternalId: "ext-1",
      isActive: true,
      role: "OFFICE",
      departmentId: "dep-a",
      department: { id: "dep-a", name: "Oslo" },
    });

    expect(resource).toMatchObject({
      id: "u1",
      userName: "kari@example.no",
      externalId: "ext-1",
      active: true,
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
        department: "Oslo",
      },
    });
    expect(JSON.stringify(resource)).not.toContain("password");
    expect(JSON.stringify(resource)).not.toContain("twoFactor");
  });
});

describe("scimErrorBody", () => {
  it("følger SCIM-feilskjemaet med status som streng", () => {
    expect(scimErrorBody(409, "Finnes allerede", "uniqueness")).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Finnes allerede",
      status: "409",
      scimType: "uniqueness",
    });
  });
});
