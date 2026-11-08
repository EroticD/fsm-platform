// i18n-ignore-file: avstemmingen bruker filnavn og statuser, ikke UI-tekst.
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isUploadReferenced } from "@/lib/upload-cleanup";
import { getStorageDriver } from "@/lib/storage";
import { TRANSFER_STATUS } from "./constants";
import { TRANSFER_ROOT_KEY, jobStagingKey } from "./paths";

/**
 * Avstemming av sluttfiler fra kundeoverføringer.
 *
 * Import skriver filer til lagringslaget (lokal `UPLOAD_DIR` eller S3) før
 * databasetransaksjonen committer.
 * Krasjer prosessen mellom skriving og commit, blir filene liggende uten en
 * `Upload`-rad. Vi kan ikke bruke en vanlig «slett alt uten rad»-skanner: den
 * ville også tatt filer fra andre flyter som nettopp er skrevet, men ennå ikke
 * registrert.
 *
 * Derfor skriver importen en durabel liste over de tilfeldige sluttnavnene i
 * jobbens stagingmappe før første fil skrives. Avstemmingen rører bare filer
 * som står i en slik liste, og sletter dem bare når `isUploadReferenced()`
 * bekrefter at ingen attachment, dokumentversjon, rapport, revisjon eller
 * kladd peker på dem. En referert fil slettes aldri.
 */

export const FINAL_FILES_LEDGER = "final-files.json";

const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png|webp|gif)$/i;

type LedgerFile = {
  version: 1;
  files: string[];
};

export async function writeFinalFilesLedger(
  jobId: string,
  storedNames: readonly string[],
): Promise<void> {
  const names = [...new Set(storedNames)].filter((name) =>
    STORED_NAME.test(name),
  );
  const ledger: LedgerFile = { version: 1, files: names };
  await getStorageDriver().write(
    jobStagingKey(jobId, FINAL_FILES_LEDGER),
    `${JSON.stringify(ledger)}\n`,
    { contentType: "application/json", cacheControl: "private, no-store" },
  );
}

export async function readFinalFilesLedger(
  jobId: string,
): Promise<string[]> {
  try {
    const raw = await getStorageDriver().read(
      jobStagingKey(jobId, FINAL_FILES_LEDGER),
    );
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<LedgerFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (name): name is string =>
        typeof name === "string" && STORED_NAME.test(name),
    );
  } catch {
    return [];
  }
}

async function removeLedger(jobId: string): Promise<void> {
  await getStorageDriver()
    .delete(jobStagingKey(jobId, FINAL_FILES_LEDGER))
    .catch(() => undefined);
}

export type ReconciliationResult = {
  jobs: number;
  filesDeleted: number;
  filesKept: number;
  filesMissing: number;
};

async function reconcileJob(
  jobId: string,
  options: { staleMs: number; now: Date },
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    jobs: 0,
    filesDeleted: 0,
    filesKept: 0,
    filesMissing: 0,
  };
  const names = await readFinalFilesLedger(jobId);
  if (names.length === 0) return result;

  const job = await prisma.customerTransferJob.findUnique({
    where: { id: jobId },
    select: { status: true, updatedAt: true },
  });

  // En aktiv worker kan fortsatt skrive filene. Vent til jobben er terminal
  // eller har stått stille lenger enn stale-grensen.
  if (job) {
    const isRunning = job.status === TRANSFER_STATUS.running;
    const isStale =
      options.now.getTime() - job.updatedAt.getTime() > options.staleMs;
    const isActiveWithoutFiles =
      job.status === TRANSFER_STATUS.pending ||
      job.status === TRANSFER_STATUS.queued ||
      job.status === TRANSFER_STATUS.staged;
    if ((isRunning && !isStale) || (isActiveWithoutFiles && !isStale)) {
      return result;
    }
  }

  result.jobs = 1;
  const storage = getStorageDriver();
  for (const storedName of names) {
    const url = `/uploads/${storedName}`;
    // En eksisterende Upload-rad er i seg selv en referanse. Slett aldri en
    // fil bare fordi ingen attachment peker på den ennå.
    const uploadRow = await prisma.upload.findFirst({
      where: { storedName },
      select: { id: true },
    });
    if (uploadRow || (await isUploadReferenced(url))) {
      result.filesKept += 1;
      continue;
    }
    const existed = Boolean(await storage.stat(storedName));
    if (existed) {
      try {
        await storage.delete(storedName);
      } catch {
        result.filesKept += 1; // Klarte ikke slette; prøv igjen senere.
        continue;
      }
      // En eventuell ufullstendig Upload-rad uten referanser ryddes også.
      await prisma.upload
        .deleteMany({ where: { storedName } })
        .catch(() => undefined);
      result.filesDeleted += 1;
    } else {
      result.filesMissing += 1;
    }
  }
  await removeLedger(jobId);
  return result;
}

/**
 * Går gjennom alle stagingmapper med en filliste. Trygg å kjøre flere ganger
 * og parallelt: hver fil sjekkes mot databasen like før sletting.
 */
export async function reconcileTransferFiles(options?: {
  now?: Date;
  staleMs?: number;
}): Promise<ReconciliationResult> {
  const now = options?.now ?? new Date();
  const staleMs =
    options?.staleMs ??
    Math.max(
      5 * 60_000,
      Number.parseInt(
        process.env.CUSTOMER_TRANSFER_STALE_JOB_MS ?? "",
        10,
      ) || 60 * 60_000,
    );

  const total: ReconciliationResult = {
    jobs: 0,
    filesDeleted: 0,
    filesKept: 0,
    filesMissing: 0,
  };

  let objects;
  try {
    objects = await getStorageDriver().list(TRANSFER_ROOT_KEY);
  } catch {
    return total;
  }

  const jobIds = new Set(
    objects
      .map((object) => object.key.slice(TRANSFER_ROOT_KEY.length + 1).split("/")[0])
      .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)),
  );

  for (const jobId of jobIds) {
    try {
      const result = await reconcileJob(jobId, { now, staleMs });
      total.jobs += result.jobs;
      total.filesDeleted += result.filesDeleted;
      total.filesKept += result.filesKept;
      total.filesMissing += result.filesMissing;
    } catch (error) {
      logger.error("Could not reconcile customer transfer files", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (total.filesDeleted > 0) {
    logger.info("Reconciled customer transfer files", total);
  }
  return total;
}

/** Avstemming for én jobb, f.eks. rett etter en feilet import. */
export async function reconcileTransferJobFiles(
  jobId: string,
): Promise<ReconciliationResult> {
  return reconcileJob(jobId, { now: new Date(), staleMs: 0 });
}
