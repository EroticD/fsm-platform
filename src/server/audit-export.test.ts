import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    auditLog: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    auditPurgedHash: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { auditHashesForRow, type AuditChainRow } from "@/lib/audit-chain";
import { createZip, readZip } from "@/lib/zip";
import { exportAuditArchive, verifyAuditArchive } from "./audit-export";

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

function rows(count = 3): AuditChainRow[] {
  let prevHash: string | null = null;
  return Array.from({ length: count }, (_, index) => {
    const fields = {
      entityType: "WorkOrder",
      entityId: `wo-${index + 1}`,
      action: `Hendelse ${index + 1}`,
      userName: "Admin",
      actorId: "admin",
      departmentId: "dep-1",
      metadata: { index },
      createdAt: new Date(`2026-11-01T10:0${index}:00.000Z`),
    };
    const hashes = auditHashesForRow(fields, prevHash);
    prevHash = hashes.hash;
    return { id: `log-${index + 1}`, seq: index + 1, ...fields, ...hashes };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.auditPurgedHash.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.auditLog.findFirst.mockResolvedValue(null);
  mocks.prisma.auditLog.create.mockResolvedValue({});
  delete process.env.AUDIT_EXPORT_SIGNING_KEY;
});

describe("eksport av revisjonsloggen", () => {
  it("nekter andre enn administrator", async () => {
    const result = await exportAuditArchive(actor({ role: "OFFICE" }));
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("bygger et arkiv som verifiserer hash-kjeden", async () => {
    mocks.prisma.auditLog.findMany.mockResolvedValue(rows());

    const result = await exportAuditArchive(actor(), {
      dateFrom: new Date("2026-11-01T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fileName).toMatch(/^revisjonslogg-\d{8}-\d{6}\.zip$/);
    expect(result.data.manifest.kind).toBe("audit-log");
    expect(result.data.manifest.rowCount).toBe(3);
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "AuditLog",
          action: expect.stringContaining("3 revisjonslogger"),
        }),
      }),
    );

    const verification = verifyAuditArchive(result.data.buffer);
    expect(verification.ok).toBe(true);
    expect(verification.chainOk).toBe(true);
    expect(verification.rowsChecked).toBe(3);
  });

  it("oppdager en endret fil i arkivet", async () => {
    mocks.prisma.auditLog.findMany.mockResolvedValue(rows());
    const result = await exportAuditArchive(actor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = readZip(result.data.buffer);
    const tampered = entries.map((entry) =>
      entry.path === "audit.jsonl"
        ? {
            path: entry.path,
            data: Buffer.from(
              entry.data.toString("utf8").replace("Hendelse 2", "Endret"),
              "utf8",
            ),
          }
        : { path: entry.path, data: entry.data },
    );
    const brokenArchive = createZip(tampered);

    const verification = verifyAuditArchive(brokenArchive);

    expect(verification.ok).toBe(false);
    expect(verification.errors.join(" ")).toContain("audit.jsonl");
  });

  it("avviser ugyldige datoer", async () => {
    const result = await exportAuditArchive(actor(), {
      dateFrom: new Date("ugyldig"),
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
