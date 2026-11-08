import { describe, expect, it } from "vitest";
import {
  applyScimGroupPatch,
  parseScimGroup,
  parseScimGroupPatch,
  scimGroupFilterWhere,
  scimGroupResource,
  type ScimGroupInput,
} from "./scim-groups";
import { parseScimFilter } from "./scim";

const base: ScimGroupInput = {
  displayName: "FSM-Office",
  externalId: "ext-group-1",
  memberIds: ["u1", "u2"],
};

describe("parseScimGroup", () => {
  it("leser displayName, externalId og medlemmer", () => {
    const result = parseScimGroup({
      displayName: "FSM-Office",
      externalId: "ext-1",
      members: [{ value: "u1" }, "u2", { display: "ignored" }],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        displayName: "FSM-Office",
        externalId: "ext-1",
        memberIds: ["u1", "u2"],
      },
    });
  });

  it("krever displayName", () => {
    expect(parseScimGroup({})).toMatchObject({
      ok: false,
      scimType: "invalidValue",
    });
  });
});

describe("scimGroupResource", () => {
  it("returnerer RFC 7643-form uten hemmeligheter", () => {
    const resource = scimGroupResource(
      {
        id: "g1",
        displayName: "FSM-Office",
        externalId: "ext-1",
        members: [
          { userId: "u1", user: { id: "u1", name: "Kari", email: "k@x.no" } },
        ],
      },
      "https://fsm.example",
    );
    expect(resource).toMatchObject({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: "g1",
      displayName: "FSM-Office",
      members: [
        {
          value: "u1",
          display: "Kari",
          $ref: "https://fsm.example/api/scim/v2/Users/u1",
        },
      ],
      meta: {
        resourceType: "Group",
        location: "https://fsm.example/api/scim/v2/Groups/g1",
      },
    });
  });
});

describe("scimGroupFilterWhere", () => {
  it("filtrerer på displayName og medlem", () => {
    const parsed = parseScimFilter(
      'displayName co "office" and members eq "u1"',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const where = scimGroupFilterWhere(parsed.data);
    expect(where).toEqual({
      ok: true,
      data: {
        AND: [
          { displayName: { contains: "office", mode: "insensitive" } },
          { members: { some: { userId: "u1" } } },
        ],
      },
    });
  });

  it("avviser ukjente attributter", () => {
    const parsed = parseScimFilter('members co "x"');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(scimGroupFilterWhere(parsed.data)).toMatchObject({
      ok: false,
      scimType: "invalidFilter",
    });
  });
});

describe("applyScimGroupPatch", () => {
  it("legger til og fjerner medlemmer", () => {
    const operations = parseScimGroupPatch({
      Operations: [
        { op: "add", path: "members", value: [{ value: "u3" }] },
        { op: "remove", path: 'members[value eq "u1"]' },
      ],
    });
    expect(operations.ok).toBe(true);
    if (!operations.ok) return;
    const result = applyScimGroupPatch(base, operations.data);
    expect(result).toEqual({
      ok: true,
      data: { ...base, memberIds: ["u2", "u3"] },
    });
  });

  it("erstatter medlemslisten og endrer displayName", () => {
    const operations = parseScimGroupPatch({
      Operations: [
        { op: "replace", path: "displayName", value: "FSM-Kontor" },
        { op: "replace", path: "members", value: [{ value: "u9" }] },
      ],
    });
    expect(operations.ok).toBe(true);
    if (!operations.ok) return;
    const result = applyScimGroupPatch(base, operations.data);
    expect(result).toEqual({
      ok: true,
      data: {
        displayName: "FSM-Kontor",
        externalId: "ext-group-1",
        memberIds: ["u9"],
      },
    });
  });

  it("avviser ukjente paths", () => {
    const operations = parseScimGroupPatch({
      Operations: [{ op: "replace", path: "members.value", value: "u1" }],
    });
    expect(operations.ok).toBe(true);
    if (!operations.ok) return;
    expect(applyScimGroupPatch(base, operations.data)).toMatchObject({
      ok: false,
      scimType: "noTarget",
    });
  });
});
