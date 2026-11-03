import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/server/scim-tokens", () => ({
  authenticateScimRequest: mocks.auth,
  scimActorFromToken: (token: { id: string; name: string; createdById: string | null }) => ({
    tokenId: token.id,
    tokenName: token.name,
    createdById: token.createdById,
  }),
}));
vi.mock("@/server/scim-users", () => ({
  listScimUsers: mocks.list,
  createScimUser: mocks.create,
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

function request(method: string, body?: unknown) {
  return new Request("https://fsm.example/api/scim/v2/Users", {
    method,
    headers: body ? { "content-type": "application/scim+json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(authorized);
  mocks.list.mockResolvedValue({ ok: true, data: { totalResults: 0, resources: [] } });
  mocks.create.mockResolvedValue({
    ok: true,
    data: { id: "u1", userName: "kari@example.no", active: false },
  });
});

describe("GET /api/scim/v2/Users", () => {
  it("returnerer SCIM ListResponse med riktig Content-Type", async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: {
        totalResults: 2,
        resources: [{ id: "u1" }, { id: "u2" }],
      },
    });
    const response = await GET(
      new Request(
        "https://fsm.example/api/scim/v2/Users?startIndex=2&count=1&filter=userName%20eq%20%22a%40b.no%22",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/scim+json");
    const body = await response.json();
    expect(body.schemas).toContain(
      "urn:ietf:params:scim:api:messages:2.0:ListResponse",
    );
    expect(body.totalResults).toBe(2);
    expect(body.startIndex).toBe(2);
    expect(mocks.list).toHaveBeenCalledWith(
      {
        filter: 'userName eq "a@b.no"',
        startIndex: 2,
        count: 1,
      },
      "https://fsm.example",
    );
  });

  it("returnerer SCIM-feil ved ugyldig filter", async () => {
    mocks.list.mockResolvedValue({
      ok: false,
      status: 400,
      detail: "Ugyldig SCIM-filter.",
      scimType: "invalidFilter",
    });
    const response = await GET(
      new Request("https://fsm.example/api/scim/v2/Users?filter=x"),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidFilter",
    });
  });

  it("sender 401 fra autentiseringen videre", async () => {
    mocks.auth.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          detail: "nei",
          status: "401",
        }),
        { status: 401, headers: { "content-type": "application/scim+json" } },
      ),
    });
    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("POST /api/scim/v2/Users", () => {
  it("oppretter bruker med 201 og Location", async () => {
    const response = await POST(
      request("POST", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "kari@example.no",
        active: false,
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      "https://fsm.example/api/scim/v2/Users/u1",
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ userName: "kari@example.no" }),
      { tokenId: "token-1", tokenName: "Entra", createdById: "admin-1" },
    );
    const body = await response.json();
    expect(body.id).toBe("u1");
  });

  it("returnerer 409 med SCIM-feilskjema ved duplikat", async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      status: 409,
      detail: "E-postadressen er allerede i bruk.",
      scimType: "uniqueness",
    });
    const response = await POST(
      request("POST", { userName: "kari@example.no" }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      scimType: "uniqueness",
    });
  });

  it("avviser ugyldig JSON med 400", async () => {
    const response = await POST(
      new Request("https://fsm.example/api/scim/v2/Users", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.status).toBe("400");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
