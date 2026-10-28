import { forgetOfflineUser } from "./draft-outbox";
import { RECENT_SEARCH_STORAGE_KEY } from "@/lib/search-recent";

/** Nøkkelen hurtigsøket og resultatsiden deler. */
const LEGACY_RECENT_SEARCH_KEY = "fsm:recent-searches";

/** Cache for HTML-sider (se public/sw.js). Ryddes ved utlogging. */
export const OFFLINE_PAGE_CACHE = "fsm-pages-v1";

/**
 * Sletter service-worker-cacher og nylige søk ved utlogging.
 *
 * Ventende kladder og outbox-oppføringer slettes bevisst IKKE her. De er
 * brukerens uferdige arbeid, og å miste dem ved en vanlig utlogging er
 * datatap. De blir liggende i IndexedDB under brukerens id, og en annen bruker
 * kan verken se eller sende dem: outboxen sendes bare for den innloggede
 * brukeren (se `flushDraftOutbox`). Eieren glemmes, slik at neste innlogging
 * må bekrefte hvem som eier køen før noe sendes.
 *
 * `clearOfflineUserData` finnes for et eksplisitt «forkast kladder»-valg.
 */
export async function clearOfflineCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHES" });
  }

  forgetOfflineUser();

  try {
    localStorage.removeItem(RECENT_SEARCH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_RECENT_SEARCH_KEY);
  } catch {
    // Privat modus eller utilgjengelig localStorage.
  }
}

/**
 * Sletter den cachen som kan inneholde en tidligere besøkt rapportside.
 * Kalles etter vellykket innsending, så en offline gjenåpning ikke viser
 * foreldede kundedata.
 */
export async function clearOfflinePageCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(OFFLINE_PAGE_CACHE);
  } catch {
    // CacheStorage kan være utilgjengelig.
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PAGE_CACHE" });
  }
}
