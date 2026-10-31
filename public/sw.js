/* FSM feltapp – statisk service worker.
 *
 * Offline-modell:
 *  - Feltportalens sider (`/mine-oppdrag`, oppdragsdetaljer og rapporterings-
 *    skjemaet) caches network-first, både som HTML og som RSC-payload. Da kan
 *    montøren både åpne appen på nytt og navigere mellom oppdrag uten nett.
 *  - Hver bruker har sin egen side-cache, `fsm-pages-v1:<userId>`. Brukeren
 *    meldes inn fra offline-banneret og lagres som en markør i CacheStorage, så
 *    den overlever at workeren restartes. Ved utlogging slettes alle cacher.
 *  - Hver side-cache-oppføring har et tidsstempel i samme cache. Oppføringer
 *    eldre enn åtte timer slettes og serveres aldri, og en 401/403 eller
 *    omdirigering til innlogging tømmer side-cachene og markøren.
 *  - RSC-navigasjon som mangler cache får feile, slik at Next.js faller tilbake
 *    til en vanlig nettlesernavigasjon. Den treffer da HTML-cachen eller
 *    offline-siden.
 *  - Statiske filer og offline-siden caches cache-first.
 */
const CACHE = "fsm-static-v5";
const PAGE_CACHE_PREFIX = "fsm-pages-v1:";
const LEGACY_PAGE_CACHE = "fsm-pages-v1";
const META_CACHE = "fsm-offline-meta";
const OFFLINE_USER_KEY = "/__fsm/offline-user";
const OFFLINE_URL = "/offline.html";
const OFFLINE_SCRIPT_URL = "/offline.js";
const LOGIN_PATH = "/logg-inn";

/** Samme grense som OFFLINE_CACHE_TTL_MS i src/lib/offline/cache.ts. */
const CACHE_TTL_MS = 8 * 60 * 60 * 1000;

const HTML_KIND = "html";
const RSC_KIND = "rsc";
const META_KIND_SUFFIX = "meta";

/*
 * Bakgrunnssynk av offline-kladden.
 *
 * Workeren leser samme IndexedDB som appen (`fsm-offline`) og replayer bare
 * gjeldende offline-brukers outbox til `/api/offline/draft`. Reglene for
 * nyeste-per-rapport, terminale feil og backoff speiler
 * src/lib/offline/outbox-order.ts. Hold konstantene i takt med den filen.
 *
 * Begrensning: Background Sync støttes i praksis bare av Chromium-nettlesere.
 * Nettleseren bestemmer selv når jobben kjøres, og en utløpt innlogging gir
 * 401 – da stopper vi uten å brenne forsøkene. Uten støtte sendes kladden først
 * når appen åpnes og banneret tømmer køen.
 */
const OFFLINE_DB_NAME = "fsm-offline";
const OFFLINE_DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const OUTBOX_STORE = "outbox";
const DRAFT_SYNC_TAG = "fsm-draft-sync";
const DRAFT_SYNC_RESULT_MESSAGE = "FSM_DRAFT_SYNC_RESULT";
const MAX_OUTBOX_PAYLOAD_BYTES = 2_000_000;
const MAX_OUTBOX_ATTEMPTS = 10;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 30 * 60_000;

/** Rapporteringsskjemaet – fortsatt den viktigste offline-siden. */
function isReportFormPage(pathname) {
  return /^\/mine-oppdrag\/[^/]+\/skjema\/[^/]+\/?$/.test(pathname);
}

/** Sider som skal kunne åpnes offline i feltportalen. */
function isFieldPage(pathname) {
  if (pathname === "/mine-oppdrag" || pathname === "/mine-oppdrag/") {
    return true;
  }
  if (isReportFormPage(pathname)) return true;

  // /mine-oppdrag/<id>, men ikke de faste undersidene.
  const match = /^\/mine-oppdrag\/([^/]+)\/?$/.exec(pathname);
  if (!match) return false;
  return !["ny", "kunder", "offline"].includes(match[1]);
}

function isStaticAsset(pathname) {
  return (
    pathname === OFFLINE_SCRIPT_URL ||
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

function pageCacheName(userId) {
  return `${PAGE_CACHE_PREFIX}${userId}`;
}

/**
 * Cache-nøkkel uten query-parametere og med en markør for HTML/RSC. Uten
 * markøren ville HTML og RSC for samme URL overskrevet hverandre i Cache API.
 */
function pageCacheKey(url, kind) {
  const key = new URL(url.origin + url.pathname);
  key.searchParams.set("__fsm", kind);
  return new Request(key.toString(), { method: "GET" });
}

/**
 * Tidsstempelet ligger som en egen liten oppføring i samme cache. Da slipper vi
 * å skrive om selve svaret (som kan være komprimert), og `CLEAR_PAGE` rydder
 * både siden og metadataen fordi de har samme pathname.
 */
function pageMetaKey(url, kind) {
  return pageCacheKey(url, `${kind}-${META_KIND_SUFFIX}`);
}

/** Samme regel som isCacheEntryFresh i src/lib/offline/cache.ts. */
function isFreshCacheEntry(cachedAt, now) {
  if (
    !Number.isFinite(cachedAt) ||
    cachedAt <= 0 ||
    !Number.isFinite(now)
  ) {
    return false;
  }
  const age = now - cachedAt;
  return age >= 0 && age <= CACHE_TTL_MS;
}

async function readOfflineUser() {
  try {
    const cache = await caches.open(META_CACHE);
    const response = await cache.match(OFFLINE_USER_KEY);
    const userId = response ? (await response.text()).trim() : "";
    return userId || null;
  } catch {
    return null;
  }
}

async function writeOfflineUser(userId) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    OFFLINE_USER_KEY,
    new Response(userId, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
  );
}

async function clearOfflineUser() {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.delete(OFFLINE_USER_KEY);
  } catch {
    // CacheStorage kan være utilgjengelig.
  }
}

/* -------------------------------------------------------------------------
 * Outbox-replay i bakgrunnen
 * ---------------------------------------------------------------------- */

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function withOfflineStore(storeName, mode, action) {
  if (typeof indexedDB === "undefined") return null;
  const db = await openOfflineDb();
  try {
    const transaction = db.transaction(storeName, mode);
    const result = await action(transaction.objectStore(storeName));
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function payloadReportIdentity(payload) {
  try {
    const parsed = JSON.parse(payload);
    const workOrderId = nonEmptyString(parsed.workOrderId);
    const templateId = nonEmptyString(parsed.templateId);
    if (!workOrderId || !templateId) return null;
    return { workOrderId, templateId };
  } catch {
    return null;
  }
}

function itemReportIdentity(item) {
  if (item.workOrderId && item.templateId) {
    return { workOrderId: item.workOrderId, templateId: item.templateId };
  }
  return payloadReportIdentity(item.payload);
}

function reportKey(userId, identity) {
  return `${userId}:${identity.workOrderId}:${identity.templateId}`;
}

function sortOutboxOldestFirst(items) {
  return [...items].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

function newestPerReport(items, userId) {
  const ordered = sortOutboxOldestFirst(items);
  const newest = new Map();

  for (const item of ordered) {
    if (item.userId !== userId) continue;
    const identity = itemReportIdentity(item);
    if (!identity) continue;
    newest.set(reportKey(userId, identity), item);
  }

  const stale = [];
  const toSend = [];
  for (const item of ordered) {
    if (item.userId !== userId) continue;
    const identity = itemReportIdentity(item);
    if (!identity) {
      toSend.push(item);
      continue;
    }
    if (newest.get(reportKey(userId, identity)) === item) {
      toSend.push(item);
    } else {
      stale.push(item);
    }
  }

  return { ordered: toSend, stale };
}

function isOutboxTerminal(item) {
  return typeof item.failedAt === "number" && item.failedAt > 0;
}

function isAttemptLimitReached(attempts) {
  return attempts >= MAX_OUTBOX_ATTEMPTS;
}

function isOutboxReady(item, now) {
  if (isOutboxTerminal(item)) return false;
  return !item.nextAttemptAt || item.nextAttemptAt <= now;
}

function retryDelayMs(attempts) {
  const exponent = Math.max(0, Math.min(attempts - 1, 16));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
}

function payloadByteLength(payload) {
  if (typeof TextEncoder === "undefined") return payload.length;
  return new TextEncoder().encode(payload).byteLength;
}

function isPayloadWithinLimit(payload) {
  return payloadByteLength(payload) <= MAX_OUTBOX_PAYLOAD_BYTES;
}

async function listOutboxForUser(userId) {
  const result = await withOfflineStore(OUTBOX_STORE, "readonly", (store) =>
    requestResult(store.getAll()),
  );
  return sortOutboxOldestFirst((result ?? []).filter(
    (item) => item.userId === userId,
  ));
}

async function removeOutboxItem(id) {
  await withOfflineStore(OUTBOX_STORE, "readwrite", (store) => {
    store.delete(id);
    return Promise.resolve(undefined);
  });
}

/**
 * Marker den lokale kladden som synkronisert når bakgrunnssynken har sendt
 * outbox-oppføringen. Uten dette ville `pendingDraftSummary` fortsatt telt
 * kladden som ventende, og appen ville sendt samme payload på nytt ved neste
 * åpning. En nyere lokal kladd skal fortsatt sendes, så vi sammenligner
 * `updatedAt` med outbox-oppføringens `createdAt`.
 */
async function markDraftSyncedInBackground(userId, item) {
  const identity = itemReportIdentity(item);
  if (!identity) return;
  const key = reportKey(userId, identity);
  await withOfflineStore(DRAFT_STORE, "readwrite", async (store) => {
    const draft = await requestResult(store.get(key));
    if (!draft || draft.updatedAt > item.createdAt) return undefined;
    if ((draft.syncedAt ?? 0) >= draft.updatedAt) return undefined;
    const next = { ...draft, syncedAt: draft.updatedAt };
    delete next.syncError;
    store.put(next);
    return undefined;
  });
}

/**
 * Oppdaterer bare dersom oppføringen fortsatt har samme forsøksteller. Det
 * hindrer at en sen bakgrunnssynk skriver over en nyere tilstand fra appen.
 */
async function updateOutboxItem(item, update) {
  await withOfflineStore(OUTBOX_STORE, "readwrite", async (store) => {
    const current = await requestResult(store.get(item.id));
    if (!current || current.attempts !== item.attempts) return undefined;
    store.put(update(current));
    return undefined;
  });
}

async function recordOutboxFailure(item, reason) {
  const attempts = item.attempts + 1;
  const terminal = isAttemptLimitReached(attempts);
  await updateOutboxItem(item, (current) => {
    const next = { ...current, attempts };
    if (terminal) {
      next.failedAt = Date.now();
      next.failureReason = reason;
      next.nextAttemptAt = 0;
    } else {
      next.nextAttemptAt = Date.now() + retryDelayMs(attempts);
    }
    return next;
  });
}

function summarizeOutbox(items, userId) {
  const pendingKeys = new Set();
  const failedKeys = new Set();

  for (const item of items) {
    if (item.userId !== userId) continue;
    const identity = itemReportIdentity(item);
    const key = identity ? reportKey(userId, identity) : `outbox:${item.id}`;
    if (isOutboxTerminal(item) || isAttemptLimitReached(item.attempts)) {
      failedKeys.add(key);
    } else {
      pendingKeys.add(key);
    }
  }

  for (const key of failedKeys) pendingKeys.delete(key);
  return { pending: pendingKeys.size, failed: failedKeys.size };
}

/**
 * Replayer gjeldende brukers outbox. Returnerer `retry` når en nettverks- eller
 * serverfeil gjorde at noe fortsatt venter, slik at `sync`-hendelsen kan
 * avvises og nettleseren prøver igjen senere. Autorisasjonsfeil gir ikke retry:
 * da må brukeren logge inn igjen først.
 */
async function replayDraftOutbox(userId) {
  const all = await listOutboxForUser(userId);
  const { ordered, stale } = newestPerReport(all, userId);

  for (const item of stale) {
    await removeOutboxItem(item.id);
  }

  let sent = 0;
  let retry = false;
  let authBlocked = false;
  const now = Date.now();

  for (const item of ordered) {
    if (isAttemptLimitReached(item.attempts)) {
      await updateOutboxItem(item, (current) => ({
        ...current,
        attempts: current.attempts,
        failedAt: Date.now(),
        failureReason: "attempts-exhausted",
        nextAttemptAt: 0,
      }));
      continue;
    }
    if (!isOutboxReady(item, now)) continue;

    if (!isPayloadWithinLimit(item.payload)) {
      await updateOutboxItem(item, (current) => ({
        ...current,
        failedAt: Date.now(),
        failureReason: "payload-too-large",
        nextAttemptAt: 0,
      }));
      continue;
    }

    let response;
    try {
      response = await fetch(
        new URL("/api/offline/draft", self.location.origin).toString(),
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: item.payload,
        },
      );
    } catch {
      await recordOutboxFailure(item, "network");
      retry = true;
      // Nettet er sannsynligvis borte. Ikke brenn forsøk på resten av køen.
      break;
    }

    if (response.ok) {
      // Marker kladden først, slik at en samtidig app-åpning ikke rekker å
      // enqueue den på nytt før outbox-oppføringen forsvinner.
      await markDraftSyncedInBackground(userId, item);
      await removeOutboxItem(item.id);
      sent += 1;
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      // Økten er utløpt. Behold kladden og prøv ikke igjen før brukeren har
      // logget inn på nytt.
      authBlocked = true;
      break;
    }

    if (response.status === 400 || response.status === 413) {
      await updateOutboxItem(item, (current) => ({
        ...current,
        failedAt: Date.now(),
        failureReason:
          response.status === 413 ? "payload-too-large" : "rejected",
        nextAttemptAt: 0,
      }));
      continue;
    }

    await recordOutboxFailure(item, `http-${response.status}`);
    retry = true;
    // 429/5xx gjelder tjenesten, ikke én kladd. Stopp og la backoffen virke.
    break;
  }

  const remaining = await listOutboxForUser(userId);
  return {
    sent,
    ...summarizeOutbox(remaining, userId),
    retry: retry && !authBlocked,
  };
}

async function notifyDraftSyncResult(result) {
  try {
    const clientList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of clientList) {
      client.postMessage({
        type: DRAFT_SYNC_RESULT_MESSAGE,
        result,
      });
    }
  } catch {
    // Uten åpne klienter er det ingenting å varsle.
  }
}

async function handleDraftSyncEvent() {
  // Brukeren må være kjent fra CacheStorage-markøren. Uten den kan en
  // bakgrunnssynk ikke vite hvilken outbox som er gjeldende brukers.
  const userId = await readOfflineUser();
  if (!userId) return;
  if (typeof indexedDB === "undefined") return;
  if (self.navigator && self.navigator.onLine === false) {
    // Nettleseren kan ha vekket oss før nettet er klart. Avvis, så prøver den
    // igjen senere i stedet for at vi markerer kladden som feilet.
    throw new Error("draft-sync-offline");
  }

  const outcome = await replayDraftOutbox(userId);
  await notifyDraftSyncResult({
    sent: outcome.sent,
    pending: outcome.pending,
    failed: outcome.failed,
  });

  if (outcome.retry) {
    // Avvist sync-hendelse gjør at nettleseren prøver igjen senere. Selve
    // backoffen er allerede skrevet på outbox-oppføringen.
    throw new Error("draft-sync-retry");
  }
}

/**
 * Tømmer side-cachene for brukeren som er markert, og glemmer markøren. Uten
 * markør vet vi ikke hvilken cache som er «brukerens», og da ryddes alle
 * side-cacher. Kladder i IndexedDB røres ikke.
 */
async function clearSessionCaches() {
  try {
    const userId = await readOfflineUser();
    const own = userId ? pageCacheName(userId) : null;
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => {
          if (key === LEGACY_PAGE_CACHE) return true;
          if (own) return key === own;
          return key.startsWith(PAGE_CACHE_PREFIX);
        })
        .map((key) => caches.delete(key)),
    );
  } catch {
    // CacheStorage kan være utilgjengelig.
  }
  await clearOfflineUser();
}

async function cachePageResponse(url, kind, response, userId) {
  if (!response || !response.ok || !userId) return;
  try {
    const cache = await caches.open(pageCacheName(userId));
    const cachedAt = Date.now();
    await cache.put(pageCacheKey(url, kind), response.clone());
    await cache.put(
      pageMetaKey(url, kind),
      new Response(String(cachedAt), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  } catch {
    // CacheStorage kan være full eller utilgjengelig.
  }
}

async function matchPage(url, kind, userId) {
  if (!userId) return null;
  try {
    const cache = await caches.open(pageCacheName(userId));
    const key = pageCacheKey(url, kind);
    const cached = await cache.match(key);
    if (!cached) return null;

    const meta = await cache.match(pageMetaKey(url, kind));
    const cachedAt = meta ? Number((await meta.text()).trim()) : Number.NaN;
    if (!isFreshCacheEntry(cachedAt, Date.now())) {
      await Promise.all([
        cache.delete(key),
        cache.delete(pageMetaKey(url, kind)),
      ]);
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

function isLoginPath(pathname) {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

/** En nettverksforespørsel som viser at økten er borte eller avvist. */
function isAuthFailure(response, url, assumeLoginRedirect = false) {
  if (!response) return false;
  if (response.status === 401 || response.status === 403) return true;
  // Navigasjonsforespørsler kan ha redirect-mode «manual». Da er målet skjult,
  // men en omdirigering fra en feltside er i praksis innlogging.
  if (assumeLoginRedirect && response.type === "opaqueredirect") return true;

  // Bare en faktisk omdirigering til innlogging teller. En direkte navigasjon
  // til /logg-inn skal ikke tømme cachene til en innlogget bruker.
  if (response.redirected) {
    try {
      if (isLoginPath(new URL(response.url, url).pathname)) return true;
    } catch {
      // Ugyldig respons-URL.
    }
  }

  const location = response.headers.get("location");
  if (location) {
    try {
      if (isLoginPath(new URL(location, url).pathname)) return true;
    } catch {
      // Ugyldig Location-header.
    }
  }

  return false;
}

/**
 * Sørger for at en side som bare er besøkt med klientnavigasjon (RSC) også har
 * en HTML-versjon. Da virker en full omlasting/åpning av PWA-en offline.
 * Kjøres bare når HTML mangler, og aldri for prefetch.
 */
const htmlFetches = new Set();
async function ensureHtmlCached(url, userId) {
  if (!userId || htmlFetches.has(url.pathname)) return;
  const existing = await matchPage(url, HTML_KIND, userId);
  if (existing) return;

  htmlFetches.add(url.pathname);
  try {
    const response = await fetch(url.origin + url.pathname, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
      cache: "no-store",
    });
    if (isAuthFailure(response, url, true)) {
      await clearSessionCaches();
      return;
    }
    if (
      response.ok &&
      (response.headers.get("content-type") || "").startsWith("text/html")
    ) {
      const responsePath = new URL(response.url, url).pathname;
      if (responsePath === url.pathname) {
        await cachePageResponse(url, HTML_KIND, response, userId);
      }
    }
  } catch {
    // Uten nett er det ingenting å forhåndscache.
  } finally {
    htmlFetches.delete(url.pathname);
  }
}

/**
 * Offline-siden er en statisk fil og kan derfor ikke få en per-forespørsel
 * nonce. Når CSP-en inneholder 'strict-dynamic', ignorerer nettleseren 'self',
 * og da ville /offline.js blitt blokkert. Fjern bare strict-dynamic for denne
 * ene siden uten brukerdata, slik at script-src 'self' faktisk gjelder.
 */
async function offlinePageResponse(response) {
  if (!response || !response.ok) return response;
  const csp = response.headers.get("content-security-policy");
  if (!csp || !csp.includes("'strict-dynamic'")) return response;

  try {
    const body = await response.clone().text();
    const headers = new Headers(response.headers);
    headers.set(
      "content-security-policy",
      csp.replace(/\s*'strict-dynamic'/g, ""),
    );
    // Body er lest som tekst og er ikke lenger komprimert.
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

async function offlineFallback() {
  const offline = await caches.match(OFFLINE_URL);
  return offline ? offlinePageResponse(offline) : Response.error();
}

async function navigationResponse(request, url) {
  const fieldPage = isFieldPage(url.pathname);
  try {
    const response = await fetch(request);
    if (isAuthFailure(response, url, fieldPage)) {
      await clearSessionCaches();
      return response;
    }
    if (fieldPage && response.ok) {
      // Ikke cache en innloggingsomdirigering under oppdragssidens URL.
      const responsePath = new URL(response.url, url).pathname;
      if (responsePath === url.pathname) {
        const userId = await readOfflineUser();
        await cachePageResponse(url, HTML_KIND, response, userId);
      }
    }
    return response;
  } catch {
    if (fieldPage) {
      const userId = await readOfflineUser();
      const cached = await matchPage(url, HTML_KIND, userId);
      if (cached) return cached;
    }
    return offlineFallback();
  }
}

async function rscResponse(request, url, prefetch) {
  const fieldPage = isFieldPage(url.pathname);
  try {
    const response = await fetch(request);
    if (isAuthFailure(response, url, fieldPage)) {
      await clearSessionCaches();
      return response;
    }
    const contentType = response.headers.get("content-type") || "";
    if (
      fieldPage &&
      !prefetch &&
      response.ok &&
      contentType.startsWith("text/x-component")
    ) {
      const userId = await readOfflineUser();
      await cachePageResponse(url, RSC_KIND, response, userId);
    }
    return response;
  } catch {
    if (fieldPage) {
      const userId = await readOfflineUser();
      const cached = await matchPage(url, RSC_KIND, userId);
      if (cached) return cached;
    }
    // Ingen RSC-cache: la Next.js falle tilbake til full navigasjon. Den
    // treffer HTML-cachen eller offline-siden i `navigationResponse`.
    throw new Error("offline-rsc");
  }
}

async function nextDataResponse(request, url) {
  try {
    const response = await fetch(request);
    if (isAuthFailure(response, url, isFieldPage(url.pathname))) {
      await clearSessionCaches();
      return response;
    }
    if (response.ok) {
      const userId = await readOfflineUser();
      await cachePageResponse(url, RSC_KIND, response, userId);
    }
    return response;
  } catch {
    const userId = await readOfflineUser();
    const cached = await matchPage(url, RSC_KIND, userId);
    if (cached) return cached;
    throw new Error("offline-next-data");
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, OFFLINE_SCRIPT_URL]))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key !== CACHE &&
              key !== META_CACHE &&
              !key.startsWith(PAGE_CACHE_PREFIX),
          )
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
    return;
  }

  if (data.type === "CLEAR_PAGE_CACHE") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key === LEGACY_PAGE_CACHE ||
                key.startsWith(PAGE_CACHE_PREFIX),
            )
            .map((key) => caches.delete(key)),
        ),
      ),
    );
    return;
  }

  if (data.type === "CLEAR_SESSION_CACHES") {
    event.waitUntil(clearSessionCaches());
    return;
  }

  if (data.type === "SET_OFFLINE_USER" && typeof data.userId === "string") {
    const userId = data.userId.trim();
    if (!userId) return;
    event.waitUntil(
      (async () => {
        await writeOfflineUser(userId);
        const own = pageCacheName(userId);
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith(PAGE_CACHE_PREFIX) && key !== own) ||
                key === LEGACY_PAGE_CACHE,
            )
            .map((key) => caches.delete(key)),
        );
        // Sørg for at selve oppdragslisten finnes offline, selv om brukeren
        // aldri har lastet den på nytt etter at workeren ble aktiv.
        await ensureHtmlCached(
          new URL("/mine-oppdrag", self.location.origin),
          userId,
        );
      })(),
    );
    return;
  }

  if (data.type === "CLEAR_PAGE" && typeof data.userId === "string") {
    const userId = data.userId.trim();
    const path = typeof data.path === "string" ? data.path : "";
    if (!userId || !path.startsWith("/")) return;
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open(pageCacheName(userId));
          const keys = await cache.keys();
          await Promise.all(
            keys
              .filter((request) => {
                try {
                  return new URL(request.url).pathname === path;
                } catch {
                  return false;
                }
              })
              .map((request) => cache.delete(request)),
          );
        } catch {
          // Ingenting å rydde.
        }
      })(),
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== DRAFT_SYNC_TAG) return;
  event.waitUntil(handleDraftSyncEvent());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/") ||
    url.pathname === "/sw.js"
  ) {
    return;
  }

  // Offline-siden og statiske filer: cache-first.
  if (url.pathname === OFFLINE_URL) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return offlinePageResponse(cached);
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return offlinePageResponse(response);
      }),
    );
    return;
  }

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
    return;
  }

  const rsc =
    request.headers.get("rsc") === "1" || url.searchParams.has("_rsc");
  const prefetch =
    request.headers.has("next-router-prefetch") ||
    request.headers.has("next-router-segment-prefetch");

  if (url.pathname.startsWith("/_next/data/")) {
    event.respondWith(nextDataResponse(request, url));
    return;
  }

  if (rsc) {
    event.respondWith(rscResponse(request, url, prefetch));
    // RSC-navigasjonen gir bare et fragment. Sørg for at hele siden også
    // finnes som HTML, slik at en full omlasting offline fungerer.
    if (!prefetch && isFieldPage(url.pathname)) {
      event.waitUntil(
        readOfflineUser().then((userId) =>
          ensureHtmlCached(url, userId ?? undefined),
        ),
      );
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request, url));
    return;
  }
});
