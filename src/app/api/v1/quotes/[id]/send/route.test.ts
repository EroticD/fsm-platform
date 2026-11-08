import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  sendQuote: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/quotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/quotes")>();
  return { ...actual, sendQuote: mocks.sendQuote };
});

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    apiKeyId: "key-1",
    actor: {
      id: "u1",
      name: "Kari",
      email: "kari@example.test",
      role: "OFFICE",
      isActive: true,
      departmentId: "dep-a",
      permissions: ["customers.manage"],
      permissionsCustomized: true,
      roleDefinition: { permissions: ["customers.manage"] },
    },
  });
  mocks.sendQuote.mockResolvedValue({
    ok: true,
    data: { token: "hemmelig", version: 2 },
  });
});

describe("POST /api/v1/quotes/{id}/send", () => {
  it("sender tilbudet uten å lekke godkjenningstokenet", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/quotes/q1/send", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "q1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: { id: "q1", status: "SENT", version: 2 },
    });
    expect(JSON.stringify(body)).not.toContain("hemmelig");
  });

  it("gir 409 når tilbudet ikke er i kladd", async () => {
    mocks.sendQuote.mockResolvedValue({ ok: false, reason: "conflict" });
    const response = await POST(
      new Request("http://localhost/api/v1/quotes/q1/send", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(response.status).toBe(409);
  });
});
