import { createHash } from "node:crypto";
import { isValidCoordinates, type Coordinates } from "@/lib/geo";
import {
  RoutingTimeoutError,
  type RoutingProvider,
  type TravelEstimate,
} from "./types";

/**
 * Trafikkbevisst ETA via Google Routes API (Google Maps Platform).
 *
 * Bare én strekning (`route`) går til Google. Flerpunktsmatrisen i
 * ruteoptimaliseringen kommer fortsatt fra OSRM (OpenStreetMap), fordi
 * Google-kvotene og prisen per matriseelement er høyere og OSRM gir ett
 * konsistent reisegrunnlag i hele ruten.
 *
 * Fra Google brukes `routes.duration` (trafikkbevisst varighet ved avreise nå)
 * og `routes.distanceMeters` (kjørt avstand). `staticDuration` hentes ikke.
 * OpenStreetMap/OSRM har ingen sanntidstrafikk; uten en Google-nøkkel er ETA
 * derfor alltid OSRM eller den lokale haversine-beregningen.
 *
 * API-nøkkelen sendes i headeren `X-Goog-Api-Key` og leses bare fra
 * servermiljøet. Den skrives aldri til logg, feilmelding eller respons.
 */

export const GOOGLE_ROUTES_TIMEOUT_MS = 8_000;
export const GOOGLE_ROUTES_CACHE_TTL_MS = 60_000;
export const GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE = 60;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_CACHE_TTL_MS = 60 * 60_000;
const MAX_RATE_LIMIT_PER_MINUTE = 600;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_BASE_URL = "https://routes.googleapis.com";
const COMPUTE_ROUTES_PATH = "/directions/v2:computeRoutes";
/** Bare feltene appen faktisk bruker. */
const FIELD_MASK = "routes.duration,routes.distanceMeters";

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

function roundedKey(from: Coordinates, to: Coordinates): string {
  const raw = `google:${from.latitude.toFixed(5)},${from.longitude.toFixed(
    5,
  )};${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  return createHash("sha256").update(raw).digest("hex");
}

function toEstimate(
  distanceMeters: number,
  durationSeconds: number,
): TravelEstimate {
  return {
    distanceKm: Math.round((distanceMeters / 1000) * 1000) / 1000,
    durationMinutes: Math.max(0, Math.round(durationSeconds / 60)),
    provider: "google",
    traffic: true,
  };
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/s$/i, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export type GoogleRoutesOptions = {
  apiKey: string;
  /** OSRM (eller haversine) som brukes når Google ikke kan svare. */
  fallback: RoutingProvider;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxRequestsPerMinute?: number;
  /** Overstyrbart endepunkt for test/proxy. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Injiseres i tester for deterministisk rate limiting. */
  now?: () => number;
};

export function createGoogleRoutesProvider(
  options: GoogleRoutesOptions,
): RoutingProvider {
  const apiKey = options.apiKey.trim();
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, options.timeoutMs ?? GOOGLE_ROUTES_TIMEOUT_MS),
  );
  const cacheTtlMs = Math.min(
    MAX_CACHE_TTL_MS,
    Math.max(0, options.cacheTtlMs ?? GOOGLE_ROUTES_CACHE_TTL_MS),
  );
  const maxRequestsPerMinute = Math.min(
    MAX_RATE_LIMIT_PER_MINUTE,
    Math.max(
      0,
      options.maxRequestsPerMinute ?? GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE,
    ),
  );
  const baseUrl = (
    options.baseUrl?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
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

  function bodyFor(from: Coordinates, to: Coordinates): string {
    return JSON.stringify({
      origin: {
        location: {
          latLng: { latitude: from.latitude, longitude: from.longitude },
        },
      },
      destination: {
        location: {
          latLng: { latitude: to.latitude, longitude: to.longitude },
        },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      computeAlternativeRoutes: false,
      units: "METRIC",
    });
  }

  async function request(
    from: Coordinates,
    to: Coordinates,
  ): Promise<TravelEstimate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${COMPUTE_ROUTES_PATH}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: bodyFor(from, to),
      });
      if (!response.ok) {
        // Aldri ta med URL, body eller nøkkel i feilmeldingen.
        throw new Error(`Google Routes svarte ${response.status}`);
      }

      const payload = (await response.json()) as {
        routes?: Array<{
          duration?: unknown;
          distanceMeters?: unknown;
        }>;
      };
      const route = payload?.routes?.[0];
      const seconds = durationSeconds(route?.duration);
      if (!route || seconds === null) {
        throw new Error("Google Routes returnerte ingen rute");
      }
      const meters =
        typeof route.distanceMeters === "number" &&
        Number.isFinite(route.distanceMeters)
          ? route.distanceMeters
          : 0;
      return toEstimate(meters, seconds);
    } catch (error) {
      if (controller.signal.aborted) throw new RoutingTimeoutError(timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "google",

    async route(from, to) {
      if (
        !isValidCoordinates(from.latitude, from.longitude) ||
        !isValidCoordinates(to.latitude, to.longitude)
      ) {
        return options.fallback.route(from, to);
      }

      const key = roundedKey(from, to);
      const cached = readCache(key);
      if (cached) return cached;

      // Over kvoten brukes OSRM/haversine. Det er deterministisk og koster
      // ingen ekstra Google-kall.
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
      // Matriser har egne kvoter og priser hos Google. Optimaliseringen bruker
      // OSRM /table (eller haversine) og er dokumentert i docs/ROUTING.md.
      return options.fallback.matrix(origins, destinations);
    },
  };
}

export type GoogleRoutesEnv = {
  ROUTING_PROVIDER?: string;
  GOOGLE_ROUTES_API_KEY?: string;
  GOOGLE_ROUTES_BASE_URL?: string;
  GOOGLE_ROUTES_TIMEOUT_MS?: string;
  GOOGLE_ROUTES_CACHE_TTL_MS?: string;
  GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE?: string;
  [key: string]: string | undefined;
};

export type ResolvedGoogleRoutesConfig = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  cacheTtlMs: number;
  maxRequestsPerMinute: number;
};

/**
 * Leser Google-konfigurasjonen. Uten nøkkel returneres `null`, slik at ETA
 * faller tilbake til OSRM/haversine uten gjentatte feilede kall.
 * `ROUTING_PROVIDER=haversine` slår bevisst av alle eksterne kall.
 */
export function resolveGoogleRoutesConfig(
  env: GoogleRoutesEnv = process.env,
): ResolvedGoogleRoutesConfig | null {
  const provider = (env.ROUTING_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "haversine") return null;
  if (provider && provider !== "osrm" && provider !== "google") return null;

  const apiKey = env.GOOGLE_ROUTES_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl:
      env.GOOGLE_ROUTES_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
    timeoutMs: clampInteger(
      env.GOOGLE_ROUTES_TIMEOUT_MS,
      GOOGLE_ROUTES_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    cacheTtlMs: clampInteger(
      env.GOOGLE_ROUTES_CACHE_TTL_MS,
      GOOGLE_ROUTES_CACHE_TTL_MS,
      0,
      MAX_CACHE_TTL_MS,
    ),
    maxRequestsPerMinute: clampInteger(
      env.GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE,
      GOOGLE_ROUTES_RATE_LIMIT_PER_MINUTE,
      0,
      MAX_RATE_LIMIT_PER_MINUTE,
    ),
  };
}
