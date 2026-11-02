import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  backfillAuditChain,
  verifyAuditChain,
  type AuditChainRow,
} from "@/lib/audit-chain";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const entityType = "IT_AUDIT_CHAIN";

async function chainRows(): Promise<AuditChainRow[]> {
  return prisma.auditLog.findMany({
    where: { entityType },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      entityType: true,
      entityId: true,
      action: true,
      userName: true,
      actorId: true,
      departmentId: true,
      metadata: true,
      prevHash: true,
      hash: true,
      createdAt: true,
    },
  });
}

describeIntegration("revisjonslogg mot ekte database", () => {
  const entityId = unique("wo");
  let rawIds: string[] = [];

  beforeAll(async () => {
    // Integrasjonsdatabasen deles av flere filer. Start denne kjeden fra en
    // tom revisjonslogg, slik at prevHash for første rad faktisk er null.
    await prisma.auditLog.deleteMany({});
    await prisma.auditPurgedHash.deleteMany({});
    await prisma.auditHold.deleteMany({});
    await prisma.$transaction(async (tx) => {
      for (const action of ["Første", "Andre", "Tredje"]) {
        await audit(tx, {
          entityType,
          entityId,
          action,
          actor: {
            id: "it-admin",
            name: "IT Admin",
            email: null,
            departmentId: null,
          },
          metadata: { action },
        });
      }
    });
  });

  afterAll(async () => {
    await prisma.auditHold.deleteMany({
      where: { OR: [{ auditLogId: { in: rawIds } }, { entityType, entityId }] },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ entityType, entityId }, { id: { in: rawIds } }],
      },
    });
  });

  it("skriver en sammenhengende hash-kjede i samme transaksjon", async () => {
    const rows = await chainRows();
    expect(rows).toHaveLength(3);
    expect(rows[0].prevHash).toBeNull();
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);

    const result = verifyAuditChain(rows, { allowFirstAnchor: true });
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
  });

  it("oppdager endret innhold uten å skrive til databasen", async () => {
    const rows = await chainRows();
    const tampered = rows.map((row, index) =>
      index === 1 ? { ...row, action: "Endret" } : row,
    );

    const result = verifyAuditChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAt?.reason).toBe("hash_mismatch");
  });

  it("backfyller rader som mangler hash deterministisk", async () => {
    const created = await Promise.all(
      ["Eldre 1", "Eldre 2"].map((action) =>
        prisma.auditLog.create({
          data: {
            entityType,
            entityId,
            action,
            userName: "IT Admin",
            actorId: "it-admin",
            metadata: { legacy: true },
          },
          select: { id: true },
        }),
      ),
    );
    rawIds = created.map((row) => row.id);

    const result = await backfillAuditChain(prisma, { batchSize: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated).toBeGreaterThanOrEqual(2);

    const rows = await chainRows();
    const resultVerify = verifyAuditChain(rows, { allowFirstAnchor: true });
    expect(resultVerify.ok).toBe(true);
    expect(rows.every((row) => row.hash)).toBe(true);
  });
});
