import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { $executeRaw: mocks.executeRaw },
}));

import { audit } from "./audit";
import {
  isRealtimeKind,
  publishRealtime,
  REALTIME_CHANNEL,
  realtimeKindForEntity,
} from "./realtime";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockResolvedValue(1);
});

describe("realtimeKindForEntity", () => {
  it.each([
    ["WorkOrder", "workorders"],
    ["Customer", "customers"],
    ["Document", "documents"],
    ["DocumentFolder", "documents"],
    ["Report", "reports"],
    ["Notification", "notifications"],
    ["User", "settings"],
    ["Department", "settings"],
    ["Branding", "settings"],
    ["UkjentType", "all"],
    ["  workOrder  ", "workorders"],
  ])("mapper %s til %s", (entityType, expected) => {
    expect(realtimeKindForEntity(entityType)).toBe(expected);
  });
});

describe("isRealtimeKind", () => {
  it("godtar bare kjente kategorier", () => {
    expect(isRealtimeKind("workorders")).toBe(true);
    expect(isRealtimeKind("all")).toBe(true);
    expect(isRealtimeKind("kunde@example.test")).toBe(false);
    expect(isRealtimeKind("")).toBe(false);
  });
});

describe("publishRealtime", () => {  it("sender pg_notify med kanal og kategori", async () => {
    await publishRealtime("workorders");

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = mocks.executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain("pg_notify");
    expect(values).toEqual([REALTIME_CHANNEL, "workorders"]);
  });

  it("svelger databasefeil og logger bare en fast melding", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.executeRaw.mockRejectedValue(
      new Error("connection refused for kunde@example.test"),
    );

    await expect(publishRealtime("customers")).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith("Realtime-varsel kunne ikke sendes");
    expect(error.mock.calls.flat().join(" ")).not.toContain(
      "kunde@example.test",
    );
    error.mockRestore();
  });

  it("hopper over klienter uten $executeRaw (testmocket transaksjon)", async () => {
    await expect(
      publishRealtime("documents", {} as never),
    ).resolves.toBeUndefined();

    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});

describe("audit", () => {
  const actor = { id: "user-1", name: "Kari", email: null };

  it("publiserer riktig kategori i samme transaksjon", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const tx = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $executeRaw: executeRaw,
    };

    await audit(tx as never, {
      entityType: "Customer",
      entityId: "customer-1",
      action: "Oppdatert",
      actor,
    });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain("pg_notify");
    expect(values).toEqual([REALTIME_CHANNEL, "customers"]);
  });

  it("feiler ikke når transaksjonsmocken mangler $executeRaw", async () => {
    const tx = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(
      audit(tx as never, {
        entityType: "WorkOrder",
        entityId: "wo-1",
        action: "Oppdatert",
        actor,
      }),
    ).resolves.toBeUndefined();
  });
});
