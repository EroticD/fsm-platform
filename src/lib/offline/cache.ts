import { forgetOfflineUser } from "./draft-outbox";
import { RECENT_SEARCH_STORAGE_KEY } from "@/lib/search-recent";

/** Nøkkelen hurtigsøket og resultatsiden deler. */
const LEGACY_RECENT_SEARCH_KEY = "fsm:recent-searches";

/**
 * Basisnavn for HTML-/RSC-cachen (se public/sw.js). Hver bruker får sin egen
 * cache, `fsm-pages-v1:<userId>`, slik at en annen bruker aldri kan åpne den
 * forrige brukerens oppdragssider offline.
 */
export const OFFLINE_PAGE_CACHE = "fsm-pages-v1";

/** Cachen service workeren bruker for offline-markøren (se public/sw.js). */
export const OFFLINE_META_CACHE = "fsm-offline-meta";

/**
 * Hvor lenge en side kan serveres fra offline-cachen. Selv om økten teknisk
 * sett fortsatt er gyldig, skal en mistet/delt enhet ikke kunne vise kundedata
 * på ubestemt tid. Åtte timer er kortere enn NextAuth-økten (12 timer).
 */
export const OFFLINE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Avgjør om en cache-oppføring med tidsstempel `cachedAt` kan serveres ved
 * tidspunktet `now`. Manglende, ugyldig eller fremtidig tidsstempel avvises,
 * slik at en klokkeendring ikke forlenger levetiden.
 */
export function isCacheEntryFresh(
  cachedAt: number | null | undefined,
  now: number,
): boolean {
  if (
    typeof cachedAt !== "number" ||
    !Number.isFinite(cachedAt) ||
    cachedAt <= 0 ||
    !Number.isFinite(now)
  ) {
    return false;
  }

  const age = now - cachedAt;
  return age >= 0 && age <= OFFLINE_CACHE_TTL_MS;
}

/** Cachenavnet service workeren bruker for én bruker. */
export function offlinePageCacheName(userId: string): string {
  return `${OFFLINE_PAGE_CACHE}:${userId}`;
}

/**
 * Forteller service workeren hvilken bruker som eier offline-cachen.
 * Markøren lagres i CacheStorage av service workeren, slik at den overlever at
 * workeren restartes. Kalles fra offline-banneret etter innlogging.
 */
export function announceOfflineUser(userId: string | null | undefined): void {
  if (!userId) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const post = (worker: ServiceWorker | null) => {
    worker?.postMessage({ type: "SET_OFFLINE_USER", userId });
  };

  post(navigator.serviceWorker.controller);
  navigator.serviceWorker.ready
    .then((registration) => post(registration.active))
    .catch(() => undefined);
}

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
 * Sidene i den brukerscopede page-cachen slettes derimot, sammen med
 * markøren som sier hvilken bruker cachen tilhører.
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
 * Sletter side-cachene og offline-markøren når økten er utløpt eller avvist.
 *
 * Ventende kladder og outbox-oppføringer røres bevisst ikke: de er brukerens
 * uferdige arbeid og skal kunne gjenopprettes etter ny innlogging. Uten
 * markøren viser offline-siden dem ikke til en annen person på en delt enhet.
 */
export async function clearOfflineSessionCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key === OFFLINE_PAGE_CACHE ||
              key.startsWith(`${OFFLINE_PAGE_CACHE}:`) ||
              key === OFFLINE_META_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
    } catch {
      // CacheStorage kan være utilgjengelig.
    }
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: "CLEAR_SESSION_CACHES",
    });
  }

  // Behold kladdene, men glem hvem som eier dem, slik at en annen bruker på
  // samme enhet ikke får dem listet opp på offline-siden.
  forgetOfflineUser();
}

/**
 * Sletter bare den innsendte rapportsideen fra brukerens page-cache. Andre
 * cached forms og oppdragssider skal fortsatt kunne åpnes offline.
 *
 * Kalles etter vellykket innsending, så en offline gjenåpning ikke viser
 * foreldede kundedata for nettopp denne rapporten.
 */
export async function clearOfflinePage(
  userId: string,
  pathname: string,
): Promise<void> {
  if (!userId || !pathname) return;

  if (typeof caches !== "undefined") {
    const name = offlinePageCacheName(userId);
    try {
      if (await caches.has(name)) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        await Promise.all(
          keys
            .filter((request) => {
              try {
                return new URL(request.url).pathname === pathname;
              } catch {
                return false;
              }
            })
            .map((request) => cache.delete(request)),
        );
      }
    } catch {
      // CacheStorage kan være utilgjengelig.
    }
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: "CLEAR_PAGE",
      userId,
      path: pathname,
    });
  }
}

/**
 * Sletter alle brukerscopede page-cacher. Beholdes for full offline-rydding;
 * innsending skal bruke `clearOfflinePage`.
 */
export async function clearOfflinePageCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(
          (key) =>
            key === OFFLINE_PAGE_CACHE ||
            key.startsWith(`${OFFLINE_PAGE_CACHE}:`),
        )
        .map((key) => caches.delete(key)),
    );
  } catch {
    // CacheStorage kan være utilgjengelig.
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PAGE_CACHE" });
  }
}
