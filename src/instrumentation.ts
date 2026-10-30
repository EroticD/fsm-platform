/**
 * Next.js starter denne funksjonen én gang per serverinstans.
 *
 * Brukes til å starte de små bakgrunnsjobbene: generering av oppdrag fra
 * forfalte serviceavtaler og vedlikeholdsplaner, garantivarsler og
 * tekstuttrekk/OCR av PDF-dokumenter. De kjøres bare i Node-runtime, og aldri
 * under bygg.
 *
 * Begge kan slås av hver for seg med `RECURRING_SCHEDULER=false` og
 * `PDF_JOB_WORKER=false` – for eksempel når en ekstern arbeidsprosess gjør
 * jobben. SMS-køen har sin egen bryter, `SMS_WORKER=false`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateProductionConfig } = await import("@/lib/config");
  const configErrors = validateProductionConfig(process.env);
  if (configErrors.length > 0) {
    console.error("✖ Ugyldig produksjonskonfigurasjon:");
    for (const error of configErrors) console.error(`  - ${error}`);
    // Kastes i stedet for process.exit, slik at Next også kan laste denne
    // modulen i Edge-kontekst uten å advare om Node-API-er.
    throw new Error("Ugyldig produksjonskonfigurasjon");
  }

  if (process.env.RECURRING_SCHEDULER !== "false") {
    try {
      const { startScheduler } = await import("@/lib/scheduler");
      startScheduler();
    } catch (error) {
      console.error("Kunne ikke starte bakgrunnsjobben:", error);
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

  // SMS-køen har sin egen markør og kan kjøre uavhengig av PDF-workeren.
  if (process.env.SMS_WORKER !== "false") {
    try {
      const { startSmsWorker } = await import("@/server/sms");
      startSmsWorker();
    } catch (error) {
      console.error("Kunne ikke starte SMS-køen:", error);
    }
  }
}
