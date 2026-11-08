import { createHash } from "node:crypto";
import { isValidCoordinates, type Coordinates } from "@/lib/geo";
import {
  RoutingTimeoutError,
  type RoutingProvider,
  type RoutingProviderName,
  type TravelEstimate,
} from "./types";

/**
 * Trafikkbevisst ETA-leverandør (TomTom eller HERE).
 *
 * Leverandøren brukes bare for én strekning (`route`) – altså ETA og
 * enkeltbena i ruteplanen. Matrisen i flerpunktsoptimaliseringen kommer fra
 * OSRMs `/table`, fordi trafikkmatriser hos TomTom/HERE har egne kvoter og
 * priser. Når trafikkleverandøren feiler, er reserven alltid den vanlige
 * ruteleverandøren (OSRM), som selv faller tilbake til haversine.
 *
 * API-nøkkelen leses bare fra servermiljøet. Den skrives aldri til logg,
 * feilmelding eller respons.
 */

export const TRAFFIC_TIMEOUT_MS = 8_000;
export const TRAFFIC_CACHE_TTL_MS = 60_000;
export const TRAFFIC_RATE_LIMIT_PER_MINUTE = 60;

const MIN_TRAFFIC_TIMEOUT_MS = 1_000;
const MAX_TRAFFIC_TIMEOUT_MS = 30_000;
const MAX_CACHE_TTL_MS = 60 * 60_000;
const MAX_RATE_LIMIT_PER_MINUTE = 600;
const RATE_LIMIT_WINDOW_MS = 60_000;

export type TrafficProviderName = Extract<
  RoutingProviderName,
  "tomtom" | "here"
>;

type CacheEntry = { value: TravelEstimate; expiresAt: number };

function clampInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roundedKey(
  provider: TrafficProviderName,
  from: Coordinates,
  to: Coordinates,
): string {
  const raw = `${provider}:${from.latitude.toFixed(5)},${from.longitude.toFixed(
    5,
  )};${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  return createHash("sha256").update(raw).digest("hex");
}

function toEstimate(
  provider: TrafficProviderName,
  distanceMeters: number,
  durationSeconds: number,
): TravelEstimate {
  return {
    distanceKm: Math.round((distanceMeters / 1000) * 1000) / 1000,
    durationMinutes: Math.max(0, Math.round(durationSeconds / 60)),
    provider,
    traffic: true,
  };
}

type TomTomPayload = {
  routes?: Array<{
    summary?: {
      lengthInMeters?: number;
      travelTimeInSeconds?: number;
      noTrafficTravelTimeInSeconds?: number;
      trafficDelayInSeconds?: number;
    };
  }>;
};

type HerePayload = {
  routes?: Array<{
    sections?: Array<{
      summary?: {
        length?: number;
        duration?: number;
        baseDuration?: number;
      };
    }>;
  }>;
};

export type TrafficProviderOptions = {
  provider: TrafficProviderName;
  apiKey: string;
  /** OSRM (eller haversine) som brukes når trafikkleverandøren feiler. */
  fallback: RoutingProvider;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxRequestsPerMinute?: number;
  /** Overstyrbare endepunkter for test/proxy. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Injiseres i tester for deterministisk rate limiting. */
  now?: () => number;
};

export function createTrafficProvider(
  options: TrafficProviderOptions,
): RoutingProvider {
  const provider = options.provider;
  const apiKey = options.apiKey.trim();
  const timeoutMs = Math.min(
    MAX_TRAFFIC_TIMEOUT_MS,
    Math.max(MIN_TRAFFIC_TIMEOUT_MS, options.timeoutMs ?? TRAFFIC_TIMEOUT_MS),
  );
  const cacheTtlMs = Math.min(
    MAX_CACHE_TTL_MS,
    Math.max(0, options.cacheTtlMs ?? TRAFFIC_CACHE_TTL_MS),
  );
  const maxRequestsPerMinute = Math.min(
    MAX_RATE_LIMIT_PER_MINUTE,
    Math.max(
      0,
      options.maxRequestsPerMinute ?? TRAFFIC_RATE_LIMIT_PER_MINUTE,
    ),
  );
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const calls: number[] = [];

  function readCache(key: string): TravelEstimate | null {
    if (cacheTtlMs <= 0) return null;
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  }

  function writeCache(key: string, value: TravelEstimate): void {
    if (cacheTtlMs <= 0) return;
    if (cache.size >= 500) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { value, expiresAt: now() + cacheTtlMs });
  }

  function withinRateLimit(): boolean {
    if (maxRequestsPerMinute <= 0) return false;
    const at = now();
    while (calls.length > 0 && calls[0] <= at - RATE_LIMIT_WINDOW_MS) {
      calls.shift();
    }
    if (calls.length >= maxRequestsPerMinute) return false;
    calls.push(at);
    return true;
  }

  function tomtomUrl(from: Coordinates, to: Coordinates): string {
    const base = baseUrl || "https://api.tomtom.com";
    const coordinates = `${from.longitude},${from.latitude}:${to.longitude},${to.latitude}`;
    return `${base}/routing/1/calculateRoute/${coordinates}/json?traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&instructionsType=none`;
  }

  function hereUrl(from: Coordinates, to: Coordinates): string {
    const base = baseUrl || "https://router.hereapi.com";
    const params = new URLSearchParams({
      transportMode: "car",
      origin: `${from.latitude},${from.longitude}`,
      destination: `${to.latitude},${to.longitude}`,
      return: "summary",
      departureTime: "now",
      apikey: apiKey,
    });
    return `${base}/v8/routes?${params.toString()}`;
  }

  async function request(from: Coordinates, to: Coordinates): Promise<TravelEstimate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = {
        signal: controller.signal,
        headers: { accept: "application/json" },
      };
      let url: string;
      if (provider === "tomtom") {
        url = tomtomUrl(from, to);
        // TomTom godtar nøkkelen som header. Da havner den ikke i URL-er som
        // kan bli liggende i proxy-logger.
        init.headers = {
          ...init.headers,
          "TomTom-Api-Key": apiKey,
        };
      } else {
        url = hereUrl(from, to);
      }

      const response = await fetchImpl(url, init);
      if (!response.ok) {
        // Aldri ta med URL eller nøkkel i feilmeldingen.
        throw new Error(`${provider} svarte ${response.status}`);
      }
      const payload = (await response.json()) as TomTomPayload & HerePayload;

      if (provider === "tomtom") {
        const summary = payload.routes?.[0]?.summary;
        if (!summary || typeof summary.travelTimeInSeconds !== "number") {
          throw new Error(`${provider} returnerte ingen rute`);
        }
        return toEstimate(
          provider,
          summary.lengthInMeters ?? 0,
          summary.travelTimeInSeconds,
        );
      }

      const summary = payload.routes?.[0]?.sections?.[0]?.summary;
      if (!summary || typeof summary.duration !== "number") {
        throw new Error(`${provider} returnerte ingen rute`);
      }
      return toEstimate(provider, summary.length ?? 0, summary.duration);
    } catch (error) {
      if (controller.signal.aborted) throw new RoutingTimeoutError(timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: provider,

    async route(from, to) {
      if (!isValidCoordinates(from.latitude, from.longitude) ||
          !isValidCoordinates(to.latitude, to.longitude)) {
        return options.fallback.route(from, to);
      }

      const key = roundedKey(provider, from, to);
      const cached = readCache(key);
      if (cached) return cached;

      // Over kvoten brukes OSRM/haversine. Det er deterministisk og koster
      // ingen ekstra trafikk-kall.
      if (!withinRateLimit()) {
        return options.fallback.route(from, to);
      }

      try {
        const estimate = await request(from, to);
        writeCache(key, estimate);
        return estimate;
      } catch {
        return options.fallback.route(from, to);
      }
    },

    async matrix(origins, destinations) {
      // Trafikkmatriser har egne kvoter. Optimaliseringen bruker OSRM /table
      // (eller haversine) og er dokumentert i docs/ROUTING.md.
      return options.fallback.matrix(origins, destinations);
    },
  };
}

export type TrafficEnv = {
  ROUTING_PROVIDER?: string;
  TRAFFIC_PROVIDER?: string;
  TOMTOM_API_KEY?: string;
  HERE_API_KEY?: string;
  TRAFFIC_TIMEOUT_MS?: string;
  TRAFFIC_CACHE_TTL_MS?: string;
  TRAFFIC_RATE_LIMIT_PER_MINUTE?: string;
  TOMTOM_BASE_URL?: string;
  HERE_BASE_URL?: string;
  [key: string]: string | undefined;
};

export type ResolvedTrafficConfig = {
  provider: TrafficProviderName;
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  cacheTtlMs: number;
  maxRequestsPerMinute: number;
};

/**
 * Leser trafikkonfigurasjonen. En trafikkleverandør uten nøkkel er bevisst
 * ignorert, slik at en glemt hemmelighet gir OSRM/haversine i stedet for
 * gjentatte feilede kall.
 */
export function resolveTrafficConfig(
  env: TrafficEnv,
): ResolvedTrafficConfig | null {
  const candidate = (
    env.TRAFFIC_PROVIDER ??
    env.ROUTING_PROVIDER ??
    ""
  )
    .trim()
    .toLowerCase();
  if (candidate !== "tomtom" && candidate !== "here") return null;

  const apiKey = (
    candidate === "tomtom" ? env.TOMTOM_API_KEY : env.HERE_API_KEY
  )?.trim();
  if (!apiKey) return null;

  return {
    provider: candidate,
    apiKey,
    baseUrl:
      (candidate === "tomtom" ? env.TOMTOM_BASE_URL : env.HERE_BASE_URL)
        ?.trim()
        .replace(/\/+$/, "") || undefined,
    timeoutMs: clampInteger(
      env.TRAFFIC_TIMEOUT_MS,
      TRAFFIC_TIMEOUT_MS,
      MIN_TRAFFIC_TIMEOUT_MS,
      MAX_TRAFFIC_TIMEOUT_MS,
    ),
    cacheTtlMs: clampInteger(
      env.TRAFFIC_CACHE_TTL_MS,
      TRAFFIC_CACHE_TTL_MS,
      0,
      MAX_CACHE_TTL_MS,
    ),
    maxRequestsPerMinute: clampInteger(
      env.TRAFFIC_RATE_LIMIT_PER_MINUTE,
      TRAFFIC_RATE_LIMIT_PER_MINUTE,
      0,
      MAX_RATE_LIMIT_PER_MINUTE,
    ),
  };
}
