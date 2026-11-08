import { afterEach, describe, expect, it, vi } from "vitest";
import { createHaversineProvider } from "./haversine";
import { resolveRoutingProvider } from "./osrm";
import {
  createTrafficProvider,
  resolveTrafficConfig,
  TRAFFIC_RATE_LIMIT_PER_MINUTE,
} from "./traffic";
import type { RoutingProvider, TravelEstimate } from "./types";

const oslo = { latitude: 59.91, longitude: 10.75 };
const bergen = { latitude: 60.39, longitude: 5.32 };
const trondheim = { latitude: 63.43, longitude: 10.39 };

function fallbackProvider(): RoutingProvider & {
  route: ReturnType<typeof vi.fn>;
  matrix: ReturnType<typeof vi.fn>;
} {
  return {
    name: "osrm",
    route: vi.fn(async (): Promise<TravelEstimate> => ({
      distanceKm: 10,
      durationMinutes: 20,
      provider: "osrm",
    })),
    matrix: vi.fn(async () => []),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("trafikkleverandør", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leser trafikkbevisst varighet og avstand fra TomTom", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        routes: [
          {
            summary: {
              lengthInMeters: 12_000,
              travelTimeInSeconds: 900,
              noTrafficTravelTimeInSeconds: 600,
              trafficDelayInSeconds: 300,
            },
          },
        ],
      }),
    );
    const provider = createTrafficProvider({
      provider: "tomtom",
      apiKey: "hemmelig-nokkel",
      fallback: fallbackProvider(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const estimate = await provider.route(oslo, bergen);

    expect(estimate).toEqual({
      distanceKm: 12,
      durationMinutes: 15,
      provider: "tomtom",
      traffic: true,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/routing/1/calculateRoute/");
    expect(url).toContain("traffic=true");
    // Nøkkelen sendes som header, ikke i URL-en.
    expect(url).not.toContain("hemmelig-nokkel");
    expect((init.headers as Record<string, string>)["TomTom-Api-Key"]).toBe(
      "hemmelig-nokkel",
    );
  });

  it("leser HERE-svaret", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        routes: [
          {
            sections: [
              { summary: { length: 5_000, duration: 600, baseDuration: 480 } },
            ],
          },
        ],
      }),
    );
    const provider = createTrafficProvider({
      provider: "here",
      apiKey: "here-key",
      fallback: fallbackProvider(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const estimate = await provider.route(oslo, bergen);

    expect(estimate.provider).toBe("here");
    expect(estimate.traffic).toBe(true);
    expect(estimate.durationMinutes).toBe(10);
    expect(estimate.distanceKm).toBe(5);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("departureTime=now");
    expect(url).toContain("apikey=here-key");
  });

  it("faller tilbake til OSRM når trafikkleverandøren feiler", async () => {
    const fallback = fallbackProvider();
    const provider = createTrafficProvider({
      provider: "tomtom",
      apiKey: "key",
      fallback,
      fetchImpl: (async () =>
        jsonResponse({}, 503)) as unknown as typeof fetch,
    });

    const estimate = await provider.route(oslo, bergen);

    expect(fallback.route).toHaveBeenCalledWith(oslo, bergen);
    expect(estimate.provider).toBe("osrm");
    expect(estimate.traffic).toBeUndefined();
  });

  it("faller tilbake ved tidsavbrudd", async () => {
    vi.useFakeTimers();
    const fallback = fallbackProvider();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const provider = createTrafficProvider({
      provider: "tomtom",
      apiKey: "key",
      fallback,
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const pending = provider.route(oslo, bergen);
    await vi.advanceTimersByTimeAsync(1_000);
    const estimate = await pending;

    expect(estimate.provider).toBe("osrm");
    expect(fallback.route).toHaveBeenCalledTimes(1);
  });

  it("bruker reserven når rate-limit er nådd", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        routes: [{ summary: { lengthInMeters: 1_000, travelTimeInSeconds: 60 } }],
      }),
    );
    const fallback = fallbackProvider();
    const provider = createTrafficProvider({
      provider: "tomtom",
      apiKey: "key",
      fallback,
      maxRequestsPerMinute: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect((await provider.route(oslo, bergen)).provider).toBe("tomtom");
    now += 1_000;
    expect((await provider.route(oslo, trondheim)).provider).toBe("osrm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cacher trafikksvaret per koordinatnøkkel", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        routes: [{ summary: { lengthInMeters: 1_000, travelTimeInSeconds: 60 } }],
      }),
    );
    const provider = createTrafficProvider({
      provider: "tomtom",
      apiKey: "key",
      fallback: fallbackProvider(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await provider.route(oslo, bergen);
    const second = await provider.route(oslo, bergen);

    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("lar matrisen gå til OSRM/haversine", async () => {
    const fallback = fallbackProvider();
    const provider = createTrafficProvider({
      provider: "here",
      apiKey: "key",
      fallback,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await provider.matrix([oslo], [bergen]);

    expect(fallback.matrix).toHaveBeenCalledWith([oslo], [bergen]);
  });

  it("logger eller returnerer aldri API-nøkkelen ved feil", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createTrafficProvider({
      provider: "tomtom",
      apiKey: "super-hemmelig",
      fallback: createHaversineProvider(),
      fetchImpl: (async () => {
        throw new Error("nede");
      }) as unknown as typeof fetch,
    });

    const estimate = await provider.route(oslo, bergen);

    expect(estimate.provider).toBe("haversine");
    expect(JSON.stringify(estimate)).not.toContain("super-hemmelig");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("trafikkonfigurasjon", () => {
  it("ignorerer trafikkleverandør uten nøkkel", () => {
    expect(
      resolveTrafficConfig({ ROUTING_PROVIDER: "tomtom" }),
    ).toBeNull();
    expect(
      resolveRoutingProvider({ ROUTING_PROVIDER: "here" }).name,
    ).toBe("haversine");
  });

  it("bruker OSRM som reserve når trafikk er konfigurert", () => {
    const provider = resolveRoutingProvider({
      ROUTING_PROVIDER: "tomtom",
      TOMTOM_API_KEY: "key",
      OSRM_BASE_URL: "https://osrm.test",
      TRAFFIC_RATE_LIMIT_PER_MINUTE: String(
        TRAFFIC_RATE_LIMIT_PER_MINUTE,
      ),
    });
    expect(provider.name).toBe("tomtom");
  });

  it("bruker fortsatt OSRM når bare OSRM er konfigurert", () => {
    const provider = resolveRoutingProvider({
      ROUTING_PROVIDER: "osrm",
      OSRM_BASE_URL: "https://osrm.test",
    });
    expect(provider.name).toBe("osrm");
  });
});
