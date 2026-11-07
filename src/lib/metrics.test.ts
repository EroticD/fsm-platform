import { describe, expect, it, vi } from "vitest";
import {
  backupMaxAgeSeconds,
  collectMetrics,
  diskUsageFromStatfs,
  readBackupStatus,
  serializePrometheus,
  type MetricsPrisma,
} from "./metrics";

function fakePrisma(overrides: Partial<MetricsPrisma> = {}): MetricsPrisma {
  return {
    $queryRaw: vi.fn(async () => []) as unknown as MetricsPrisma["$queryRaw"],
    documentJob: {
      count: vi.fn(async ({ where }) =>
        where.status === "FAILED" ? 2 : 1,
      ),
    },
    smsMessage: {
      count: vi.fn(async ({ where }) =>
        where.status === "DEAD_LETTER" ? 3 : 4,
      ),
    },
    notification: { count: vi.fn(async () => 5) },
    slaCleanupRun: {
      findFirst: vi.fn(async () => ({
        startedAt: new Date("2026-11-02T11:00:00.000Z"),
        finishedAt: new Date("2026-11-02T11:00:02.000Z"),
        status: "SUCCEEDED",
        scanned: 4,
        cancelled: 1,
      })),
      count: vi.fn(async () => 0),
    },
    ...overrides,
  };
}

const now = new Date("2026-11-02T12:00:00.000Z");

describe("metrics", () => {
  it("regner ut diskbruk fra statfs", () => {
    expect(
      diskUsageFromStatfs({
        bsize: 4096,
        blocks: 100,
        bfree: 25,
        bavail: 20,
      }),
    ).toEqual({
      totalBytes: 409_600,
      freeBytes: 81_920,
      usedRatio: 0.75,
    });
    expect(diskUsageFromStatfs({ bsize: 0, blocks: 0, bfree: 0, bavail: 0 })).toBeNull();
  });

  it("leser backupstatus og beregner alder", async () => {
    const status = await readBackupStatus(
      { BACKUP_STATUS_FILE: "/x/status.json", BACKUP_MAX_AGE_HOURS: "2" },
      now,
      async () => JSON.stringify({ completedAt: "2026-11-02T11:00:00.000Z" }),
    );
    expect(status).toMatchObject({
      available: true,
      ageSeconds: 3600,
      fresh: true,
      maxAgeSeconds: 7200,
    });
  });

  it("behandler manglende statusfil som ikke fersk", async () => {
    const status = await readBackupStatus(
      { BACKUP_STATUS_FILE: "/x/status.json" },
      now,
      async () => {
        throw new Error("ENOENT");
      },
    );
    expect(status).toMatchObject({ available: false, fresh: false });
    expect(backupMaxAgeSeconds({})).toBe(26 * 60 * 60);
  });

  it("samler alle signaler og lager Prometheus-linjer", async () => {
    const snapshot = await collectMetrics({
      prisma: fakePrisma(),
      env: {
        BACKUP_STATUS_FILE: "/x/status.json",
        BACKUP_MAX_AGE_HOURS: "26",
      },
      now,
      uploadDir: "/tmp/uploads",
      mkdir: async () => undefined,
      access: async () => undefined,
      statfs: async () => ({ bsize: 1000, blocks: 100, bfree: 20, bavail: 10 }),
      readFile: async () =>
        JSON.stringify({ completedAt: "2026-11-02T11:00:00.000Z" }),
    });

    expect(snapshot).toMatchObject({
      ready: true,
      queue: {
        documentPending: 1,
        documentFailed: 2,
        smsDeadLetter: 3,
        smsFailed: 4,
        notificationEmailFailed: 5,
      },
      backup: { fresh: true, ageSeconds: 3600 },
      slaCleanup: {
        enabled: true,
        lastStatus: "succeeded",
        lastCancelled: 1,
        failedRuns24h: 0,
        stale: false,
      },
    });

    const text = serializePrometheus(snapshot);
    expect(text).toContain('fsm_document_jobs{status="failed"} 2');
    expect(text).toContain('fsm_sms_messages{status="dead_letter"} 3');
    expect(text).toContain("fsm_notification_email_failures 5");
    expect(text).toContain("fsm_sla_cleanup_enabled 1");
    expect(text).toContain("fsm_sla_cleanup_last_cancelled 1");
    expect(text).toContain("fsm_sla_cleanup_stale 0");
    expect(text).toContain("fsm_backup_fresh 1");
    expect(text).toContain("fsm_disk_used_ratio 0.8");
  });

  it("melder ikke klar når databasen er nede", async () => {
    const snapshot = await collectMetrics({
      prisma: fakePrisma({
        $queryRaw: vi.fn(async () => {
          throw new Error("nede");
        }) as unknown as MetricsPrisma["$queryRaw"],
      }),
      now,
      uploadDir: "/tmp/uploads",
      mkdir: async () => undefined,
      access: async () => undefined,
      statfs: async () => ({ bsize: 1, blocks: 1, bfree: 1, bavail: 1 }),
      readFile: async () => "{}",
    });
    expect(snapshot.ready).toBe(false);
    expect(snapshot.database).toBe("down");
  });

  it("flagger SLA-oppryddingen som utdatert når den aldri har kjørt", async () => {
    const snapshot = await collectMetrics({
      prisma: fakePrisma({
        slaCleanupRun: {
          findFirst: vi.fn(async () => null),
          count: vi.fn(async () => 2),
        },
      }),
      env: { SLA_CLEANUP_INTERVAL_HOURS: "6" },
      now,
      uploadDir: "/tmp/uploads",
      mkdir: async () => undefined,
      access: async () => undefined,
      statfs: async () => ({ bsize: 1, blocks: 1, bfree: 1, bavail: 1 }),
      readFile: async () => "{}",
    });

    expect(snapshot.slaCleanup).toMatchObject({
      enabled: true,
      lastStatus: "never",
      lastRunAt: null,
      failedRuns24h: 2,
      stale: true,
      intervalSeconds: 21600,
    });
  });

  it("viser siste SLA-kjøring som fersk og respekterer av-bryteren", async () => {
    const snapshot = await collectMetrics({
      prisma: fakePrisma(),
      env: { SLA_CLEANUP_ENABLED: "false" },
      now,
      uploadDir: "/tmp/uploads",
      mkdir: async () => undefined,
      access: async () => undefined,
      statfs: async () => ({ bsize: 1, blocks: 1, bfree: 1, bavail: 1 }),
      readFile: async () => "{}",
    });

    expect(snapshot.slaCleanup).toMatchObject({
      enabled: false,
      lastStatus: "succeeded",
      stale: false,
    });
  });
});
