import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_WARMUP_ORDERS, warmOrderDetails } from "./TodayWarmup";

/**
 * Komponenten rendrer ingenting og gjør alt i en effect. Logikken testes
 * derfor direkte: den er det eneste som rører nettverket, og den kan kjøres i
 * node uten DOM.
 */
type FetchCall = {
  url: string;
  init: RequestInit & {
    headers: Record<string, string>;
    cache: string;
    credentials: string;
  };
};

function stubBrowser({
  online = true,
  controller = {} as ServiceWorker | null,
}: {
  online?: boolean;
  controller?: ServiceWorker | null;
} = {}) {
  vi.stubGlobal("navigator", {
    onLine: online,
    serviceWorker: { controller },
  });
}

function stubFetch(
  handler?: (url: string) => Promise<Response> | Response,
): { mock: ReturnType<typeof vi.fn>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (url: string, init: FetchCall["init"]) => {
    calls.push({ url, init });
    if (handler) return handler(url);
    return new Response("flight", {
      status: 200,
      headers: { "content-type": "text/x-component" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TodayWarmup – forhåndshenting av dagens oppdrag", () => {
  it("henter maks åtte detaljsider sekvensielt med RSC-header", async () => {
    stubBrowser();
    const { calls } = stubFetch();
    const ids = Array.from(
      { length: MAX_WARMUP_ORDERS + 4 },
      (_, index) => `wo-${index}`,
    );

    await expect(warmOrderDetails(ids, { gapMs: 0 })).resolves.toBe(
      MAX_WARMUP_ORDERS,
    );

    expect(calls.map((call) => call.url)).toEqual(
      ids.slice(0, MAX_WARMUP_ORDERS).map((id) => `/mine-oppdrag/${id}`),
    );
    for (const call of calls) {
      // RSC-headeren er det som gjør at service workeren cacher svaret i det
      // hele tatt; uten den ser workeren en vanlig cors-forespørsel.
      expect(call.init.headers.RSC).toBe("1");
      expect(call.init.cache).toBe("no-store");
      expect(call.init.credentials).toBe("same-origin");
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("gjør ingenting når nettleseren er offline", async () => {
    stubBrowser({ online: false });
    const { mock } = stubFetch();

    await expect(warmOrderDetails(["wo-1"], { gapMs: 0 })).resolves.toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("gjør ingenting uten aktiv service worker", async () => {
    stubBrowser({ controller: null });
    const { mock } = stubFetch();

    await expect(warmOrderDetails(["wo-1"], { gapMs: 0 })).resolves.toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("avbryter resten når komponenten avmonteres", async () => {
    stubBrowser();
    const { mock } = stubFetch();
    const controller = new AbortController();

    const running = warmOrderDetails(["wo-1", "wo-2", "wo-3"], {
      signal: controller.signal,
      gapMs: 5_000,
    });

    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(running).resolves.toBe(1);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("hopper over tomme og dupliserte id-er", async () => {
    stubBrowser();
    const { calls } = stubFetch();

    await expect(
      warmOrderDetails([" wo-1 ", "wo-1", "", "   ", "wo-2"], { gapMs: 0 }),
    ).resolves.toBe(2);

    expect(calls.map((call) => call.url)).toEqual([
      "/mine-oppdrag/wo-1",
      "/mine-oppdrag/wo-2",
    ]);
  });

  it("fortsetter med neste oppdrag når ett feiler", async () => {
    stubBrowser();
    const { calls } = stubFetch((url) => {
      if (url.endsWith("/wo-1")) throw new TypeError("nettverksfeil");
      return new Response("flight", { status: 200 });
    });

    await expect(
      warmOrderDetails(["wo-1", "wo-2"], { gapMs: 0 }),
    ).resolves.toBe(1);
    expect(calls.map((call) => call.url)).toEqual([
      "/mine-oppdrag/wo-1",
      "/mine-oppdrag/wo-2",
    ]);
  });

  it("teller ikke responser som ikke er OK", async () => {
    stubBrowser();
    stubFetch(() => new Response("nope", { status: 503 }));

    await expect(warmOrderDetails(["wo-1"], { gapMs: 0 })).resolves.toBe(0);
  });
});
