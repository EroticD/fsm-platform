import prisma from "@/lib/prisma";
import { extractPdfText } from "@/lib/pdf-text";
import { cleanupRateLimits } from "@/lib/rate-limit-db";
import { logger } from "@/lib/logger";
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

type WorkerGlobal = typeof globalThis & {
  __fsmPdfJobWorkerStarted?: boolean;
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
      `Kunne ikke legge tekstuttrekk for dokument ${documentId} i køen:`,
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
      logger.warn("Tekstuttrekk: la fastlåste jobber tilbake i køen", {
        count: rows.length,
      });
    }
    return rows.length;
  } catch (error) {
    logger.error("Kunne ikke rydde fastlåste tekstuttrekksjobber", {
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
    logger.error("Tekstuttrekk feilet etter maks antall forsøk", {
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

  logger.warn("Tekstuttrekk feilet; prøver igjen", {
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
    if (!job.documentId) throw new Error("Jobben mangler dokument-id");

    const document = await prisma.document.findUnique({
      where: { id: job.documentId },
      select: { id: true, filePath: true },
    });
    if (!document) throw new Error("Dokumentet finnes ikke lenger");

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
      logger.error("Kunne ikke oppdatere tekstuttrekksjobb", {
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

  // Rydd utløpte rate-limit-rader med jevne mellomrom. Tellere som er i bruk
  // har resetAt i fremtiden og røres ikke.
  const pruneRateLimits = () => {
    void cleanupRateLimits().catch((error) => {
      logger.error("Kunne ikke rydde rate-limit-tabellen", {
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
      logger.error("Kunne ikke sende varsel-e-poster", {
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
      logger.error("Kunne ikke varsle om forfalte oppdrag", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  notifyOverdue();
  const overdueTimer = setInterval(notifyOverdue, 6 * 60 * 60_000);
  overdueTimer.unref?.();

  logger.info("Tekstuttrekk: jobbworker startet", {
    concurrency: JOB_WORKER_CONCURRENCY,
  });
}

/** Bare for tester: nullstiller «startet»-flagget. */
export function resetJobWorkerForTests(): void {
  (globalThis as WorkerGlobal).__fsmPdfJobWorkerStarted = false;
}
