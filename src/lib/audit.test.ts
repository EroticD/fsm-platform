import { describe, expect, it, vi } from "vitest";
import { audit } from "./audit";

function tx(lastHash: string | null) {
  return {
    $queryRaw: vi.fn(async () => []),
    auditLog: {
      findFirst: vi.fn(async () => (lastHash ? { hash: lastHash } : null)),
      create: vi.fn(async (args: unknown) => args),
    },
  };
}

describe("revisjonsskriving", () => {
  it("leser forrige hash under transaksjonslås og skriver kjeden", async () => {
    const client = tx("forrige-hash");

    await audit(client as never, {
      entityType: "WorkOrder",
      entityId: "wo-1",
      action: "Endret status",
      actor: {
        id: "user-1",
        name: "Kari",
        email: null,
        departmentId: "dep-1",
      },
      metadata: { status: "OPEN" },
    });

    expect(client.$queryRaw).toHaveBeenCalled();
    expect(client.auditLog.findFirst).toHaveBeenCalledWith({
      orderBy: { seq: "desc" },
      select: { hash: true },
    });
    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
        actorId: "user-1",
        departmentId: "dep-1",
        prevHash: "forrige-hash",
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
  });

  it("starter kjeden uten prevHash når loggen er tom", async () => {
    const client = tx(null);

    await audit(client as never, {
      entityType: "AuditLog",
      entityId: "test",
      action: "Test",
      actor: { id: "system", name: "System", email: null },
    });

    expect(client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ prevHash: null, hash: expect.any(String) }),
    });
  });
});
