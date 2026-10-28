import { clearOfflineData } from "./db";
import { forgetOfflineUser } from "./draft-outbox";
import { RECENT_SEARCH_STORAGE_KEY } from "@/lib/search-recent";

/** Nøkkelen hurtigsøket og resultatsiden deler. */
const LEGACY_RECENT_SEARCH_KEY = "fsm:recent-searches";

/**
 * Sletter service-worker-cacher, lokale kladder og nylige søk. Kalles ved
 * utlogging, slik at en delt enhet ikke etterlater kundedata, en annen brukers
 * outbox eller søkehistorikk.
 */
export async function clearOfflineCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHES" });
  }

  await clearOfflineData();
  forgetOfflineUser();

  try {
    localStorage.removeItem(RECENT_SEARCH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_RECENT_SEARCH_KEY);
  } catch {
    // Privat modus eller utilgjengelig localStorage.
  }
}
