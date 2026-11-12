import { generateDueRecurringWorkOrders } from "@/lib/recurring";
import { generateDueMaintenanceWorkOrders } from "@/server/maintenance";
import { notifyWarrantyExpiring } from "@/server/equipment";
import { runContractLifecycle } from "@/server/contracts";
import { sweepSlaClocks } from "@/server/sla";
import { runSlaCleanupJob } from "@/server/sla-cleanup-job";
import { slaCleanupIntervalMs } from "@/lib/sla-cleanup-config";
import { logger } from "@/lib/logger";
import { moduleEnabled } from "@/server/modules";
import { onShutdown } from "@/lib/shutdown";

/** Hvor ofte jobben sjekker avtaler, vedlikehold, garanti og SLA. */
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Vent litt etter oppstart, så migreringer og database er klare. */
const START_DELAY_MS = 10 * 1000;

type SchedulerGlobal = typeof globalThis & {
  __fsmSchedulerStarted?: boolean;
  __fsmSchedulerStop?: () => Promise<void>;
};

export type SchedulerRunResult = {
  recurring: Awaited<ReturnType<typeof generateDueRecurringWorkOrders>>;
  lifecycle: Awaited<ReturnType<typeof runContractLifecycle>>;
  sla: Awaited<ReturnType<typeof sweepSlaClocks>>;
  slaCleanup: Awaited<ReturnType<typeof runSlaCleanupJob>>;
  maintenance: Awaited<ReturnType<typeof generateDueMaintenanceWorkOrders>>;
  warranty: Awaited<ReturnType<typeof notifyWarrantyExpiring>>;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Kjører alle bakgrunnsjobber i fast rekkefølge. Avtalelivssyklusen må kjøre
 * før generatoren, slik at automatisk fornyelse flytter sluttdatoen før et
 * serviceoppdrag vurderes. Hver jobb feiler isolert, slik at én feil ikke
 * stopper de andre.
 */
export async function runScheduledJobs(
  now = new Date(),
): Promise<SchedulerRunResult> {
  const [contractsEnabled, equipmentEnabled] = await Promise.all([
    moduleEnabled("contracts"),
    moduleEnabled("equipment"),
  ]);

  const lifecycle = contractsEnabled
    ? await runContractLifecycle(now).catch((error) => {
        logger.error("contracts: lifecycle failed", { error: errorText(error) });
        return { renewed: 0, expired: 0, generated: 0 };
      })
    : { renewed: 0, expired: 0, generated: 0 };

  const [contracts, maintenance] = await Promise.allSettled([
    contractsEnabled ? generateDueRecurringWorkOrders(now) : Promise.resolve([]),
    equipmentEnabled
      ? generateDueMaintenanceWorkOrders()
      : Promise.resolve([]),
  ]);

  let recurring: SchedulerRunResult["recurring"] = [];
  if (contracts.status === "fulfilled") {
    recurring = contracts.value;
  } else {
    logger.error("contracts: generation failed", {
      error: errorText(contracts.reason),
    });
  }

  let maintenanceResult: SchedulerRunResult["maintenance"] = [];
  if (maintenance.status === "fulfilled") {
    maintenanceResult = maintenance.value;
  } else {
    logger.error("maintenance: generation failed", {
      error: errorText(maintenance.reason),
    });
  }

  const sla = contractsEnabled
    ? await sweepSlaClocks(now).catch((error) => {
        logger.error("sla: sweep failed", { error: errorText(error) });
        return { checked: 0, atRisk: 0, breached: 0, met: 0, notified: 0 };
      })
    : { checked: 0, atRisk: 0, breached: 0, met: 0, notified: 0 };

  // Fjern SLA-klokker uten aktiv avtaledekning. Jobben er selvbegrensende
  // (SLA_CLEANUP_ENABLED og SLA_CLEANUP_INTERVAL_HOURS) og kaster aldri, men
  // vi fanger likevel feil her så en framtidig regresjon ikke stopper resten.
  const slaCleanup: SchedulerRunResult["slaCleanup"] = contractsEnabled
    ? await runSlaCleanupJob({ now }).catch((error) => {
        logger.error("sla: cleanup failed", { error: errorText(error) });
        return {
          enabled: false,
          skipped: null,
          runId: null,
          result: null,
          error: errorText(error),
        };
      })
    : {
        enabled: false,
        skipped: "disabled",
        runId: null,
        result: null,
        error: null,
      };

  // Garantivarsel er best effort og skal aldri stoppe de andre jobbene.
  let warranty: SchedulerRunResult["warranty"] = {
    checked: 0,
    notified: 0,
  };
  if (equipmentEnabled) {
    try {
      warranty = await notifyWarrantyExpiring();
    } catch (error) {
      logger.error("warranty: notification run failed", {
        error: errorText(error),
      });
    }
  }

  return {
    recurring,
    lifecycle,
    sla,
    slaCleanup,
    maintenance: maintenanceResult,
    warranty,
  };
}

async function runOnce() {
  const result = await runScheduledJobs();

  const created = result.recurring.filter((item) => item.workOrderId).length;
  if (created > 0) {
    logger.info("contracts: created work orders", { created });
  }
  if (result.lifecycle.renewed > 0 || result.lifecycle.expired > 0) {
    logger.info("contracts: lifecycle completed", {
      renewed: result.lifecycle.renewed,
      expired: result.lifecycle.expired,
    });
  }

  const plans = result.maintenance.filter((item) => item.workOrderId).length;
  if (plans > 0) {
    logger.info("maintenance: created work orders", { created: plans });
  }
  if (result.warranty.notified > 0) {
    logger.info("warranty: sent expiry notifications", {
      notified: result.warranty.notified,
    });
  }
  if (result.sla.notified > 0) {
    logger.info("sla: sent alerts", {
      checked: result.sla.checked,
      notified: result.sla.notified,
    });
  }
  if (result.slaCleanup.error) {
    logger.error("sla: cleanup run reported an error", {
      error: result.slaCleanup.error,
    });
  }
}

/**
 * Starter de små bakgrunnsjobene: serviceavtaler, avtalelivssyklus,
 * vedlikeholdsplaner, garantivarsler og SLA-sveip.
 *
 * Next.js kaller `instrumentation.register()` én gang per serverinstans. Vi
 * bruker en global flagg fordi utviklingsserveren kan laste modulen på nytt.
 * Jobben kjører i den vanlige Node-prosessen; /api/cron/recurring kan i tillegg
 * kalles av en ekstern cron. Slås av med `RECURRING_SCHEDULER=false`.
 *
 * Ved SIGTERM/SIGINT stopper `stopScheduler()` intervallene og venter på
 * kjøringen som eventuelt pågår, slik at en halvferdig SLA-sveip eller
 * avtalegenerering ikke blir avbrutt midt i en transaksjon.
 */
export function startScheduler() {
  const scope = globalThis as SchedulerGlobal;
  if (scope.__fsmSchedulerStarted) return;
  scope.__fsmSchedulerStarted = true;

  const timers: NodeJS.Timeout[] = [];
  const inFlight = new Set<Promise<void>>();
  let stopped = false;
  let mainRunActive = false;

  const track = (work: Promise<unknown>, label: string) => {
    const tracked: Promise<void> = work
      .then(() => undefined)
      .catch((error) => {
        logger.error(`${label} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight.delete(tracked);
      });
    inFlight.add(tracked);
  };

  const run = () => {
    if (stopped) return;
    // Ikke start en ny runde mens den forrige kjører: da finnes det alltid
    // nøyaktig én kjøring å vente på ved nedstenging.
    if (mainRunActive) return;
    mainRunActive = true;
    track(
      runOnce().finally(() => {
        mainRunActive = false;
      }),
      "scheduler: run",
    );
  };

  timers.push(setTimeout(run, START_DELAY_MS));
  timers.push(setInterval(run, RUN_INTERVAL_MS));

  // SLA-oppryddingen har eget intervall (SLA_CLEANUP_INTERVAL_HOURS) fordi
  // den kan kjøres oftere enn de øvrige tunge jobbene. runScheduledJobs gjør
  // også et due-sjekk-kall, så intervallet respekteres uansett hvem som vekker
  // den (intern timer eller /api/cron/recurring).
  const cleanupTimer = setInterval(() => {
    if (stopped) return;
    track(runSlaCleanupJob(), "sla: cleanup timer");
  }, slaCleanupIntervalMs());
  cleanupTimer.unref?.();
  timers.push(cleanupTimer);

  // Idempotent: gjentatte kall (signal + eksplisitt stopp) venter på samme
  // avslutning i stedet for å returnere før jobbene er ferdige.
  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      stopped = true;
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      // Vent på jobbene som allerede er i gang. Nye starter ikke, fordi
      // `stopped` sjekkes i både `run` og SLA-timeren.
      if (inFlight.size > 0) {
        logger.info("scheduler: waiting for in-flight jobs", {
          count: inFlight.size,
        });
        await Promise.allSettled([...inFlight]);
      }
    })();
    return stopPromise;
  };
  scope.__fsmSchedulerStop = stop;

  onShutdown(
    async () => {
      logger.info("scheduler: stopping");
      await stop();
      logger.info("scheduler: stopped");
    },
    { name: "scheduler" },
  );
}

/** Stopper intervallene og venter på pågående kjøring. Brukes ved nedstenging. */
export function stopScheduler(): Promise<void> {
  const scope = globalThis as SchedulerGlobal;
  return scope.__fsmSchedulerStop?.() ?? Promise.resolve();
}


/** Bakoverkompatibelt navn fra da jobben bare håndterte serviceavtaler. */
export function startRecurringScheduler() {
  startScheduler();
}
