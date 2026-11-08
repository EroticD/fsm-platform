// i18n-ignore-file: jobbtilstander er tekniske data, ikke UI-tekst.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  TRANSFER_ERROR,
  TRANSFER_KIND,
  TRANSFER_LIMITS,
  TRANSFER_STATUS,
  TRANSFER_TERMINAL_STATUSES,
} from "./constants";
import {
  EXPORT_DEDUPE_WINDOW_MS,
  EXPORT_STALE_RUNNING_MS,
} from "./export-request";
import {
  TRANSFER_ROOT_KEY,
  ensureJobStaging,
  jobStagingKey,
  jobStagingPrefix,
} from "./paths";
import { getStorageDriver } from "@/lib/storage";
import { reconcileTransferFiles } from "./reconcile";

export { ensureJobStaging, jobStagingPrefix };

export async function writeStagedPackage(
  jobId: string,
  buffer: Buffer,
): Promise<string> {
  await ensureJobStaging(jobId);
  const key = jobStagingKey(jobId, "package.zip");
  await getStorageDriver().write(key, buffer, {
    contentType: "application/zip",
    cacheControl: "private, no-store",
  });
  return key;
}

export async function readStagedPackage(jobId: string): Promise<Buffer | null> {
  try {
    const storage = getStorageDriver();
    const key = jobStagingKey(jobId, "package.zip");
    const stat = await storage.stat(key);
    if (!stat || stat.size > TRANSFER_LIMITS.maxPackageBytes) return null;
    return await storage.read(key);
  } catch {
    return null;
  }
}

export async function removeJobStaging(jobId: string): Promise<void> {
  try {
    const storage = getStorageDriver();
    const prefix = jobStagingPrefix(jobId);
    for (const object of await storage.list(prefix)) {
      await storage.delete(object.key).catch(() => undefined);
    }
  } catch {
    // Best effort. En orkestrert opprydding prøver igjen senere.
  }
}

export async function createTransferJob(input: {
  actorId: string;
  kind: (typeof TRANSFER_KIND)[keyof typeof TRANSFER_KIND];
  status?: string;
  customerIds?: string[];
  packageChecksum?: string;
  sourceInstanceId?: string;
  schemaVersion?: string;
  stagingPath?: string;
  expiresAt?: Date;
}) {
  return prisma.customerTransferJob.create({
    data: {
      actorId: input.actorId,
      kind: input.kind,
      status: input.status ?? TRANSFER_STATUS.pending,
      ...(input.customerIds ? { customerIdsJson: input.customerIds } : {}),
      ...(input.packageChecksum ? { packageChecksum: input.packageChecksum } : {}),
      ...(input.sourceInstanceId ? { sourceInstanceId: input.sourceInstanceId } : {}),
      ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}),
      ...(input.stagingPath ? { stagingPath: input.stagingPath } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
  });
}

export async function findJobForActor(jobId: string, actorId: string) {
  return prisma.customerTransferJob.findFirst({
    where: { id: jobId, actorId },
  });
}

export type CustomerTransferJobRecord = Awaited<
  ReturnType<typeof findJobForActor>
>;

/** Leser idempotensfingeren som ligger i resultJson (ingen egen kolonne). */
export function jobRequestFingerprint(job: {
  resultJson: unknown;
}): string | null {
  const value = (job.resultJson as { requestFingerprint?: unknown } | null)
    ?.requestFingerprint;
  return typeof value === "string" ? value : null;
}

type ReusableJob = NonNullable<CustomerTransferJobRecord>;

function reusableExportWhere(actorId: string, now: Date) {
  return {
    actorId,
    kind: TRANSFER_KIND.export,
    status: { in: [TRANSFER_STATUS.pending, TRANSFER_STATUS.ready] },
    createdAt: {
      gte: new Date(now.getTime() - EXPORT_DEDUPE_WINDOW_MS),
    },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

function isReusable(
  job: ReusableJob,
  fingerprint: string,
  now: Date,
): boolean {
  if (jobRequestFingerprint(job) !== fingerprint) return false;
  // En READY-jobb kan gjenbrukes hele dedupe-vinduet. En PENDING-jobb som har
  // stått urørt lenge, er sannsynligvis forlatt og skal ikke blokkere et nytt
  // forsøk.
  if (job.status === TRANSFER_STATUS.ready) return true;
  return job.createdAt.getTime() >= now.getTime() - EXPORT_STALE_RUNNING_MS;
}

/** Finner en nylig, gjenbrukbar eksport uten å opprette eller telle noe. */
export async function findReusableExportJob(input: {
  actorId: string;
  fingerprint: string;
  now?: Date;
}): Promise<ReusableJob | null> {
  const now = input.now ?? new Date();
  const jobs = await prisma.customerTransferJob.findMany({
    where: reusableExportWhere(input.actorId, now),
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return jobs.find((job) => isReusable(job, input.fingerprint, now)) ?? null;
}

/**
 * Atomisk «finn eller opprett» for eksportjobber.
 *
 * Advisory-låsen serialiserer samtidige forespørsler for samme aktør og
 * bestilling. Den første oppretter jobben; duplikater får samme rad tilbake.
 * Låsen er transaksjonsbundet og slippes før den tunge pakkebyggingen starter.
 */
export async function claimExportJob(input: {
  actorId: string;
  fingerprint: string;
  customerIds: string[];
  expiresAt: Date;
  now?: Date;
  /** Valgsnapshot for workeren. Inneholder bare id-er og boolske valg. */
  exportOptions?: Record<string, unknown>;
}): Promise<{ job: ReusableJob; reused: boolean }> {
  const now = input.now ?? new Date();
  const lockKey = `customer-transfer-export:${input.actorId}:${input.fingerprint}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked`;

    const jobs = await tx.customerTransferJob.findMany({
      where: reusableExportWhere(input.actorId, now),
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const existing = jobs.find((job) =>
      isReusable(job, input.fingerprint, now),
    );
    if (existing) return { job: existing, reused: true };

    const job = await tx.customerTransferJob.create({
      data: {
        actorId: input.actorId,
        kind: TRANSFER_KIND.export,
        status: TRANSFER_STATUS.pending,
        customerIdsJson: input.customerIds,
        resultJson: {
          requestFingerprint: input.fingerprint,
          ...(input.exportOptions
            ? {
                exportOptions: input.exportOptions as Prisma.InputJsonValue,
              }
            : {}),
        },
        expiresAt: input.expiresAt,
      },
    });
    return { job, reused: false };
  });
}

export function isJobExpired(job: {
  expiresAt: Date | null;
  status: string;
}): boolean {
  if (
    job.status === TRANSFER_STATUS.completed ||
    job.status === TRANSFER_STATUS.ready ||
    job.status === TRANSFER_STATUS.dryRun ||
    job.status === TRANSFER_STATUS.staged
  ) {
    return Boolean(job.expiresAt && job.expiresAt.getTime() <= Date.now());
  }
  return false;
}

export function previewToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function previewTokenValid(
  job: {
    previewTokenHash: string | null;
    previewExpiresAt: Date | null;
    packageChecksum: string | null;
  },
  token: string,
  checksum: string,
): boolean {
  if (!job.previewTokenHash || !job.previewExpiresAt) return false;
  if (job.previewExpiresAt.getTime() <= Date.now()) return false;
  if (job.packageChecksum !== checksum) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(job.previewTokenHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Sletter utløpte eksportartefakter og staging for avbrutte/feilede importer.
 * Returnerer antall jobber som ble ryddet. Trygg å kjøre flere ganger.
 */
export async function cleanupExpiredTransfers(now = new Date()): Promise<number> {
  // Avstem sluttfiler før staging slettes. En krasjet import kan ha skrevet
  // filer uten DB-rad, og fillisten ligger nettopp i stagingmappen.
  await reconcileTransferFiles({ now });

  const expired = await prisma.customerTransferJob.findMany({
    where: {
      expiresAt: { lt: now },
      status: {
        in: [
          TRANSFER_STATUS.pending,
          TRANSFER_STATUS.queued,
          TRANSFER_STATUS.staged,
          TRANSFER_STATUS.dryRun,
          TRANSFER_STATUS.ready,
          TRANSFER_STATUS.failed,
          TRANSFER_STATUS.aborted,
          TRANSFER_STATUS.completed,
        ],
      },
    },
    select: { id: true },
  });

  for (const job of expired) {
    await removeJobStaging(job.id);
  }

  if (expired.length > 0) {
    await prisma.customerTransferJob.updateMany({
      where: { id: { in: expired.map((job) => job.id) } },
      data: {
        status: TRANSFER_STATUS.expired,
        stagingPath: null,
        previewTokenHash: null,
        previewExpiresAt: null,
      },
    });
  }

  // Fjern også kataloger som ikke lenger har en levende jobb (f.eks. etter en
  // krasj). Vi sletter bare under .transfer, aldri vanlige opplastinger.
  const active = await prisma.customerTransferJob.findMany({
    where: {
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    select: { id: true },
  });
  const activeIds = new Set(active.map((job) => job.id));
  try {
    const storage = getStorageDriver();
    const objects = await storage.list(TRANSFER_ROOT_KEY);
    const jobIds = new Set(
      objects
        .map((object) => object.key.slice(TRANSFER_ROOT_KEY.length + 1).split("/")[0])
        .filter((id) => Boolean(id)),
    );
    for (const jobId of jobIds) {
      if (activeIds.has(jobId)) continue;
      for (const object of objects.filter((candidate) =>
        candidate.key.startsWith(`${TRANSFER_ROOT_KEY}/${jobId}/`),
      )) {
        await storage.delete(object.key).catch(() => undefined);
      }
    }
  } catch {
    // Ingen staging ennå.
  }

  await pruneTransferJobRows(now);
  return expired.length;
}

/**
 * Retensjon for selve jobbradene. Artefaktene forsvinner etter 24 timer, men
 * revisjonssporet (jobbid, sjekksum-prefiks, antall, feilkoder) beholdes
 * lenger. Eksportjobber ryddes før importjobber fordi importledgeren kan ha
 * verdi ved support/reklamasjon. Ingen av JSON-feltene inneholder PII.
 */
function retentionDaysFor(kind: string): number {
  const fallback = kind === TRANSFER_KIND.import ? 365 : 90;
  const configured = Number.parseInt(
    process.env.CUSTOMER_TRANSFER_JOB_RETENTION_DAYS ?? "",
    10,
  );
  return Number.isFinite(configured) && configured >= 1
    ? configured
    : fallback;
}

async function pruneTransferJobRows(now: Date): Promise<number> {
  let deleted = 0;
  for (const kind of [TRANSFER_KIND.export, TRANSFER_KIND.import]) {
    const cutoff = new Date(
      now.getTime() - retentionDaysFor(kind) * 24 * 60 * 60_000,
    );
    const result = await prisma.customerTransferJob.deleteMany({
      where: {
        kind,
        status: { in: [...TRANSFER_TERMINAL_STATUSES] },
        OR: [
          { completedAt: { lt: cutoff } },
          { completedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    deleted += result.count;
  }
  if (deleted > 0) {
    logger.info("Pruned expired customer transfer job rows", { deleted });
  }
  return deleted;
}

export async function abortJob(jobId: string): Promise<boolean> {
  // Betinget overgang: en import som nettopp fullførte i en annen transaksjon
  // skal ikke kunne overskrives til ABORTED. Da beholder vi resultatet.
  const updated = await prisma.customerTransferJob.updateMany({
    where: {
      id: jobId,
      status: { not: TRANSFER_STATUS.completed },
    },
    data: {
      status: TRANSFER_STATUS.aborted,
      stagingPath: null,
      previewTokenHash: null,
      previewExpiresAt: null,
      completedAt: new Date(),
    },
  });
  if (updated.count === 0) return false;
  await removeJobStaging(jobId);
  return true;
}

export function transferError(
  code: (typeof TRANSFER_ERROR)[keyof typeof TRANSFER_ERROR],
  pathValue: string,
  messageKey: string,
) {
  return { code, path: pathValue, messageKey };
}
