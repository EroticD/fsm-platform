// i18n-ignore-file: jobbworkerens logger og revisjonshandlinger er driftsdata,
// ikke UI-tekst. Alle brukervendte strenger ligger i oversettelseskatalogene.
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { extractPdfText } from "@/lib/pdf-text";
import { cleanupRateLimits } from "@/lib/rate-limit-db";
import { parseDateOnly, todayInOslo } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { deleteUploadIfOwned } from "@/lib/upload-store";
import { releaseUpload } from "@/lib/upload-cleanup";
import {
  notifyOverdueWorkOrders,
  processPendingNotificationEmails,
} from "@/server/notifications";

/**
 * Vedvarende jobbkø for tekstuttrekk og OCR.
 *
 * Jobbene ligger i `DocumentJob`, ikke i minnet. Da overlever de restart, og
 * flere app-instanser kan dele køen: hver jobb låses med `FOR UPDATE SKIP
 * LOCKED` i det den hentes, slik at to prosesser aldri gjør samme arbeid.
 *
 * Både vanlig tekstuttrekk og OCR bruker typen `PDF_TEXT`; `extractPdfText`
 * avgjør selv om OCR er nødvendig. Da slipper vi å vite det på forhånd.
 */

export type PdfTextJob = {
  id: string;
  documentId: string | null;
  type: string;
  status: string;
  attempts: number;
  runAt: Date;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

export const PDF_TEXT_JOB_TYPE = "PDF_TEXT";

/** Etter tre mislykkede forsøk gir vi opp og markerer jobben som FAILED. */
export const MAX_JOB_ATTEMPTS = 3;

/** Første pause før nytt forsøk; dobles for hvert forsøk. */
export const JOB_RETRY_BASE_MS = 30_000;

/** Hvor mange jobber som kjøres samtidig i denne prosessen. */
export const JOB_WORKER_CONCURRENCY = 2;

const POLL_INTERVAL_MS = 5_000;

/** Kladder er en midlertidig sikkerhetskopi; etter en uke er de foreldet. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;

/** Hvor ofte foreldede kladder ryddes. */
export const DRAFT_CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;

/** Hvor lenge mykt slettede oppdrag beholdes før de hard-slettes. */
export const RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.RETENTION_DAYS ?? "", 10) || 365,
);

/** Hvor ofte bevaringsjobben ser etter utløpte oppdrag. */
export const RETENTION_CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * Søkeloggen brukes til anonymisert søkeanalyse. Den inneholder søkeord som
 * kan være personopplysninger, så den skal ikke beholdes for alltid.
 */
export const SEARCH_LOG_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.SEARCH_LOG_RETENTION_DAYS ?? "", 10) || 90,
);

export const SEARCH_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;

/** Korte bookingreservasjoner ryddes hvert minutt. */
export const BOOKING_HOLD_CLEANUP_INTERVAL_MS = 60_000;

/** Utløpte PENDING-forespørsler merkes hvert sjette døgn. */
export const BOOKING_REQUEST_EXPIRY_INTERVAL_MS = 6 * 60 * 60_000;

/** Hvor lenge en konsumert reservasjon beholdes for sporbarhet. */
export const BOOKING_HOLD_RETENTION_MS = 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

type WorkerGlobal = typeof globalThis & {
  __fsmPdfJobWorkerStarted?: boolean;
  __fsmDraftCleanupStarted?: boolean;
  __fsmWorkOrderRetentionStarted?: boolean;
  __fsmSearchLogCleanupStarted?: boolean;
  __fsmBookingHoldCleanupStarted?: boolean;
};

/** Eksponentiell pause etter et mislykket forsøk (1 → 30 s, 2 → 60 s, 3 → 120 s). */
export function pdfJobBackoffMs(attempts: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempts));
  return JOB_RETRY_BASE_MS * 2 ** (safeAttempt - 1);
}

/**
 * Legger et dokument i tekstuttrekkskøen. Returnerer jobben som ble opprettet,
 * eller null når den ikke kunne lagres.
 *
 * `filePath` er med fordi kallestedene allerede har den; selve stien leses fra
 * dokumentet når jobben kjører, slik at den alltid er oppdatert.
 */
export async function enqueuePdfText(
  documentId: string,
  filePath?: string,
): Promise<{ id: string } | null> {
  // Stien ligger allerede på dokumentet; parameteren beholdes for kompatibilitet.
  void filePath;

  try {
    // Unngå at gjentatte klikk på «reindekser» lager mange like jobber.
    const existing = await prisma.documentJob.findFirst({
      where: {
        documentId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (existing) return existing;

    return await prisma.documentJob.create({
      data: { documentId, type: PDF_TEXT_JOB_TYPE },
      select: { id: true },
    });
  } catch (error) {
    // Kallestedene er server actions som ikke venter på køen; en feil her skal
    // ikke velte selve opplastingen.
    console.error(
      `Could not enqueue text extraction for document ${documentId}:`,
      error,
    );
    return null;
  }
}

/**
 * Henter og låser neste jobb som er klar. `SKIP LOCKED` gjør at flere
 * prosesser kan hente hver sin jobb uten å vente på hverandre.
 */
export async function claimNextPdfTextJob(): Promise<PdfTextJob | null> {
  const rows = await prisma.$queryRaw<PdfTextJob[]>`
    UPDATE "DocumentJob"
    SET "status" = 'RUNNING',
        "lockedAt" = now(),
        "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id"
      FROM "DocumentJob"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  return rows[0] ?? null;
}

/**
 * Setter jobber som ble stående i RUNNING av en krasjet prosess tilbake i
 * køen. Uten dette ville de aldri blitt forsøkt igjen.
 */
export async function requeueStalePdfTextJobs(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "DocumentJob"
      SET "status" = 'PENDING',
          "lockedAt" = NULL
      WHERE "status" = 'RUNNING'
        AND "lockedAt" < now() - interval '30 minutes'
      RETURNING "id"
    `;

    if (rows.length > 0) {
      logger.warn("Text extraction: requeued stale jobs", {
        count: rows.length,
      });
    }
    return rows.length;
  } catch (error) {
    logger.error("Could not requeue stale text extraction jobs", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function failOrRetryPdfTextJob(
  job: PdfTextJob,
  error: unknown,
): Promise<"retry" | "failed"> {
  const message = error instanceof Error ? error.message : String(error);
  const lastError = message.slice(0, 2000);

  if (job.attempts >= MAX_JOB_ATTEMPTS) {
    await prisma.documentJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lockedAt: null, lastError },
    });
    logger.error("Text extraction failed after the maximum number of attempts", {
      documentId: job.documentId,
      attempts: job.attempts,
      error: message,
    });
    return "failed";
  }

  const runAt = new Date(Date.now() + pdfJobBackoffMs(job.attempts));

  await prisma.documentJob.update({
    where: { id: job.id },
    data: { status: "PENDING", lockedAt: null, runAt, lastError },
  });

  logger.warn("Text extraction failed; retrying", {
    documentId: job.documentId,
    attempts: job.attempts,
    runAt: runAt.toISOString(),
  });
  return "retry";
}

/**
 * Kjører én jobb. `attempts` er allerede økt da jobben ble hentet, så
 * `attempts` er nummeret på forsøket som nettopp ble gjort.
 */
export async function processPdfTextJob(
  job: PdfTextJob,
): Promise<"done" | "retry" | "failed"> {
  try {
    if (!job.documentId) throw new Error("The job is missing a document id");

    const document = await prisma.document.findUnique({
      where: { id: job.documentId },
      select: { id: true, filePath: true },
    });
    if (!document) throw new Error("The document no longer exists");

    const { text, pages } = await extractPdfText(document.filePath);

    await prisma.document.update({
      where: { id: document.id },
      data: {
        contentText: text || null,
        pageTexts: pages.length > 0 ? JSON.stringify(pages) : null,
      },
    });

    await prisma.documentJob.update({
      where: { id: job.id },
      data: { status: "DONE", lockedAt: null, lastError: null },
    });

    return "done";
  } catch (error) {
    try {
      return await failOrRetryPdfTextJob(job, error);
    } catch (updateError) {
      // Klarte vi ikke å oppdatere jobben, blir den stående i RUNNING og tas
      // tilbake av requeueStalePdfTextJobs senere.
      logger.error("Could not update text extraction job", {
        jobId: job.id,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      });
      return "failed";
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Plukker signatur-URL-ene ut av en kladds `dataJson`, uten å stole på formen. */
function draftSignatureUrls(dataJson: string): string[] {
  try {
    const parsed = JSON.parse(dataJson) as Record<string, unknown>;
    return ["technicianSignatureUrl", "customerSignatureUrl"]
      .map((key) => parsed[key])
      .filter(
        (value): value is string =>
          typeof value === "string" && /^\/uploads\/[A-Za-z0-9._-]+$/.test(value),
      );
  } catch {
    return [];
  }
}

/**
 * Sletter kladder som ikke er oppdatert på en uke, og frigjør signaturfilene
 * deres. Filer som allerede er tatt over av en signert rapport har
 * `ownerType = WORK_ORDER` og røres ikke.
 */
export async function cleanupExpiredDrafts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DRAFT_TTL_MS);

  const drafts = await prisma.reportDraft.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { id: true, userId: true, dataJson: true },
  });

  let deleted = 0;
  for (const draft of drafts) {
    // Slett raden først, og bare hvis den fortsatt er utløpt. Da kan en
    // samtidig lagring ikke bli slettet, og vi rører ikke filer som en fersk
    // kladd fortsatt refererer.
    const result = await prisma.reportDraft.deleteMany({
      where: { id: draft.id, updatedAt: { lt: cutoff } },
    });
    if (result.count === 0) continue;
    deleted += result.count;

    for (const url of draftSignatureUrls(draft.dataJson)) {
      await deleteUploadIfOwned(url, {
        ownerType: "USER",
        ownerId: draft.userId,
      });
    }
  }

  if (deleted > 0) {
    logger.info("Cleaned up expired report drafts", { count: deleted });
  }
  return deleted;
}

/**
 * Starter opprydding av utløpte kladder. Egen global markør gjør at HMR og
 * gjentatte kall fra `instrumentation.ts` ikke lager flere intervaller.
 */
export function startDraftCleanup(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmDraftCleanupStarted) return;
  scope.__fsmDraftCleanupStarted = true;

  const run = () => {
    void cleanupExpiredDrafts().catch((error) => {
      logger.error("Could not clean up expired report drafts", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  const timer = setInterval(run, DRAFT_CLEANUP_INTERVAL_MS);
  timer.unref?.();
}

/**
 * Sletter søkelogg-rader som er eldre enn bevaringsfristen.
 *
 * Loggen brukes bare til aggregert analyse (populære søk og nulltreff), ikke
 * som revisjonsspor. Søkeord kan inneholde personopplysninger, så radene
 * slettes etter `SEARCH_LOG_RETENTION_DAYS` (standard 90 dager).
 */
export async function cleanupExpiredSearchLogs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SEARCH_LOG_RETENTION_DAYS * DAY_MS);
  const result = await prisma.searchLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (result.count > 0) {
    logger.info("Cleaned up expired search logs", {
      count: result.count,
      retentionDays: SEARCH_LOG_RETENTION_DAYS,
    });
  }
  return result.count;
}

/**
 * Starter opprydding av utløpte søkelogger. Egen global markør gjør at HMR og
 * gjentatte kall fra `instrumentation.ts` ikke lager flere intervaller.
 */
export function startSearchLogCleanup(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmSearchLogCleanupStarted) return;
  scope.__fsmSearchLogCleanupStarted = true;

  const run = () => {
    void cleanupExpiredSearchLogs().catch((error) => {
      logger.error("Could not clean up expired search logs", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  const timer = setInterval(run, SEARCH_LOG_CLEANUP_INTERVAL_MS);
  timer.unref?.();
}

/**
 * Sletter utløpte bookingreservasjoner og gamle, konsumerte rader.
 *
 * En utløpt rad blokkerer ikke lenger i tilgjengelighetsberegningen (den
 * filtrerer på `expiresAt > now`), men ryddingen holder tabellen liten og
 * frigjør timen for andre kunder umiddelbart etter utløp.
 */
export async function expireBookingHolds(now = new Date()): Promise<number> {
  const result = await prisma.bookingHold.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        {
          consumedAt: {
            lt: new Date(now.getTime() - BOOKING_HOLD_RETENTION_MS),
          },
        },
      ],
    },
  });
  if (result.count > 0) {
    logger.info("Ryddet utløpte bookingreservasjoner", {
      count: result.count,
    });
  }
  return result.count;
}

/**
 * Merker gamle PENDING-forespørsler som EXPIRED. Kunden kan ikke lenger
 * booke en dato som har passert, men raden beholdes som historikk.
 */
export async function expireStalePendingBookings(
  now = new Date(),
): Promise<number> {
  const today = parseDateOnly(todayInOslo(now));
  if (!today) return 0;
  const result = await prisma.bookingRequest.updateMany({
    where: {
      status: "PENDING",
      requestedDate: { lt: today },
    },
    data: { status: "EXPIRED" },
  });
  if (result.count > 0) {
    logger.info("Merket utløpte bookingforespørsler", {
      count: result.count,
    });
  }
  return result.count;
}

/** Starter ryddingen av bookingreservasjoner. */
export function startBookingHoldCleanup(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmBookingHoldCleanupStarted) return;
  scope.__fsmBookingHoldCleanupStarted = true;

  const run = () => {
    void expireBookingHolds().catch((error) => {
      logger.error("Kunne ikke rydde bookingreservasjoner", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  const runRequests = () => {
    void expireStalePendingBookings().catch((error) => {
      logger.error("Kunne ikke utløpe bookingforespørsler", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  runRequests();
  const holdTimer = setInterval(run, BOOKING_HOLD_CLEANUP_INTERVAL_MS);
  holdTimer.unref?.();
  const requestTimer = setInterval(
    runRequests,
    BOOKING_REQUEST_EXPIRY_INTERVAL_MS,
  );
  requestTimer.unref?.();
}

/**
 * Hard-sletter mykt slettede oppdrag når bevaringsperioden er utløpt.
 *
 * Bare oppdrag uten rapporter i det hele tatt hard-slettes automatisk. Har
 * oppdraget først en rapport – signert, låst eller ikke – beholdes hele
 * oppdraget sammen med revisjonene og filene. Det er den tryggeste regelen:
 * en rapport kan være signert eller ha revisjonshistorikk som aldri skal
 * kunne rekonstrueres borte, og vi kan ikke vite om den er «ferdig» bare fordi
 * den er ulåst.
 *
 * `legalHold` på oppdraget eller på en rapport stopper slettingen. Rapporter,
 * revisjoner og kommentarer slettes sammen med oppdraget (cascade);
 * opplastingsfilene frigjøres først etter at databasen er oppdatert, slik at vi
 * aldri sitter igjen med filer uten referanse.
 *
 * Retensjonspolicyen er bevisst konservativ: `reports: { none: {} }` betyr at
 * et oppdrag med én eller flere rapporter aldri hard-slettes automatisk – også
 * når rapporten er ulåst eller mangler signatur. Bevis kan derfor bare fjernes
 * manuelt, og bare av en administrator. Se `docs/DECISIONS.md` for eksport- og
 * oppbevaringsreglene.
 */
export async function cleanupRetainedWorkOrders(
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);

  const expired = await prisma.workOrder.findMany({
    where: {
      deletedAt: { lt: cutoff },
      legalHold: false,
      // `none: {}` er strengere enn `none: { legalHold: true }`: enhver
      // rapport – og dermed enhver ReportRevision – blokkerer hard sletting.
      reports: { none: {} },
    },
    select: { id: true, title: true },
    take: 200,
  });
  if (expired.length === 0) return 0;

  const ids = expired.map((workOrder) => workOrder.id);
  const uploads = await prisma.upload.findMany({
    where: { ownerType: "WORK_ORDER", ownerId: { in: ids } },
    select: { ownerId: true, storedName: true },
    take: 5000,
  });

  let deleted = 0;
  for (const workOrder of expired) {
    try {
      const removed = await prisma.$transaction(async (tx) => {
        // Les på nytt i transaksjonen: en samtidig gjenoppretting, ny rapport
        // eller bevaringsplikt skal alltid vinne over den automatiske
        // slettingen.
        const stillExpired = await tx.workOrder.findFirst({
          where: {
            id: workOrder.id,
            deletedAt: { lt: cutoff },
            legalHold: false,
            reports: { none: {} },
          },
          select: { id: true },
        });
        if (!stillExpired) return false;

        await audit(tx, {
          entityType: "WorkOrder",
          entityId: workOrder.id,
          action:
            `Automatisk slettet oppdraget «${workOrder.title}» etter ` +
            `bevaringsperioden (${RETENTION_DAYS} dager)`,
          actor: { id: "system", name: "System", email: null },
          metadata: { retentionDays: RETENTION_DAYS, automatic: true },
        });
        await tx.workOrder.delete({ where: { id: workOrder.id } });
        return true;
      });
      if (!removed) continue;
      deleted += 1;

      for (const upload of uploads) {
        if (upload.ownerId === workOrder.id) {
          await releaseUpload(`/uploads/${upload.storedName}`);
        }
      }
    } catch (error) {
      logger.error("Could not hard-delete expired work order", {
        workOrderId: workOrder.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deleted > 0) {
    logger.info("Hard-deleted expired work orders after the retention period", {
      count: deleted,
      retentionDays: RETENTION_DAYS,
    });
  }
  return deleted;
}

/**
 * Starter bevaringsjobben. Egen global markør gjør at HMR og gjentatte kall
 * fra `instrumentation.ts` ikke lager flere intervaller.
 */
export function startWorkOrderRetentionCleanup(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmWorkOrderRetentionStarted) return;
  scope.__fsmWorkOrderRetentionStarted = true;

  const run = () => {
    void cleanupRetainedWorkOrders().catch((error) => {
      logger.error("Could not run the work order retention job", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  const timer = setInterval(run, RETENTION_CLEANUP_INTERVAL_MS);
  timer.unref?.();
}

async function runWorkerLoop(workerIndex: number): Promise<void> {
  // Litt spredning, så ikke alle workerne spør databasen i samme øyeblikk.
  await sleep(1_000 + workerIndex * 250);

  for (;;) {
    try {
      const job = await claimNextPdfTextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      await processPdfTextJob(job);
    } catch (error) {
      logger.error("PDF-jobbworker: uventet feil", {
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

/**
 * Starter jobbkøen i denne prosessen. Kalles fra `instrumentation.ts`, og
 * kjører bare én gang per prosess – også når Next.js laster modulen på nytt.
 */
export function startJobWorker(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmPdfJobWorkerStarted) return;
  scope.__fsmPdfJobWorkerStarted = true;

  void requeueStalePdfTextJobs();
  void Promise.all(
    Array.from({ length: JOB_WORKER_CONCURRENCY }, (_, index) =>
      runWorkerLoop(index),
    ),
  );

  // Rydd utløpte kladder ved oppstart og deretter hvert sjette døgn.
  startDraftCleanup();

  // Hard-slett mykt slettede oppdrag når bevaringsperioden er utløpt.
  startWorkOrderRetentionCleanup();

  // Søkeloggen er analyse, ikke revisjon: slett gamle søkeord (PII).
  startSearchLogCleanup();

  // Frigjør korte bookingreservasjoner og merk utløpte forespørsler.
  startBookingHoldCleanup();

  // Rydd utløpte rate-limit-rader med jevne mellomrom. Tellere som er i bruk
  // har resetAt i fremtiden og røres ikke.
  const pruneRateLimits = () => {
    void cleanupRateLimits().catch((error) => {
      logger.error("Could not clean up the rate limit table", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  pruneRateLimits();
  const cleanupTimer = setInterval(pruneRateLimits, 15 * 60_000);
  cleanupTimer.unref?.();

  // Send varsel-e-poster fra den vedvarende Notification-tabellen. En treg
  // SMTP-server blokkerer da ikke handlingen som utløste varselet.
  const processNotifications = () => {
    void processPendingNotificationEmails().catch((error) => {
      logger.error("Could not send notification emails", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  processNotifications();
  const notificationTimer = setInterval(processNotifications, 60_000);
  notificationTimer.unref?.();

  // Én overdue-sjekk ved oppstart og deretter hvert sjette døgn.
  const notifyOverdue = () => {
    void notifyOverdueWorkOrders().catch((error) => {
      logger.error("Could not notify about overdue work orders", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  notifyOverdue();
  const overdueTimer = setInterval(notifyOverdue, 6 * 60 * 60_000);
  overdueTimer.unref?.();

  logger.info("Text extraction: job worker started", {
    concurrency: JOB_WORKER_CONCURRENCY,
  });
}

/** Bare for tester: nullstiller «startet»-flaggene. */
export function resetJobWorkerForTests(): void {
  const scope = globalThis as WorkerGlobal;
  scope.__fsmPdfJobWorkerStarted = false;
  scope.__fsmDraftCleanupStarted = false;
  scope.__fsmWorkOrderRetentionStarted = false;
  scope.__fsmSearchLogCleanupStarted = false;
  scope.__fsmBookingHoldCleanupStarted = false;
}
