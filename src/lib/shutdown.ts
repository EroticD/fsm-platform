import { logger } from "@/lib/logger";

/**
 * Kontrollert nedstenging av prosessen.
 *
 * Compose sender SIGTERM og gir oss `stop_grace_period` (30 s) før SIGKILL.
 * Uten egne signalhandlere avslutter Node umiddelbart: pågående OCR/PDF-jobber
 * blir stående som RUNNING til requeue-jobben tar dem etter 30 minutter, og
 * Prisma-poolen lukkes ikke. Modulene registrerer derfor oppryddingen sin her,
 * og `installShutdownHandlers()` sørger for at den kjøres sekvensielt med en
 * samlet tidsgrense.
 *
 * Ingen `process.on` registreres før `installShutdownHandlers()` kalles, slik
 * at tester, skript og bygg aldri får lyttere utilsiktet.
 */

type ShutdownCallback = () => void | Promise<void>;

export type ShutdownOptions = {
  /** Navn i loggen, f.eks. «scheduler». */
  name?: string;
  /** Lavere tall kjøres først. Standard 0; Prisma bruker høy verdi. */
  priority?: number;
};

type ShutdownTask = {
  callback: ShutdownCallback;
  name: string;
  priority: number;
  seq: number;
};

type ShutdownHandler = {
  signal: NodeJS.Signals;
  handler: () => void;
};

type ShutdownState = {
  tasks: ShutdownTask[];
  installed: boolean;
  handlers: ShutdownHandler[];
  running: Promise<number> | null;
  seq: number;
};

type ShutdownGlobal = typeof globalThis & {
  __fsmShutdownState?: ShutdownState;
};

/** Standard tidsgrense for hele nedstengingen; godt under Compose sin 30 s. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8_000;

function getState(): ShutdownState {
  const scope = globalThis as ShutdownGlobal;
  scope.__fsmShutdownState ??= {
    tasks: [],
    installed: false,
    handlers: [],
    running: null,
    seq: 0,
  };
  return scope.__fsmShutdownState;
}

/** Tidsgrensen kan overstyres med `SHUTDOWN_TIMEOUT_MS` (f.eks. i tester). */
export function shutdownTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

/**
 * Registrerer opprydding som skal kjøres ved SIGTERM/SIGINT. Returnerer en
 * funksjon som avregistrerer oppryddingen igjen (nyttig i tester og i moduler
 * som kan slås av og på i samme prosess).
 */
export function onShutdown(
  callback: ShutdownCallback,
  options: ShutdownOptions = {},
): () => void {
  const state = getState();
  const task: ShutdownTask = {
    callback,
    name: options.name ?? `shutdown-${state.seq + 1}`,
    priority: options.priority ?? 0,
    seq: state.seq++,
  };
  state.tasks.push(task);

  return () => {
    const index = state.tasks.indexOf(task);
    if (index >= 0) state.tasks.splice(index, 1);
  };
}

class ShutdownTimeoutError extends Error {
  constructor(taskName: string, ms: number) {
    super(`Shutdown task «${taskName}» did not finish within ${ms} ms`);
    this.name = "ShutdownTimeoutError";
  }
}

/** Kjører `promise`, men gir opp etter `ms` millisekunder. */
async function withTimeout(
  promise: Promise<void>,
  ms: number,
  taskName: string,
): Promise<void> {
  // En callback som aldri løses skal ikke gi en ukjent avvisning senere.
  promise.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        // Bevisst ikke `unref()`: denne timeren er det som holder prosessen i
        // live mens vi venter, og den må kunne fyre selv om alt annet sover.
        timer = setTimeout(() => reject(new ShutdownTimeoutError(taskName, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Kjører alle registrerte oppryddingsoppgaver sekvensielt (lavest prioritet
 * først, deretter registreringsrekkefølge) innenfor én samlet tidsgrense.
 *
 * Returnerer 0 når alt gikk bra og 1 når minst én oppgave feilet, timet ut
 * eller ble hoppet over fordi tiden var brukt opp. Kaller aldri
 * `process.exit` selv; det gjør signalhåndteringen, slik at tester kan kjøre
 * nedstengingen uten å avslutte testprosessen.
 */
export async function runShutdown(reason = "shutdown"): Promise<number> {
  const state = getState();
  // Idempotent: et nytt signal mens vi rydder skal ikke starte en ny runde.
  if (state.running) return state.running;

  state.running = executeShutdown(state, reason);
  return state.running;
}

async function executeShutdown(
  state: ShutdownState,
  reason: string,
): Promise<number> {
  const timeoutMs = shutdownTimeoutMs();
  const deadline = Date.now() + timeoutMs;

  const tasks = [...state.tasks].sort(
    (a, b) => a.priority - b.priority || a.seq - b.seq,
  );
  // Tøm køen før vi kjører, så en oppgave som registrerer ny opprydding ikke
  // havner i samme runde.
  state.tasks = [];

  logger.info("shutdown: starting", {
    reason,
    timeoutMs,
    tasks: tasks.map((task) => task.name),
  });

  let failed = false;

  for (const task of tasks) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      failed = true;
      logger.error("shutdown: out of time, skipping task", { task: task.name });
      continue;
    }

    const started = Date.now();
    try {
      await withTimeout(
        Promise.resolve().then(() => task.callback()),
        remaining,
        task.name,
      );
      logger.info("shutdown: task finished", {
        task: task.name,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      // En feilende oppgave stopper ikke de andre; alt skal få en sjanse.
      failed = true;
      logger.error("shutdown: task failed", {
        task: task.name,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    }
  }

  logger.info(failed ? "shutdown: completed with errors" : "shutdown: completed", {
    reason,
    tasks: tasks.length,
  });

  return failed ? 1 : 0;
}

function handleSignal(state: ShutdownState, signal: NodeJS.Signals): void {
  if (state.running) {
    // Docker kan sende signalet flere ganger (f.eks. SIGINT etter SIGTERM).
    logger.warn("shutdown: signal received while already shutting down", {
      signal,
    });
    return;
  }

  logger.info("shutdown: signal received", { signal });
  void runShutdown(signal)
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      logger.error("shutdown: unexpected failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}

/**
 * Installerer SIGTERM/SIGINT-håndteringen. Idempotent: gjentatte kall (HMR,
 * flere kall fra `instrumentation.ts`) gir ikke flere lyttere.
 */
export function installShutdownHandlers(): void {
  const state = getState();
  if (state.installed) return;
  state.installed = true;

  const onSigterm = () => handleSignal(state, "SIGTERM");
  const onSigint = () => handleSignal(state, "SIGINT");

  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);
  state.handlers = [
    { signal: "SIGTERM", handler: onSigterm },
    { signal: "SIGINT", handler: onSigint },
  ];

  logger.info("shutdown: handlers installed", {
    timeoutMs: shutdownTimeoutMs(),
  });
}

/** Fjerner signalhåndteringen. Brukes av tester og verktøy, ikke av appen. */
export function uninstallShutdownHandlers(): void {
  const state = getState();
  for (const { signal, handler } of state.handlers) {
    process.removeListener(signal, handler);
  }
  state.handlers = [];
  state.installed = false;
}

/** Bare for tester: glemmer oppgaver og kjøretilstand. */
export function resetShutdownForTests(): void {
  uninstallShutdownHandlers();
  const state = getState();
  state.tasks = [];
  state.running = null;
  state.seq = 0;
}
