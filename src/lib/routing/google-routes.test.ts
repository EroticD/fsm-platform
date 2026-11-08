import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleRoutesProvider,
  GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE,
  resolveGoogleRoutesConfig,
} from "./google-routes";
import { createHaversineProvider } from "./haversine";
import { resolveRoutingProvider } from "./osrm";
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

function googleBody(duration = "900s", distanceMeters = 12_000) {
  return {
    routes: [{ duration, distanceMeters }],
  };
}

describe("Google Routes-trafikk", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leser trafikkbevisst varighet og avstand fra Google Routes", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(googleBody()));
    const provider = createGoogleRoutesProvider({
      apiKey: "hemmelig-nokkel",
      fallback: fallbackProvider(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const estimate = await provider.route(oslo, bergen);

    expect(estimate).toEqual({
      distanceKm: 12,
      durationMinutes: 15,
      provider: "google",
      traffic: true,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init.method).toBe("POST");
    // Nøkkelen sendes som header, ikke i URL-en.
    expect(url).not.toContain("hemmelig-nokkel");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("hemmelig-nokkel");
    expect(headers["X-Goog-FieldMask"]).toBe(
      "routes.duration,routes.distanceMeters",
    );
    const body = JSON.parse(String(init.body)) as {
      travelMode: string;
      routingPreference: string;
      origin: { location: { latLng: { latitude: number } } };
      destination: { location: { latLng: { longitude: number } } };
    };
    expect(body.travelMode).toBe("DRIVE");
    expect(body.routingPreference).toBe("TRAFFIC_AWARE_OPTIMAL");
    expect(body.origin.location.latLng.latitude).toBe(oslo.latitude);
    expect(body.destination.location.latLng.longitude).toBe(bergen.longitude);
  });

  it("faller tilbake til OSRM når Google feiler", async () => {
    const fallback = fallbackProvider();
    const provider = createGoogleRoutesProvider({
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
    const provider = createGoogleRoutesProvider({
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
    const fetchImpl = vi.fn(async () => jsonResponse(googleBody("60s", 1_000)));
    const fallback = fallbackProvider();
    const provider = createGoogleRoutesProvider({
      apiKey: "key",
      fallback,
      maxRequestsPerMinute: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect((await provider.route(oslo, bergen)).provider).toBe("google");
    now += 1_000;
    expect((await provider.route(oslo, trondheim)).provider).toBe("osrm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cacher trafikksvaret per koordinatnøkkel", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(googleBody("60s", 1_000)));
    const provider = createGoogleRoutesProvider({
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
    const provider = createGoogleRoutesProvider({
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
    const provider = createGoogleRoutesProvider({
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

describe("Google Routes-konfigurasjon", () => {
  it("ignorerer Google uten nøkkel", () => {
    expect(resolveGoogleRoutesConfig({})).toBeNull();
    expect(resolveRoutingProvider({}).name).toBe("haversine");
  });

  it("bruker OSRM som reserve når Google er konfigurert", () => {
    const provider = resolveRoutingProvider({
      GOOGLE_ROUTES_API_KEY: "key",
      OSRM_BASE_URL: "https://osrm.test",
      GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE: String(
        GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE,
      ),
    });
    expect(provider.name).toBe("google");
  });

  it("slår av alle eksterne kall med ROUTING_PROVIDER=haversine", () => {
    expect(
      resolveGoogleRoutesConfig({
        ROUTING_PROVIDER: "haversine",
        GOOGLE_ROUTES_API_KEY: "key",
      }),
    ).toBeNull();
    expect(
      resolveRoutingProvider({
        ROUTING_PROVIDER: "haversine",
        GOOGLE_ROUTES_API_KEY: "key",
        OSRM_BASE_URL: "https://osrm.test",
      }).name,
    ).toBe("haversine");
  });

  it("bruker fortsatt OSRM når bare OSRM er konfigurert", () => {
    const provider = resolveRoutingProvider({
      ROUTING_PROVIDER: "osrm",
      OSRM_BASE_URL: "https://osrm.test",
    });
    expect(provider.name).toBe("osrm");
  });
});
