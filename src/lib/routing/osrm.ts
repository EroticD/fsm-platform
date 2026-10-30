import { createHash } from "node:crypto";
import type { Coordinates } from "@/lib/geo";
import { createHaversineProvider } from "./haversine";
import {
  RoutingTimeoutError,
  type RoutingProvider,
  type TravelEstimate,
} from "./types";

/** Ruteleverandøren får aldri mer enn ett minutt på seg. */
export const ROUTING_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

type CachedValue = TravelEstimate | TravelEstimate[][];
type CacheEntry = { value: CachedValue; expiresAt: number };

function roundedKey(prefix: string, points: Coordinates[]): string {
  const raw = points
    .map(
      (point) =>
        `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`,
    )
    .join(";");
  return `${prefix}:${createHash("sha256").update(raw).digest("hex")}`;
}

function coordinateParam(point: Coordinates): string {
  // OSRM forventer lengdegrad, breddegrad.
  return `${point.longitude},${point.latitude}`;
}

function toEstimate(
  distanceMeters: number,
  durationSeconds: number,
): TravelEstimate {
  return {
    distanceKm: Math.round((distanceMeters / 1000) * 1000) / 1000,
    durationMinutes: Math.max(0, Math.round(durationSeconds / 60)),
    provider: "osrm",
  };
}

function estimateZero(): TravelEstimate {
  return { distanceKm: 0, durationMinutes: 0, provider: "osrm" };
}

export type OsrmOptions = {
  baseUrl: string;
  timeoutMs?: number;
  /** Injiseres i tester, slik at ingen test gjør et ekte nettverkskall. */
  fetchImpl?: typeof fetch;
};

/**
 * Tynn OSRM-adapter. Den bruker bare `fetch`, har tidsavbrudd og faller
 * tilbake til haversine × 1,35 ved feil. Resultatene caches per avrundet
 * koordinatnøkkel, så en dispatch-side med mange like oppslag ikke belaster
 * ruteserveren unødig.
 *
 * Nøkler og base-URL leses fra servermiljøet i `resolveRoutingProvider`.
 * Ingenting her skal importeres i en klientkomponent.
 */
export function createOsrmProvider(options: OsrmOptions): RoutingProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? ROUTING_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const fallback = createHaversineProvider();
  const cache = new Map<string, CacheEntry>();

  function readCache<T extends CachedValue>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  function writeCache(key: string, value: CachedValue): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  async function request(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`OSRM svarte ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RoutingTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "osrm",

    async route(from, to) {
      const key = roundedKey("route", [from, to]);
      const cached = readCache<TravelEstimate>(key);
      if (cached) return cached;

      try {
        const payload = (await request(
          `/route/v1/driving/${coordinateParam(from)};${coordinateParam(to)}?overview=false&steps=false`,
        )) as {
          code?: string;
          routes?: Array<{ distance?: number; duration?: number }>;
        };
        const route = payload?.routes?.[0];
        if (payload?.code !== "Ok" || !route) {
          throw new Error("OSRM returnerte ingen rute");
        }
        const estimate = toEstimate(route.distance ?? 0, route.duration ?? 0);
        writeCache(key, estimate);
        return estimate;
      } catch {
        const estimate = await fallback.route(from, to);
        writeCache(key, estimate);
        return estimate;
      }
    },

    async matrix(origins, destinations) {
      if (origins.length === 0 || destinations.length === 0) {
        return origins.map(() => destinations.map(() => estimateZero()));
      }

      const key = roundedKey("matrix", [...origins, ...destinations]);
      const cached = readCache<TravelEstimate[][]>(key);
      if (cached) return cached;

      try {
        const points = [...origins, ...destinations];
        const sources = origins.map((_, index) => index).join(";");
        const targets = destinations
          .map((_, index) => origins.length + index)
          .join(";");
        const payload = (await request(
          `/table/v1/driving/${points
            .map(coordinateParam)
            .join(";")}?annotations=duration,distance&sources=${sources}&targets=${targets}`,
        )) as {
          code?: string;
          durations?: Array<Array<number | null>>;
          distances?: Array<Array<number | null>>;
        };
        if (payload?.code !== "Ok" || !payload.durations) {
          throw new Error("OSRM returnerte ingen matrise");
        }

        const matrix = origins.map((_, originIndex) =>
          destinations.map((__, destinationIndex) =>
            toEstimate(
              payload.distances?.[originIndex]?.[destinationIndex] ?? 0,
              payload.durations?.[originIndex]?.[destinationIndex] ?? 0,
            ),
          ),
        );
        writeCache(key, matrix);
        return matrix;
      } catch {
        const matrix = await fallback.matrix(origins, destinations);
        writeCache(key, matrix);
        return matrix;
      }
    },
  };
}

type RoutingEnv = {
  ROUTING_PROVIDER?: string;
  OSRM_BASE_URL?: string;
  [key: string]: string | undefined;
};

/**
 * Velger leverandør ut fra servermiljøet. Uten `OSRM_BASE_URL` brukes
 * haversine, slik at utvikling, tester og en installasjon uten ruteserver
 * aldri gjør et eksternt kall.
 */
export function resolveRoutingProvider(
  env: RoutingEnv = process.env,
  fetchImpl?: typeof fetch,
): RoutingProvider {
  const provider = (env.ROUTING_PROVIDER ?? "").trim().toLowerCase();
  const baseUrl = (env.OSRM_BASE_URL ?? "").trim();
  if (baseUrl && (provider === "osrm" || provider === "")) {
    return createOsrmProvider({ baseUrl, fetchImpl });
  }
  return createHaversineProvider();
}

let defaultProvider: RoutingProvider | null = null;

/** Prosessdelt leverandør. Testene injiserer alltid sin egen. */
export function getRoutingProvider(): RoutingProvider {
  if (!defaultProvider) defaultProvider = resolveRoutingProvider();
  return defaultProvider;
}

/** Bare for tester som trenger å nullstille miljøvalget. */
export function resetRoutingProviderForTests(): void {
  defaultProvider = null;
}
