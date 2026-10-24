import { clearOfflineData } from "./db";

/**
 * Sletter service-worker-cacher og lokale kladder. Kalles ved utlogging, slik
 * at en delt enhet ikke etterlater kundedata eller en annen brukers outbox.
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
}
