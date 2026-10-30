import { generateDueRecurringWorkOrders } from "@/lib/recurring";
import { generateDueMaintenanceWorkOrders } from "@/server/maintenance";
import { notifyWarrantyExpiring } from "@/server/equipment";
import { logger } from "@/lib/logger";

/** Hvor ofte jobben sjekker serviceavtaler, vedlikeholdsplaner og garanti. */
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Vent litt etter oppstart, så migreringer og database er klare. */
const START_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __fsmSchedulerStarted?: boolean;
};

async function runOnce() {
  const [contracts, maintenance] = await Promise.allSettled([
    generateDueRecurringWorkOrders(),
    generateDueMaintenanceWorkOrders(),
  ]);

  if (contracts.status === "fulfilled") {
    const created = contracts.value.filter((result) => result.workOrderId).length;
    if (created > 0) {
      logger.info("Serviceavtaler: opprettet nye oppdrag", { created });
    }
  } else {
    logger.error("Serviceavtaler: generering feilet", {
      error:
        contracts.reason instanceof Error
          ? contracts.reason.message
          : String(contracts.reason),
    });
  }

  if (maintenance.status === "fulfilled") {
    const created = maintenance.value.filter((result) => result.workOrderId).length;
    if (created > 0) {
      logger.info("Vedlikeholdsplaner: opprettet nye oppdrag", { created });
    }
  } else {
    logger.error("Vedlikeholdsplaner: generering feilet", {
      error:
        maintenance.reason instanceof Error
          ? maintenance.reason.message
          : String(maintenance.reason),
    });
  }

  // Garantivarsel er best effort og skal aldri stoppe de andre jobbene.
  try {
    const warranty = await notifyWarrantyExpiring();
    if (warranty.notified > 0) {
      logger.info("Utstyr: sendte garantivarsler", {
        notified: warranty.notified,
      });
    }
  } catch (error) {
    logger.error("Utstyr: garantivarsling feilet", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Starter de små bakgrunnsjobene: serviceavtaler, vedlikeholdsplaner og
 * garantivarsler.
 *
 * Next.js kaller `instrumentation.register()` én gang per serverinstans. Vi
 * bruker en global flagg fordi utviklingsserveren kan laste modulen på nytt.
 * Jobben kjører i den vanlige Node-prosessen; /api/cron/recurring kan i tillegg
 * kalles av en ekstern cron. Slås av med `RECURRING_SCHEDULER=false`.
 */
export function startScheduler() {
  const scope = globalThis as SchedulerGlobal;
  if (scope.__fsmSchedulerStarted) return;
  scope.__fsmSchedulerStarted = true;

  const run = () => {
    void runOnce();
  };

  setTimeout(run, START_DELAY_MS);
  setInterval(run, RUN_INTERVAL_MS);
}

/** Bakoverkompatibelt navn fra da jobben bare håndterte serviceavtaler. */
export function startRecurringScheduler() {
  startScheduler();
}
