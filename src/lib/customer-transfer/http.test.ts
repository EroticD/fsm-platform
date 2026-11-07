import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/modules", () => ({
  moduleEnabled: mocks.moduleEnabled,
}));

vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { guardTransferRoute, requireSameOrigin } from "./http";

describe("transfer-rutens modul- og tilgangsvakt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returnerer 404 når transfer-modulen er slått av, uten å lese sesjonen", async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const guard = await guardTransferRoute();
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(404);
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("returnerer 403 for innlogget bruker uten admin + settings.manage", async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.getCurrentUser.mockResolvedValue({
      id: "u1",
      name: "Office",
      email: "office@example.test",
      role: "OFFICE",
      isActive: true,
      departmentId: null,
      permissions: ["settings.manage"],
      permissionsCustomized: true,
      roleDefinition: { permissions: [] },
    });
    const guard = await guardTransferRoute();
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(403);
  });

  it("slipper gjennom aktiv administrator med settings.manage", async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin",
      name: "Admin",
      email: "admin@example.test",
      role: "ADMIN",
      isActive: true,
      departmentId: null,
      permissions: ["settings.manage"],
      permissionsCustomized: false,
      roleDefinition: { permissions: ["settings.manage"] },
    });
    const guard = await guardTransferRoute();
    expect(guard.ok).toBe(true);
  });

  it("avviser feil origin", () => {
    const denied = requireSameOrigin(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
    );
    expect(denied?.status).toBe(403);
  });
});
