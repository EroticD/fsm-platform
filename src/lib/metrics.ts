import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/uploads";

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

  const [documentPending, documentFailed, smsDeadLetter, smsFailed, notificationEmailFailed] =
    await Promise.all([
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
