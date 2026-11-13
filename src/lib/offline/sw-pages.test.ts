import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Verifiserer at forhåndshentingen i TodayWarmup faktisk treffer sidecachen.
 *
 * Komponenten sender `fetch("/mine-oppdrag/<id>", { headers: { RSC: "1" } })`.
 * Her kjører vi den ekte `public/sw.js` i en sandkasse og sender den samme
 * forespørselen gjennom fetch-handleren, slik at vi ser hva workeren gjør med
 * den: RSC-en havner i sidecachen, og `ensureHtmlCached` legger HTML-versjonen
 * ved siden av. En vanlig `fetch(url)` (mode cors, uten RSC-header) blir ikke
 * cachet i det hele tatt – derfor er headeren påkrevd.
 */
const swSource = readFileSync(
  new URL("../../../public/sw.js", import.meta.url),
  "utf8",
);

const PAGE_CACHE = "fsm-pages-v1:u1";
const PAGE_URL = "https://fsm.example/mine-oppdrag/wo-1";

type Key = Request | string;

function keyOf(key: Key): string {
  return typeof key === "string" ? key : key.url;
}

class FakeCache {
  readonly entries = new Map<string, Response>();

  async put(key: Key, response: Response) {
    this.entries.set(keyOf(key), response.clone());
  }

  async match(key: Key) {
    const stored = this.entries.get(keyOf(key));
    return stored ? stored.clone() : undefined;
  }

  async delete(key: Key) {
    return this.entries.delete(keyOf(key));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

function createCaches(userId: string | null) {
  const stores = new Map<string, FakeCache>();
  const open = (name: string) => {
    let cache = stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      stores.set(name, cache);
    }
    return cache;
  };

  if (userId) {
    void open("fsm-offline-meta").put(
      "/__fsm/offline-user",
      new Response(userId),
    );
  }

  return {
    stores,
    api: {
      async open(name: string) {
        return open(name);
      },
      async keys() {
        return [...stores.keys()];
      },
      async delete(name: string) {
        return stores.delete(name);
      },
      async match(key: Key) {
        for (const cache of stores.values()) {
          const found = await cache.match(key);
          if (found) return found;
        }
        return undefined;
      },
    },
  };
}

type Dispatch = { response?: Response; waits: Promise<unknown>[] };

function loadWorker(options: {
  userId?: string | null;
  fetch: ReturnType<typeof vi.fn>;
}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const { stores, api } = createCaches(
    options.userId === undefined ? "u1" : options.userId,
  );

  const self = {
    location: { origin: "https://fsm.example" },
    navigator: { onLine: true },
    clients: { matchAll: async () => [], claim: () => undefined },
    skipWaiting: () => undefined,
    registration: { sync: { register: async () => undefined } },
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler);
    },
  };

  const sandbox = {
    self,
    caches: api,
    indexedDB: undefined,
    fetch: options.fetch,
    URL,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(swSource, sandbox, { filename: "public/sw.js" });

  async function dispatchFetch(request: Request): Promise<Dispatch> {
    const handler = listeners.get("fetch");
    if (!handler) throw new Error("Mangler fetch-handler");
    const waits: Promise<unknown>[] = [];
    let responded: Promise<unknown> | undefined;
    handler({
      request,
      respondWith(promise: Promise<unknown>) {
        responded = promise;
      },
      waitUntil(promise: Promise<unknown>) {
        waits.push(promise);
      },
    });
    const response = responded
      ? ((await responded) as Response | undefined)
      : undefined;
    return { response, waits };
  }

  return { dispatchFetch, stores };
}

/** Cache-skrivingen er bevisst ikke awaited i workeren; la den bli ferdig. */
async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function flightFetch() {
  return vi.fn(async (input: Request | string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers.Accept === "text/html") {
      return new Response("<html>detaljside</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    // Første argument er en Request når workeren videresender klientens kall.
    expect(input).toBeInstanceOf(Request);
    return new Response("flight-payload", {
      status: 200,
      headers: { "content-type": "text/x-component" },
    });
  });
}

describe("service worker – forhåndshenting av dagens oppdrag", () => {
  it("legger både RSC og HTML i sidecachen for en RSC-forespørsel", async () => {
    const fetchMock = flightFetch();
    const { dispatchFetch, stores } = loadWorker({ fetch: fetchMock });

    // Nøyaktig slik TodayWarmup kaller fetch.
    const request = new Request(PAGE_URL, {
      method: "GET",
      headers: { RSC: "1" },
    });

    const { response, waits } = await dispatchFetch(request);
    await Promise.all(waits);
    await settle();

    expect(response?.ok).toBe(true);

    const page = stores.get(PAGE_CACHE);
    const keys = [...(page?.entries.keys() ?? [])];
    expect(keys).toContain(`${PAGE_URL}?__fsm=rsc`);
    expect(keys).toContain(`${PAGE_URL}?__fsm=html`);
    expect(keys.some((key) => key.includes("__fsm=rsc-meta"))).toBe(true);

    // RSC-en er flight-payloaden, HTML-en er den fulle siden – begge trengs:
    // klientnavigasjon leser RSC, full omlasting leser HTML.
    expect(await page?.entries.get(`${PAGE_URL}?__fsm=rsc`)?.text()).toBe(
      "flight-payload",
    );
    expect(await page?.entries.get(`${PAGE_URL}?__fsm=html`)?.text()).toContain(
      "detaljside",
    );
  });

  it("cacher ingenting for en vanlig fetch uten RSC-header", async () => {
    const fetchMock = flightFetch();
    const { dispatchFetch, stores } = loadWorker({ fetch: fetchMock });

    const { response } = await dispatchFetch(new Request(PAGE_URL));
    await settle();

    // Workeren lar cors-forespørsler gå rett til nettet: den verken svarer
    // eller cacher. Derfor må komponenten sende RSC-headeren.
    expect(response).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stores.has(PAGE_CACHE)).toBe(false);
  });

  it("cacher ikke Next.js-prefetch, men komponentens kall gjør det", async () => {
    const fetchMock = flightFetch();
    const { dispatchFetch, stores } = loadWorker({ fetch: fetchMock });

    await dispatchFetch(
      new Request(PAGE_URL, {
        headers: { RSC: "1", "next-router-prefetch": "1" },
      }),
    );
    await settle();
    expect(stores.has(PAGE_CACHE)).toBe(false);

    const { waits } = await dispatchFetch(
      new Request(PAGE_URL, { headers: { RSC: "1" } }),
    );
    await Promise.all(waits);
    await settle();
    expect(stores.get(PAGE_CACHE)?.entries.has(`${PAGE_URL}?__fsm=rsc`)).toBe(
      true,
    );
  });

  it("cacher ikke når workeren ikke vet hvilken bruker cachen tilhører", async () => {
    const fetchMock = flightFetch();
    const { dispatchFetch, stores } = loadWorker({
      userId: null,
      fetch: fetchMock,
    });

    await dispatchFetch(
      new Request(PAGE_URL, { method: "GET", headers: { RSC: "1" } }),
    );
    await settle();

    expect(stores.has(PAGE_CACHE)).toBe(false);
  });
});
