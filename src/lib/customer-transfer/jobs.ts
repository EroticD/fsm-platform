// i18n-ignore-file: jobbtilstander er tekniske data, ikke UI-tekst.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";
import {
  TRANSFER_ERROR,
  TRANSFER_KIND,
  TRANSFER_LIMITS,
  TRANSFER_STATUS,
} from "./constants";

export function transferRoot(): string {
  return path.join(uploadDir(), ".transfer");
}

export function jobStagingDir(jobId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
    throw new Error("Ugyldig jobb-id");
  }
  return path.join(transferRoot(), jobId);
}

/** Oppretter staging-mappen med restriktive rettigheter (0700). */
export async function ensureJobStaging(jobId: string): Promise<string> {
  await fs.mkdir(transferRoot(), { recursive: true, mode: 0o700 });
  const directory = jobStagingDir(jobId);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export async function writeStagedPackage(
  jobId: string,
  buffer: Buffer,
): Promise<string> {
  const directory = await ensureJobStaging(jobId);
  const target = path.join(directory, "package.zip");
  const handle = await fs.open(target, "wx", 0o600);
  try {
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
  return target;
}

export async function readStagedPackage(jobId: string): Promise<Buffer | null> {
  try {
    const target = path.join(jobStagingDir(jobId), "package.zip");
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > TRANSFER_LIMITS.maxPackageBytes) return null;
    return await fs.readFile(target);
  } catch {
    return null;
  }
}

export async function removeJobStaging(jobId: string): Promise<void> {
  try {
    await fs.rm(jobStagingDir(jobId), { recursive: true, force: true });
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
  const expired = await prisma.customerTransferJob.findMany({
    where: {
      expiresAt: { lt: now },
      status: {
        in: [
          TRANSFER_STATUS.pending,
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
    const entries = await fs.readdir(transferRoot(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (activeIds.has(entry.name)) continue;
      await fs.rm(path.join(transferRoot(), entry.name), {
        recursive: true,
        force: true,
      });
    }
  } catch {
    // Mappen finnes ikke ennå.
  }

  return expired.length;
}

export async function abortJob(jobId: string): Promise<void> {
  await removeJobStaging(jobId);
  await prisma.customerTransferJob.update({
    where: { id: jobId },
    data: {
      status: TRANSFER_STATUS.aborted,
      stagingPath: null,
      previewTokenHash: null,
      previewExpiresAt: null,
      completedAt: new Date(),
    },
  });
}

export function transferError(
  code: (typeof TRANSFER_ERROR)[keyof typeof TRANSFER_ERROR],
  pathValue: string,
  messageKey: string,
) {
  return { code, path: pathValue, messageKey };
}
