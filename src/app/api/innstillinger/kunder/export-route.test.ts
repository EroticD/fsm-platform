import { describe, expect, it, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();

vi.mock("@/lib/session", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

import { POST as exportPost } from "./eksport/route";
import { POST as importPost } from "./import/route";

function request(body: unknown = {}) {
  return new Request("http://localhost/api/innstillinger/kunder/eksport", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

const base = {
  id: "u1",
  name: "Test",
  email: "test@example.test",
  departmentId: null,
  isActive: true,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: [] },
};

describe("kundeoverføring: rutevakt", () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
  });

  for (const [label, user] of [
    ["kontor med settings.manage", { ...base, role: "OFFICE", permissions: ["settings.manage"] }],
    ["montør", { ...base, role: "TECHNICIAN" }],
    ["kundeportal", { ...base, role: "CUSTOMER", customerId: "c1" }],
    ["inaktiv admin", { ...base, role: "ADMIN", isActive: false }],
  ] as const) {
    it(`gir 403 for ${label}`, async () => {
      getCurrentUser.mockResolvedValue(user);
      const response = await exportPost(request({ customerIds: ["c1"] }) as never);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("customer_transfer.forbidden");

      const importResponse = await importPost(
        new Request("http://localhost/api/innstillinger/kunder/import", {
          method: "POST",
          headers: { Origin: "http://localhost" },
          body: Buffer.from("PK\u0003\u0004"),
        }) as never,
      );
      expect(importResponse.status).toBe(403);
    });
  }

  it("gir 403 når ingen er innlogget", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await exportPost(request({ customerIds: ["c1"] }) as never);
    expect(response.status).toBe(403);
  });
});
