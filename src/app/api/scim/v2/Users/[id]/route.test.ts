import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  patch: vi.fn(),
  deactivate: vi.fn(),
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
  getScimUser: mocks.get,
  updateScimUser: mocks.update,
  patchScimUser: mocks.patch,
  deactivateScimUser: mocks.deactivate,
}));

import { DELETE, GET, PATCH, PUT } from "./route";

const authorized = {
  ok: true,
  token: {
    id: "token-1",
    name: "Entra",
    prefix: "scim_abcdefgh",
    createdById: "admin-1",
  },
};
const context = { params: Promise.resolve({ id: "u1" }) };

function request(method: string, body?: unknown) {
  return new Request("https://fsm.example/api/scim/v2/Users/u1", {
    method,
    headers: body ? { "content-type": "application/scim+json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(authorized);
  mocks.get.mockResolvedValue({
    ok: true,
    data: { id: "u1", userName: "kari@example.no", active: true },
  });
  mocks.update.mockResolvedValue({
    ok: true,
    data: { id: "u1", userName: "kari@example.no", active: false },
  });
  mocks.patch.mockResolvedValue({
    ok: true,
    data: { id: "u1", userName: "kari@example.no", active: false },
  });
  mocks.deactivate.mockResolvedValue({ ok: true, data: null });
});

describe("GET /api/scim/v2/Users/[id]", () => {
  it("returnerer brukeren", async () => {
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "u1" });
  });

  it("returnerer 404 med SCIM-feilskjema", async () => {
    mocks.get.mockResolvedValue({
      ok: false,
      status: 404,
      detail: "Brukeren finnes ikke.",
    });
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.status).toBe("404");
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
  });
});

describe("PUT og PATCH", () => {
  it("PUT oppdaterer brukeren", async () => {
    const response = await PUT(
      request("PUT", { userName: "kari@example.no", active: false }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ userName: "kari@example.no" }),
      { tokenId: "token-1", tokenName: "Entra", createdById: "admin-1" },
    );
  });

  it("PATCH anvender operasjoner", async () => {
    const response = await PATCH(
      request("PATCH", {
        Operations: [{ op: "replace", path: "active", value: false }],
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.patch).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ Operations: expect.any(Array) }),
      { tokenId: "token-1", tokenName: "Entra", createdById: "admin-1" },
    );
  });
});

describe("DELETE", () => {
  it("deaktiverer og svarer 204 uten kropp", async () => {
    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(mocks.deactivate).toHaveBeenCalledWith("u1", {
      tokenId: "token-1",
      tokenName: "Entra",
      createdById: "admin-1",
    });
  });

  it("returnerer 403 når brukeren er beskyttet", async () => {
    mocks.deactivate.mockResolvedValue({
      ok: false,
      status: 403,
      detail: "Kundeportalbrukere kan ikke deaktiveres via SCIM.",
    });
    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.status).toBe("403");
  });
});
