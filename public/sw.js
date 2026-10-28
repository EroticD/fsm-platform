/* FSM feltapp – statisk service worker.
 *
 * Cacher statiske ressurser og den offentlige offline-siden. I tillegg caches
 * selve rapporteringsskjemaet etter at det er åpnet med nett, slik at montøren
 * kan åpne samme oppdrag igjen offline og få kladden gjenopprettet fra
 * IndexedDB. HTML for andre sider caches ikke, og siden-cachen ryddes ved
 * utlogging og etter innsending.
 */
const CACHE = "fsm-static-v3";
const PAGE_CACHE = "fsm-pages-v1";
const OFFLINE_URL = "/offline.html";

/** Bare rapporteringsskjemaet caches – det er her offline-kladden hører hjemme. */
function isReportFormPage(pathname) {
  return /^\/mine-oppdrag\/[^/]+\/skjema\/[^/]+\/?$/.test(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE && key !== PAGE_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
  if (event.data.type === "CLEAR_PAGE_CACHE") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icon-") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/android-chrome-") ||
    pathname.startsWith("/apple-touch-icon") ||
    pathname.startsWith("/maskable-") ||
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".woff")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/") ||
    url.pathname.startsWith("/_next/data/")
  ) {
    return;
  }

  // Sider: network-first. Rapporteringsskjemaet caches, slik at samme oppdrag
  // kan åpnes offline; alle andre sider faller tilbake til offline-siden.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.ok &&
            isReportFormPage(url.pathname) &&
            !request.headers.get("RSC")
          ) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline || Response.error();
        }),
    );
    return;
  }

  // Statiske filer: cache-first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
