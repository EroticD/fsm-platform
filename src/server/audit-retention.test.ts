import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    auditRetentionSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    auditHold: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    auditLog: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  cleanupExpiredAuditLogs,
  parseAuditRetentionDays,
  saveAuditRetention,
  setAuditHold,
} from "./audit-retention";
import { auditHashesForRow } from "@/lib/audit-chain";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "admin",
    name: "Admin",
    email: "admin@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: null,
    ...overrides,
  };
}

type Candidate = {
  id: string;
  entityType: string;
  entityId: string;
  hash: string | null;
  createdAt: Date;
};

function candidate(
  id: string,
  entityType = "WorkOrder",
  entityId = `wo-${id}`,
  hash: string | null = `hash-${id}`,
): Candidate {
  return {
    id,
    entityType,
    entityId,
    hash,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
  };
}

function cleanupClient(
  candidates: Candidate[],
  options: {
    holds?: Array<{
      auditLogId: string | null;
      entityType: string | null;
      entityId: string | null;
    }>;
    heldWorkOrders?: string[];
    heldReports?: string[];
    retentionDays?: number;
  } = {},
) {
  const deleted: string[][] = [];
  const tombstones: string[] = [];
  const auditCreations: unknown[] = [];
  let findManyCalls = 0;
  const client = {
    auditRetentionSetting: {
      findUnique: vi.fn(async () => ({
        id: "default",
        retentionDays: options.retentionDays ?? 30,
      })),
    },
    auditLog: {
      findMany: vi.fn(async () => {
        findManyCalls += 1;
        return findManyCalls === 1 ? candidates : [];
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        deleted.push(args.where.id.in);
        return { count: args.where.id.in.length };
      }),
      findFirst: vi.fn(async (): Promise<{ hash: string } | null> => null),
      create: vi.fn(async (args: unknown) => {
        auditCreations.push(args);
        return {};
      }),
    },
    auditHold: {
      findMany: vi.fn(async () => options.holds ?? []),
    },
    auditPurgedHash: {
      createMany: vi.fn(async (args: { data: { hash: string }[] }) => {
        tombstones.push(...args.data.map((row) => row.hash));
        return { count: args.data.length };
      }),
    },
    workOrder: {
      findMany: vi.fn(async () =>
        (options.heldWorkOrders ?? []).map((id) => ({ id })),
      ),
    },
    report: {
      findMany: vi.fn(async () =>
        (options.heldReports ?? []).map((id) => ({ id })),
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(client),
    ),
  };
  return { client, deleted, tombstones, auditCreations };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retensjon for revisjonsloggen", () => {
  it("validerer grenser for oppbevaringstid", () => {
    expect(parseAuditRetentionDays("0")).toBe(0);
    expect(parseAuditRetentionDays("1")).toBe(1);
    expect(parseAuditRetentionDays("3650")).toBe(3650);
    expect(parseAuditRetentionDays("3651")).toBeNull();
    expect(parseAuditRetentionDays("1.5")).toBeNull();
    expect(parseAuditRetentionDays("")).toBeNull();
  });

  it("purrer rader eldre enn fristen, men ikke rader på fristen", async () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    const { client, deleted, tombstones } = cleanupClient([candidate("a")], {
      retentionDays: 30,
    });

    const result = await cleanupExpiredAuditLogs(now, client as never);

    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    expect(client.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: cutoff } },
      }),
    );
    expect(result).toMatchObject({
      deleted: 1,
      held: 0,
      retentionDays: 30,
      disabled: false,
    });
    expect(deleted).toEqual([["a"]]);
    expect(tombstones).toEqual(["hash-a"]);
  });

  it("respekterer hold på logg, entitet og oppdrag/rapport", async () => {
    const rows = [
      candidate("held-log"),
      candidate("held-entity", "Customer", "cust-1"),
      candidate("held-wo", "WorkOrder", "wo-held"),
      candidate("held-report", "Report", "report-held"),
      candidate("free"),
    ];
    const { client, deleted } = cleanupClient(rows, {
      holds: [
        { auditLogId: "held-log", entityType: null, entityId: null },
        { auditLogId: null, entityType: "Customer", entityId: "cust-1" },
      ],
      heldWorkOrders: ["wo-held"],
      heldReports: ["report-held"],
    });

    const result = await cleanupExpiredAuditLogs(
      new Date("2026-11-02T12:00:00.000Z"),
      client as never,
    );

    expect(result).toMatchObject({ deleted: 1, held: 4 });
    expect(deleted).toEqual([["free"]]);
  });

  it("sletter ingenting når alle rader er holdt", async () => {
    const { client, deleted, auditCreations } = cleanupClient(
      [candidate("held")],
      { holds: [{ auditLogId: "held", entityType: null, entityId: null }] },
    );

    const result = await cleanupExpiredAuditLogs(
      new Date("2026-11-02T12:00:00.000Z"),
      client as never,
    );

    expect(result.deleted).toBe(0);
    expect(result.held).toBe(1);
    expect(deleted).toEqual([]);
    expect(auditCreations).toHaveLength(0);
  });

  it("skriver purringen til revisjonsloggen med hash", async () => {
    const { client, auditCreations } = cleanupClient([candidate("a")]);
    client.auditLog.findFirst.mockResolvedValue({ hash: "forrige" });

    await cleanupExpiredAuditLogs(
      new Date("2026-11-02T12:00:00.000Z"),
      client as never,
    );

    expect(auditCreations).toHaveLength(1);
    const data = (auditCreations[0] as { data: Record<string, unknown> }).data;
    expect(data.entityType).toBe("AuditLog");
    expect(data.prevHash).toBe("forrige");
    expect(typeof data.hash).toBe("string");
  });

  it("gjør ingenting når retensjonen er slått av", async () => {
    const { client } = cleanupClient([candidate("a")], { retentionDays: 0 });

    const result = await cleanupExpiredAuditLogs(
      new Date("2026-11-02T12:00:00.000Z"),
      client as never,
    );

    expect(result.disabled).toBe(true);
    expect(client.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe("administrasjon av retensjon og hold", () => {
  it("nekter ikke-administrator å lagre retensjon", async () => {
    const result = await saveAuditRetention(
      actor({ role: "OFFICE" }),
      "30",
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lagrer retensjon og logger endringen", async () => {
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => unknown) =>
        callback(mocks.prisma),
    );
    mocks.prisma.auditRetentionSetting.findUnique.mockResolvedValue({
      id: "default",
      retentionDays: 90,
    });
    mocks.prisma.auditRetentionSetting.upsert.mockResolvedValue({});
    mocks.prisma.auditLog.create.mockResolvedValue({});
    mocks.prisma.auditLog.findFirst.mockResolvedValue(null);

    const result = await saveAuditRetention(actor(), "90");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.auditRetentionSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "default" },
        update: expect.objectContaining({ retentionDays: 90 }),
      }),
    );
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: expect.stringContaining("90 dager"),
        }),
      }),
    );
  });

  it("krever grunn og mål for bevaringsplikt", async () => {
    expect(
      await setAuditHold(actor(), { auditLogId: "log-1", reason: "k" }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await setAuditHold(actor(), { reason: "En god grunn" }),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("nekter ikke-administrator å sette hold", async () => {
    const result = await setAuditHold(actor({ role: "OFFICE" }), {
      auditLogId: "log-1",
      reason: "Bevis i sak",
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("hash-kjeden er deterministisk for samme rad", () => {
    const fields = {
      entityType: "WorkOrder",
      entityId: "wo-1",
      action: "Test",
      userName: "Admin",
      actorId: "admin",
      departmentId: null,
      metadata: { b: 2, a: 1 },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(auditHashesForRow(fields, null)).toEqual(
      auditHashesForRow(fields, null),
    );
  });
});
