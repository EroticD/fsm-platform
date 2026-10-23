/**
 * Next.js starter denne funksjonen én gang per serverinstans.
 *
 * Brukes til å starte de små bakgrunnsjobbene: generering av oppdrag fra
 * forfalte serviceavtaler og tekstuttrekk/OCR av PDF-dokumenter. De kjøres
 * bare i Node-runtime, og aldri under bygg.
 *
 * Begge kan slås av hver for seg med `RECURRING_SCHEDULER=false` og
 * `PDF_JOB_WORKER=false` – for eksempel når en ekstern arbeidsprosess gjør
 * jobben.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  if (process.env.RECURRING_SCHEDULER !== "false") {
    try {
      const { startRecurringScheduler } = await import("@/lib/recurring-scheduler");
      startRecurringScheduler();
    } catch (error) {
      console.error("Kunne ikke starte serviceavtale-jobben:", error);
    }
  }

  if (process.env.PDF_JOB_WORKER !== "false") {
    try {
      const { startJobWorker } = await import("@/lib/job-worker");
      startJobWorker();
    } catch (error) {
      console.error("Kunne ikke starte jobbkøen for PDF-tekst:", error);
    }
  }
}
