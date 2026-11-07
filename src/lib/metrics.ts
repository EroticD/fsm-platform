import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/uploads";
import {
  slaCleanupEnabled,
  slaCleanupIntervalMs,
  slaCleanupMaxAgeMs,
} from "@/lib/sla-cleanup-config";

/**
 * Driftsmålinger for Prometheus/eksterne prober. Endepunktet som bruker
 * dette er beskyttet med METRICS_SECRET.
 */

export type DiskUsage = {
  totalBytes: number;
  freeBytes: number;
  usedRatio: number;
};

export type BackupStatus = {
  available: boolean;
  ageSeconds: number | null;
  fresh: boolean;
  maxAgeSeconds: number;
};

export type SlaCleanupStatus = {
  enabled: boolean;
  intervalSeconds: number;
  lastRunAt: string | null;
  ageSeconds: number | null;
  lastStatus: "never" | "running" | "succeeded" | "failed";
  lastScanned: number;
  lastCancelled: number;
  failedRuns24h: number;
  /** Sann når oppryddingen er på og siste kjøring er eldre enn toleransen. */
  stale: boolean;
};

export type MetricsSnapshot = {
  time: string;
  ok: boolean;
  ready: boolean;
  database: "up" | "down";
  uploads: "writable" | "unwritable";
  disk: DiskUsage | null;
  queue: {
    documentPending: number;
    documentFailed: number;
    smsDeadLetter: number;
    smsFailed: number;
    notificationEmailFailed: number;
  };
  slaCleanup: SlaCleanupStatus;
  backup: BackupStatus;
  process: {
    uptimeSeconds: number;
    pid: number;
  };
};

export type MetricsPrisma = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  documentJob: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  smsMessage: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  notification: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  slaCleanupRun: {
    findFirst(args: {
      orderBy: { startedAt: "desc" };
      select: {
        startedAt: true;
        finishedAt: true;
        status: true;
        scanned: true;
        cancelled: true;
      };
    }): Promise<{
      startedAt: Date;
      finishedAt: Date | null;
      status: string;
      scanned: number;
      cancelled: number;
    } | null>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

export type CollectMetricsOptions = {
  prisma: MetricsPrisma;
  env?: Record<string, string | undefined>;
  now?: Date;
  uploadDir?: string;
  mkdir?: (dir: string, options: { recursive: true }) => Promise<unknown>;
  access?: (file: string, mode: number) => Promise<unknown>;
  statfs?: (file: string) => Promise<{
    bsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
  }>;
  readFile?: (file: string, encoding: "utf8") => Promise<string>;
};

const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;

export function backupMaxAgeSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number.parseInt(env.BACKUP_MAX_AGE_HOURS ?? "", 10);
  const hours =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_BACKUP_MAX_AGE_HOURS;
  return hours * 60 * 60;
}

export function backupStatusPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.BACKUP_STATUS_FILE?.trim();
  if (explicit) return explicit;
  return path.join(
    env.MONITORING_DIR?.trim() || "/app/monitoring",
    "backup-status.json",
  );
}

export function diskUsageFromStatfs(stat: {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}): DiskUsage | null {
  const blockSize = Number(stat.bsize);
  const blocks = Number(stat.blocks);
  const freeBlocks = Number(stat.bfree);
  const availableBlocks = Number(stat.bavail);
  if (
    !Number.isFinite(blockSize) ||
    !Number.isFinite(blocks) ||
    !Number.isFinite(freeBlocks) ||
    !Number.isFinite(availableBlocks) ||
    blockSize <= 0 ||
    blocks <= 0
  ) {
    return null;
  }

  const usedRatio = Math.min(
    1,
    Math.max(0, (blocks - freeBlocks) / blocks),
  );
  return {
    totalBytes: blocks * blockSize,
    freeBytes: Math.max(0, availableBlocks) * blockSize,
    usedRatio: Math.round(usedRatio * 10_000) / 10_000,
  };
}

export async function readBackupStatus(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
  readFile: (file: string, encoding: "utf8") => Promise<string> = fs.readFile,
): Promise<BackupStatus> {
  const maxAgeSeconds = backupMaxAgeSeconds(env);
  const file = backupStatusPath(env);
  try {
    // Stien er bevisst konfigurerbar (BACKUP_STATUS_FILE), ikke en del av
    // bygget. Uten turbopackIgnore tracer Turbopack hele prosjektet.
    const parsed = JSON.parse(
      await readFile(/* turbopackIgnore: true */ file, "utf8"),
    ) as {
      completedAt?: unknown;
    };
    const completedAt =
      typeof parsed.completedAt === "string"
        ? Date.parse(parsed.completedAt)
        : Number.NaN;
    if (!Number.isFinite(completedAt)) throw new Error("completedAt mangler");
    const ageSeconds = Math.max(
      0,
      Math.floor((now.getTime() - completedAt) / 1000),
    );
    return {
      available: true,
      ageSeconds,
      fresh: ageSeconds <= maxAgeSeconds,
      maxAgeSeconds,
    };
  } catch {
    // Manglende eller korrupt statusfil er ikke «fersk». Alerten skal fyre,
    // ikke ties i hjel av at filen aldri ble skrevet.
    return {
      available: false,
      ageSeconds: null,
      fresh: false,
      maxAgeSeconds,
    };
  }
}

async function safeCount(
  count: (args: { where: Record<string, unknown> }) => Promise<number>,
  where: Record<string, unknown>,
): Promise<number> {
  try {
    return await count({ where });
  } catch {
    return 0;
  }
}

async function safeLatestSlaCleanup(
  findFirst: MetricsPrisma["slaCleanupRun"]["findFirst"],
): Promise<Awaited<ReturnType<MetricsPrisma["slaCleanupRun"]["findFirst"]>>> {
  try {
    return await findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        startedAt: true,
        finishedAt: true,
        status: true,
        scanned: true,
        cancelled: true,
      },
    });
  } catch {
    return null;
  }
}

function slaCleanupStatus(
  last: Awaited<ReturnType<MetricsPrisma["slaCleanupRun"]["findFirst"]>>,
  failedRuns24h: number,
  env: Record<string, string | undefined>,
  now: Date,
): SlaCleanupStatus {
  const enabled = slaCleanupEnabled(env);
  const lastStatus: SlaCleanupStatus["lastStatus"] = !last
    ? "never"
    : last.status === "SUCCEEDED"
      ? "succeeded"
      : last.status === "FAILED"
        ? "failed"
        : "running";
  const ageSeconds = last
    ? Math.max(0, Math.floor((now.getTime() - last.startedAt.getTime()) / 1000))
    : null;
  const stale =
    enabled &&
    (ageSeconds === null || ageSeconds * 1000 > slaCleanupMaxAgeMs(env));

  return {
    enabled,
    intervalSeconds: Math.round(slaCleanupIntervalMs(env) / 1000),
    lastRunAt: last?.startedAt.toISOString() ?? null,
    ageSeconds,
    lastStatus,
    lastScanned: last?.scanned ?? 0,
    lastCancelled: last?.cancelled ?? 0,
    failedRuns24h,
    stale,
  };
}

export async function collectMetrics({
  prisma,
  env = process.env,
  now = new Date(),
  uploadDir: directory = uploadDir(),
  mkdir = fs.mkdir,
  access = fs.access,
  statfs = fs.statfs,
  readFile = fs.readFile,
}: CollectMetricsOptions): Promise<MetricsSnapshot> {
  let database: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  let uploads: "writable" | "unwritable" = "unwritable";
  let disk: DiskUsage | null = null;
  try {
    await mkdir(directory, { recursive: true });
    await access(directory, constants.W_OK);
    uploads = "writable";
    disk = diskUsageFromStatfs(await statfs(directory));
  } catch {
    uploads = "unwritable";
  }

  const [
    documentPending,
    documentFailed,
    smsDeadLetter,
    smsFailed,
    notificationEmailFailed,
    lastSlaCleanup,
    slaCleanupFailures,
  ] = await Promise.all([
    safeCount(prisma.documentJob.count, { status: "PENDING" }),
    safeCount(prisma.documentJob.count, { status: "FAILED" }),
    safeCount(prisma.smsMessage.count, { status: "DEAD_LETTER" }),
    safeCount(prisma.smsMessage.count, { status: "FAILED" }),
    // Etter fem forsøk gir varselworkeren opp og lar emailSentAt være null.
    // Det er en permanent feil, ikke en forbigående SMTP-blip.
    safeCount(prisma.notification.count, {
      emailSentAt: null,
      emailError: { not: null },
      emailAttempts: { gte: 5 },
    }),
    safeLatestSlaCleanup(prisma.slaCleanupRun.findFirst),
    safeCount(prisma.slaCleanupRun.count, {
      status: "FAILED",
      startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    }),
  ]);

  const ready = database === "up" && uploads === "writable";
  return {
    time: now.toISOString(),
    ok: ready,
    ready,
    database,
    uploads,
    disk,
    queue: {
      documentPending,
      documentFailed,
      smsDeadLetter,
      smsFailed,
      notificationEmailFailed,
    },
    slaCleanup: slaCleanupStatus(
      lastSlaCleanup,
      slaCleanupFailures,
      env,
      now,
    ),
    backup: await readBackupStatus(env, now, readFile),
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    },
  };
}

function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "0";
}

export function serializePrometheus(snapshot: MetricsSnapshot): string {
  const lines: string[] = [
    "# HELP fsm_up Endepunktet svarer (1 = ja).",
    "# TYPE fsm_up gauge",
    "fsm_up 1",
    "# HELP fsm_ready Appen er klar (database og opplastingsvolum).",
    "# TYPE fsm_ready gauge",
    `fsm_ready ${snapshot.ready ? 1 : 0}`,
    "# HELP fsm_database_up Databasen svarer.",
    "# TYPE fsm_database_up gauge",
    `fsm_database_up ${snapshot.database === "up" ? 1 : 0}`,
    "# HELP fsm_uploads_writable Opplastingsvolumet er skrivbart.",
    "# TYPE fsm_uploads_writable gauge",
    `fsm_uploads_writable ${snapshot.uploads === "writable" ? 1 : 0}`,
    "# HELP fsm_disk_used_ratio Brukt andel av opplastingsvolumet.",
    "# TYPE fsm_disk_used_ratio gauge",
    `fsm_disk_used_ratio ${num(snapshot.disk?.usedRatio)}`,
    "# HELP fsm_disk_free_bytes Ledige bytes på opplastingsvolumet.",
    "# TYPE fsm_disk_free_bytes gauge",
    `fsm_disk_free_bytes ${num(snapshot.disk?.freeBytes)}`,
    "# HELP fsm_document_jobs Dokumentjobber etter status.",
    "# TYPE fsm_document_jobs gauge",
    `fsm_document_jobs{status="pending"} ${snapshot.queue.documentPending}`,
    `fsm_document_jobs{status="failed"} ${snapshot.queue.documentFailed}`,
    "# HELP fsm_sms_messages SMS-meldinger etter status.",
    "# TYPE fsm_sms_messages gauge",
    `fsm_sms_messages{status="dead_letter"} ${snapshot.queue.smsDeadLetter}`,
    `fsm_sms_messages{status="failed"} ${snapshot.queue.smsFailed}`,
    "# HELP fsm_notification_email_failures Varsler som har gitt opp e-postutsending.",
    "# TYPE fsm_notification_email_failures gauge",
    `fsm_notification_email_failures ${snapshot.queue.notificationEmailFailed}`,
    "# HELP fsm_sla_cleanup_enabled Automatisk SLA-opprydding er slått på.",
    "# TYPE fsm_sla_cleanup_enabled gauge",
    `fsm_sla_cleanup_enabled ${snapshot.slaCleanup.enabled ? 1 : 0}`,
    "# HELP fsm_sla_cleanup_last_run_timestamp_seconds Når siste opprydding startet (unix-tid, 0 = aldri).",
    "# TYPE fsm_sla_cleanup_last_run_timestamp_seconds gauge",
    `fsm_sla_cleanup_last_run_timestamp_seconds ${num(
      snapshot.slaCleanup.lastRunAt
        ? Math.floor(Date.parse(snapshot.slaCleanup.lastRunAt) / 1000)
        : null,
    )}`,
    "# HELP fsm_sla_cleanup_last_cancelled Klokker kansellert i siste opprydding.",
    "# TYPE fsm_sla_cleanup_last_cancelled gauge",
    `fsm_sla_cleanup_last_cancelled ${snapshot.slaCleanup.lastCancelled}`,
    "# HELP fsm_sla_cleanup_failed_runs Feilede oppryddinger siste 24 timer.",
    "# TYPE fsm_sla_cleanup_failed_runs gauge",
    `fsm_sla_cleanup_failed_runs{window="24h"} ${snapshot.slaCleanup.failedRuns24h}`,
    "# HELP fsm_sla_cleanup_stale Siste opprydding er eldre enn toleransen.",
    "# TYPE fsm_sla_cleanup_stale gauge",
    `fsm_sla_cleanup_stale ${snapshot.slaCleanup.stale ? 1 : 0}`,
    "# HELP fsm_backup_age_seconds Alder på siste vellykkede backup.",
    "# TYPE fsm_backup_age_seconds gauge",
    `fsm_backup_age_seconds ${num(snapshot.backup.ageSeconds)}`,
    "# HELP fsm_backup_fresh Siste backup er innenfor BACKUP_MAX_AGE_HOURS.",
    "# TYPE fsm_backup_fresh gauge",
    `fsm_backup_fresh ${snapshot.backup.fresh ? 1 : 0}`,
    "# HELP fsm_process_uptime_seconds Hvor lenge prosessen har kjørt.",
    "# TYPE fsm_process_uptime_seconds gauge",
    `fsm_process_uptime_seconds ${snapshot.process.uptimeSeconds}`,
    "# HELP fsm_process_start_time_seconds Når prosessen startet (unix-tid).",
    "# TYPE fsm_process_start_time_seconds gauge",
    `fsm_process_start_time_seconds ${Math.floor(Date.parse(snapshot.time) / 1000) - snapshot.process.uptimeSeconds}`,
    "",
  ];
  return lines.join("\n");
}
