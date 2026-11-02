import { describe, expect, it } from "vitest";
import {
  auditHashesForRow,
  backfillAuditChain,
  computeAuditHash,
  stableJson,
  verifyAuditChain,
  type AuditChainRow,
  type AuditHashFields,
} from "./audit-chain";

function fields(overrides: Partial<AuditHashFields> = {}): AuditHashFields {
  return {
    entityType: "WorkOrder",
    entityId: "wo-1",
    action: "Endret status",
    userName: "Kari",
    actorId: "user-1",
    departmentId: "dep-1",
    metadata: { b: 2, a: 1 },
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    ...overrides,
  };
}

function chain(count: number): AuditChainRow[] {
  let prevHash: string | null = null;
  return Array.from({ length: count }, (_, index) => {
    const hashes = auditHashesForRow(
      fields({
        entityId: `wo-${index + 1}`,
        action: `Hendelse ${index + 1}`,
        createdAt: new Date(`2026-11-01T10:0${index}:00.000Z`),
      }),
      prevHash,
    );
    const row: AuditChainRow = {
      id: `log-${index + 1}`,
      seq: index + 1,
      ...fields({
        entityId: `wo-${index + 1}`,
        action: `Hendelse ${index + 1}`,
        createdAt: new Date(`2026-11-01T10:0${index}:00.000Z`),
      }),
      ...hashes,
    };
    prevHash = row.hash;
    return row;
  });
}

describe("revisjonsloggens hash-kjede", () => {
  it("gir samme hash uavhengig av nøkkelrekkefølgen i metadata", () => {
    const a = computeAuditHash(fields({ metadata: { a: 1, b: 2 } }), null);
    const b = computeAuditHash(fields({ metadata: { b: 2, a: 1 } }), null);
    expect(a).toBe(b);
    expect(stableJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it("verifiserer en komplett kjede", () => {
    const result = verifyAuditChain(chain(4));

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(4);
    expect(result.firstHash).toBe(chain(4)[0].hash);
  });

  it("oppdager at en rad er endret", () => {
    const rows = chain(3);
    rows[1] = { ...rows[1], action: "Endret av angriper" };

    const result = verifyAuditChain(rows);

    expect(result.ok).toBe(false);
    expect(result.brokenAt).toEqual({
      id: "log-2",
      seq: 2,
      reason: "hash_mismatch",
    });
  });

  it("oppdager en slettet rad uten tombstone", () => {
    const rows = chain(4);
    rows.splice(1, 1);

    const result = verifyAuditChain(rows);

    expect(result.ok).toBe(false);
    expect(result.brokenAt?.reason).toBe("prev_hash_mismatch");
  });

  it("godtar et kontrollert hull som har tombstone", () => {
    const full = chain(4);
    const removed = full.splice(1, 1)[0];

    const result = verifyAuditChain(full, {
      purgedHashes: new Set([removed.hash!]),
    });

    expect(result.ok).toBe(true);
    expect(result.purgedGaps).toBe(1);
  });

  it("godtar at et filtrert utsnitt starter med et anker", () => {
    const rows = chain(3);
    const slice = rows.slice(1);

    expect(verifyAuditChain(slice).ok).toBe(false);
    expect(verifyAuditChain(slice, { allowFirstAnchor: true }).ok).toBe(true);
  });

  it("oppdager manglende hash", () => {
    const rows = chain(2);
    rows[0] = { ...rows[0], hash: null };

    const result = verifyAuditChain(rows);

    expect(result.ok).toBe(false);
    expect(result.brokenAt?.reason).toBe("missing_hash");
  });
});

describe("backfill av revisjonsloggen", () => {
  it("skriver deterministisk kjede i seq-rekkefølge og er idempotent", async () => {
    const rows: AuditChainRow[] = chain(5).map((row) => ({
      ...row,
      prevHash: null,
      hash: null,
    }));
    const updates = new Map<string, { prevHash: string | null; hash: string }>();
    const written: AuditChainRow[] = rows.map((row) => ({ ...row }));

    const client = {
      auditLog: {
        findMany: async (args: {
          take: number;
          cursor?: { seq: number };
          skip?: number;
        }) => {
          const start = args.cursor
            ? written.findIndex((row) => row.seq === args.cursor!.seq) +
              (args.skip ?? 0)
            : 0;
          return written.slice(start, start + args.take).map((row) => ({ ...row }));
        },
        update: async (args: {
          where: { id: string };
          data: { prevHash: string | null; hash: string };
        }) => {
          updates.set(args.where.id, args.data);
          const row = written.find((item) => item.id === args.where.id);
          if (row) Object.assign(row, args.data);
          return {};
        },
      },
    };

    const first = await backfillAuditChain(client, { batchSize: 2 });
    expect(first).toMatchObject({ ok: true, updated: 5, checked: 5 });
    expect(updates.size).toBe(5);
    expect(updates.get("log-1")?.prevHash).toBeNull();

    // Kjeden som ble skrevet, verifiserer.
    expect(verifyAuditChain(written).ok).toBe(true);

    updates.clear();
    const second = await backfillAuditChain(client, { batchSize: 2 });
    expect(second).toMatchObject({ ok: true, updated: 0, checked: 5 });
    expect(updates.size).toBe(0);
  });

  it("avbryter når en eksisterende hash ikke stemmer", async () => {
    const rows = chain(2);
    rows[0] = { ...rows[0], hash: "feil" };

    const client = {
      auditLog: {
        findMany: async () => rows,
        update: async () => ({}),
      },
    };

    const result = await backfillAuditChain(client, { batchSize: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("hash_mismatch");
  });
});
