import { generateDueRecurringWorkOrders } from "@/lib/recurring";
import { runContractLifecycle } from "@/server/contracts";
import { sweepSlaClocks } from "@/server/sla";
import { logger } from "@/lib/logger";

/** Hvor ofte jobben sjekker avtaler, SLA-klokker og forfalte oppdrag. */
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Vent litt etter oppstart, så migreringer og database er klare. */
const START_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __fsmRecurringSchedulerStarted?: boolean;
};

export type SchedulerRunResult = {
  recurring: Awaited<ReturnType<typeof generateDueRecurringWorkOrders>>;
  lifecycle: Awaited<ReturnType<typeof runContractLifecycle>>;
  sla: Awaited<ReturnType<typeof sweepSlaClocks>>;
};

/**
 * Kjører alle små bakgrunnsjobber i fast rekkefølge:
 * 1. forny/utløp avtaler,
 * 2. generer forfalte serviceoppdrag,
 * 3. sveip SLA-klokker.
 *
 * Rekkefølgen er viktig: en automatisk fornyelse må flytte sluttdatoen før
 * generatoren vurderer om avtalen fortsatt er gyldig. Alle tre er idempotente
 * og kan kjøres samtidig fra flere instanser.
 */
export async function runScheduledJobs(
  now = new Date(),
): Promise<SchedulerRunResult> {
  const lifecycle = await runContractLifecycle(now);
  const recurring = await generateDueRecurringWorkOrders(now);
  const sla = await sweepSlaClocks(now);
  return { recurring, lifecycle, sla };
}

/**
 * Starter bakgrunnsjobben som oppretter oppdrag fra serviceavtaler, fornyer
 * avtaler og oppdaterer SLA-klokker.
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
    void runScheduledJobs()
      .then((result) => {
        const created = result.recurring.filter(
          (item) => item.workOrderId,
        ).length;
        if (
          created > 0 ||
          result.lifecycle.renewed > 0 ||
          result.lifecycle.expired > 0 ||
          result.sla.notified > 0
        ) {
          logger.info("Bakgrunnsjobber: kjørt", {
            created,
            renewed: result.lifecycle.renewed,
            expired: result.lifecycle.expired,
            slaChecked: result.sla.checked,
            slaNotified: result.sla.notified,
          });
        }
      })
      .catch((error) => {
        logger.error("Bakgrunnsjobber: kjøring feilet", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  setTimeout(run, START_DELAY_MS);
  setInterval(run, RUN_INTERVAL_MS);
}
