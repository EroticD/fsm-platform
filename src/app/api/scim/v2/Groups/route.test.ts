import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/server/scim-tokens", () => ({
  authenticateScimRequest: mocks.auth,
  scimActorFromToken: (token: {
    id: string;
    name: string;
    createdById: string | null;
  }) => ({
    tokenId: token.id,
    tokenName: token.name,
    createdById: token.createdById,
  }),
}));
vi.mock("@/server/scim-groups", () => ({
  listScimGroups: mocks.list,
  createScimGroup: mocks.create,
}));

import { GET, POST } from "./route";

const authorized = {
  ok: true,
  token: {
    id: "token-1",
    name: "Entra",
    prefix: "scim_abcdefgh",
    createdById: "admin-1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(authorized);
  mocks.list.mockResolvedValue({
    ok: true,
    data: { totalResults: 0, resources: [] },
  });
  mocks.create.mockResolvedValue({
    ok: true,
    data: { id: "g1", displayName: "FSM-Office" },
  });
});

describe("GET /api/scim/v2/Groups", () => {
  it("returnerer ListResponse med filter og paginering", async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: {
        totalResults: 3,
        resources: [{ id: "g1" }, { id: "g2" }],
      },
    });
    const response = await GET(
      new Request(
        "https://fsm.example/api/scim/v2/Groups?startIndex=2&count=2&filter=displayName%20co%20%22FSM%22",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await response.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 3,
      startIndex: 2,
      itemsPerPage: 2,
    });
    expect(mocks.list).toHaveBeenCalledWith(
      {
        filter: 'displayName co "FSM"',
        startIndex: 2,
        count: 2,
      },
      "https://fsm.example",
    );
  });

  it("sender SCIM-feilformat videre", async () => {
    mocks.list.mockResolvedValue({
      ok: false,
      status: 400,
      detail: "Ugyldig SCIM-filter.",
      scimType: "invalidFilter",
    });
    const response = await GET(
      new Request("https://fsm.example/api/scim/v2/Groups?filter=x"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidFilter",
    });
  });
});

describe("POST /api/scim/v2/Groups", () => {
  it("oppretter gruppe med 201 og Location", async () => {
    const response = await POST(
      new Request("https://fsm.example/api/scim/v2/Groups", {
        method: "POST",
        headers: { "content-type": "application/scim+json" },
        body: JSON.stringify({
          displayName: "FSM-Office",
          members: [{ value: "u1" }],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      "https://fsm.example/api/scim/v2/Groups/g1",
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "FSM-Office" }),
      { tokenId: "token-1", tokenName: "Entra", createdById: "admin-1" },
    );
  });
});
