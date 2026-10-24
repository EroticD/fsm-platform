import { generateDueRecurringWorkOrders } from "@/lib/recurring";
import { logger } from "@/lib/logger";

/** Hvor ofte jobben sjekker for forfalte serviceavtaler. */
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Vent litt etter oppstart, så migreringer og database er klare. */
const START_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __fsmRecurringSchedulerStarted?: boolean;
};

/**
 * Starter bakgrunnsjobben som oppretter oppdrag fra serviceavtaler.
 *
 * Next.js kaller `instrumentation.register()` én gang per serverinstans. Vi
 * bruker en global flagg fordi utviklingsserveren kan laste modulen på nytt.
 * Jobben kjører i den vanlige Node-prosessen; i en enkelt Docker-container er
 * det tilstrekkelig. /api/cron/recurring kan i tillegg kalles av en ekstern
 * cron hvis man vil styre kjøringen utenfra.
 */
export function startRecurringScheduler() {
  const scope = globalThis as SchedulerGlobal;
  if (scope.__fsmRecurringSchedulerStarted) return;
  scope.__fsmRecurringSchedulerStarted = true;

  const run = () => {
    void generateDueRecurringWorkOrders()
      .then((results) => {
        const created = results.filter((result) => result.workOrderId).length;
        if (created > 0) {
          logger.info("Serviceavtaler: opprettet nye oppdrag", { created });
        }
      })
      .catch((error) => {
        logger.error("Serviceavtaler: generering feilet", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  setTimeout(run, START_DELAY_MS);
  setInterval(run, RUN_INTERVAL_MS);
}
