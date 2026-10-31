/**
 * Bakgrunnssynk for offline-kladden.
 *
 * Kladder som legges i outboxen registreres med en stabil SyncManager-tag, slik
 * at nettleseren kan vekke service workeren og replaye dem selv når appen ikke
 * har noen åpen fane. Dette er en progresjon, ikke en garanti: Safari og
 * Firefox støtter ikke Background Sync, og nettleseren bestemmer selv når
 * jobben kjøres. Uten støtte faller vi tilbake til den vanlige tømmingen fra
 * offline-banneret (online-hendelse, synlighet og 30-sekunderstimer).
 *
 * Alle funksjonene her er trygge no-ops når service worker eller SyncManager
 * mangler, eller når nettleseren avviser registreringen.
 */

/** Stabil tag som både klienten og public/sw.js bruker. */
export const DRAFT_SYNC_TAG = "fsm-draft-sync";

/** Vindushendelser fra tømmingen av outboxen. */
export const SYNC_START_EVENT = "fsm:sync-start";
export const SYNC_PROGRESS_EVENT = "fsm:sync-progress";
export const SYNC_END_EVENT = "fsm:sync-end";

export type SyncResultDetail = {
  /** Antall kladder som ble sendt i denne kjøringen. */
  sent: number;
  /** Rapporter som fortsatt venter på sending. */
  pending: number;
  /** Rapporter som har fått en terminal feil. */
  failed: number;
};

/**
 * ServiceWorkerRegistration uten SyncManager i TypeScripts DOM-typer. Vi
 * beskriver bare den lille delen vi trenger, så koden også kompilerer for
 * nettlesere som ikke har API-et.
 */
type SyncCapableRegistration = ServiceWorkerRegistration & {
  sync?: {
    register(tag: string): Promise<void>;
  };
};

function serviceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined") return null;
  try {
    return navigator.serviceWorker ?? null;
  } catch {
    // Noen personvernmoduser kaster ved tilgang til navigator.serviceWorker.
    return null;
  }
}

/**
 * Ber nettleseren om å kjøre `DRAFT_SYNC_TAG` når den har nett.
 *
 * `navigator.serviceWorker.ready` venter til en aktiv worker finnes. Vi sjekker
 * først at det faktisk er registrert en worker, slik at kallet ikke blir
 * hengende i utviklingsmodus eller i nettlesere uten service worker. Feil fra
 * manglende støtte, avvist tillatelse eller en worker som ikke er aktiv svelges:
 * kladden ligger uansett i IndexedDB og sendes av den vanlige tømmingen.
 */
export async function requestDraftBackgroundSync(): Promise<boolean> {
  const container = serviceWorkerContainer();
  if (!container) return false;

  try {
    if (typeof container.getRegistration === "function") {
      const existing = await container.getRegistration();
      if (!existing) return false;
    }

    const registration = (await container.ready) as SyncCapableRegistration;
    const sync = registration.sync;
    if (!sync || typeof sync.register !== "function") return false;

    await sync.register(DRAFT_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

function emitSyncEvent(name: string, detail: SyncResultDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<SyncResultDetail>(name, { detail }),
    );
  } catch {
    // Uten CustomEvent-støtte er det ingenting å varsle.
  }
}

export function emitSyncStart(detail: SyncResultDetail): void {
  emitSyncEvent(SYNC_START_EVENT, detail);
}

export function emitSyncProgress(detail: SyncResultDetail): void {
  emitSyncEvent(SYNC_PROGRESS_EVENT, detail);
}

export function emitSyncEnd(detail: SyncResultDetail): void {
  emitSyncEvent(SYNC_END_EVENT, detail);
}
