/**
 * Geografiske hjelpere for både dispatch-ruting og ETA i sporingen.
 *
 * To koordinatformer brukes i kodebasen: `{ latitude, longitude }` (routing,
 * dispatch, kart) og `{ lat, lng }` (sporing og Leaflet). Begge normaliseres
 * internt, slik at avstanden og ETA-en alltid regnes med samme formel.
 *
 * Avstandene er luftlinje. Ruting-laget i `src/lib/routing/` ganger opp med en
 * veifaktor når ingen ekstern ruteleverandør er konfigurert. Da kan scoring,
 * kart og sporing bruke samme, testbare grunnlag uten nettverk.
 */

/** Jordradien i kilometer (WGS-84 middelradius). */
export const EARTH_RADIUS_KM = 6371.0088;

/** Anslått forhold mellom veiavstand og luftlinje. */
export const ROAD_FACTOR = 1.35;

/** Standard gjennomsnittsfart når `TRACKING_AVERAGE_SPEED_KMH` ikke er satt. */
export const DEFAULT_AVERAGE_SPEED_KMH = 50;

/** Minste og største fart vi godtar fra konfigurasjonen. */
const MIN_AVERAGE_SPEED_KMH = 5;
const MAX_AVERAGE_SPEED_KMH = 120;

/** Kanonisk koordinatform for routing, dispatch og kart. */
export type Coordinates = {
  latitude: number;
  longitude: number;
};

/** Koordinatformen sporing og Leaflet bruker. */
export type LatLng = {
  lat: number;
  lng: number;
};

export type GeoPoint = Coordinates | LatLng;

function isLatLng(point: GeoPoint): point is LatLng {
  return (
    typeof (point as LatLng).lat === "number" &&
    typeof (point as LatLng).lng === "number"
  );
}

function toLatLng(point: GeoPoint): LatLng {
  return isLatLng(point)
    ? point
    : { lat: point.latitude, lng: point.longitude };
}

/** Normaliserer et punkt til dispatch-formatet. */
export function toCoordinates(point: GeoPoint): Coordinates {
  return isLatLng(point)
    ? { latitude: point.lat, longitude: point.lng }
    : point;
}

/** Er koordinatene endelige tall innenfor gyldige bredde-/lengdegrader? */
export function isValidCoordinates(
  latitude: unknown,
  longitude: unknown,
): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Validerer et koordinatobjekt uansett av de to støttede formene. */
export function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Coordinates>;
  return (
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    isValidCoordinates(point.latitude, point.longitude)
  );
}

/** Haversine-avstand i kilometer mellom to punkter. */
export function haversineKm(from: GeoPoint, to: GeoPoint): number {
  const a = toLatLng(from);
  const b = toLatLng(to);
  if (
    !isValidCoordinates(a.lat, a.lng) ||
    !isValidCoordinates(b.lat, b.lng)
  ) {
    return Number.NaN;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Gjennomsnittsfarten fra miljøet. Ugyldige eller urimelige verdier faller
 * tilbake til standarden, slik at en skrivefeil i miljøet ikke gir ETA på
 * null minutter eller flere døgn.
 */
export function averageSpeedKmh(
  env: { TRACKING_AVERAGE_SPEED_KMH?: string } = process.env as {
    TRACKING_AVERAGE_SPEED_KMH?: string;
  },
): number {
  const parsed = Number.parseFloat(env.TRACKING_AVERAGE_SPEED_KMH ?? "");
  if (!Number.isFinite(parsed)) return DEFAULT_AVERAGE_SPEED_KMH;
  return Math.min(
    MAX_AVERAGE_SPEED_KMH,
    Math.max(MIN_AVERAGE_SPEED_KMH, parsed),
  );
}

/**
 * Anslått kjøretid i hele minutter. Minst ett minutt når avstanden er større
 * enn null, slik at en nesten ferdig reise ikke vises som «0 min».
 */
export function estimateTravelMinutes(
  distanceKm: number,
  speedKmh: number = DEFAULT_AVERAGE_SPEED_KMH,
): number | null {
  if (
    !Number.isFinite(distanceKm) ||
    distanceKm < 0 ||
    !Number.isFinite(speedKmh) ||
    speedKmh <= 0
  ) {
    return null;
  }
  if (distanceKm === 0) return 0;
  return Math.max(1, Math.ceil((distanceKm / speedKmh) * 60));
}

export type EtaEstimate = {
  /** Luftlinje i kilometer. */
  straightLineKm: number;
  /** Beregnet veiavstand etter `ROAD_FACTOR`. */
  roadKm: number;
  minutes: number;
  estimatedArrivalAt: Date;
};

/**
 * Estimerer ankomst fra et posisjonspunkt. Returnerer `null` når et av
 * punktene mangler eller er ugyldige – vi viser aldri en falsk ETA uten en
 * faktisk posisjon.
 */
export function estimateEta(input: {
  from: GeoPoint | null | undefined;
  to: GeoPoint | null | undefined;
  now?: Date;
  speedKmh?: number;
}): EtaEstimate | null {
  if (!input.from || !input.to) return null;
  const from = toLatLng(input.from);
  const to = toLatLng(input.to);
  if (!isValidCoordinates(from.lat, from.lng)) return null;
  if (!isValidCoordinates(to.lat, to.lng)) return null;

  const straightLineKm = haversineKm(from, to);
  if (!Number.isFinite(straightLineKm)) return null;

  const roadKm = straightLineKm * ROAD_FACTOR;
  const speedKmh = input.speedKmh ?? averageSpeedKmh();
  const minutes = estimateTravelMinutes(roadKm, speedKmh);
  if (minutes === null) return null;

  const now = input.now ?? new Date();
  return {
    straightLineKm,
    roadKm,
    minutes,
    estimatedArrivalAt: new Date(now.getTime() + minutes * 60_000),
  };
}
