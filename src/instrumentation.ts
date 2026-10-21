/**
 * Next.js starter denne funksjonen én gang per serverinstans.
 *
 * Brukes til å starte den lille bakgrunnsjobben som oppretter oppdrag fra
 * forfalte serviceavtaler. Den kjøres bare i Node-runtime, og aldri under bygg.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.RECURRING_SCHEDULER === "false") return;

  try {
    const { startRecurringScheduler } = await import("@/lib/recurring-scheduler");
    startRecurringScheduler();
  } catch (error) {
    console.error("Kunne ikke starte serviceavtale-jobben:", error);
  }
}
