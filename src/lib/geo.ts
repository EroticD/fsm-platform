/**
 * Enkle geografiske hjelpefunksjoner for ETA.
 *
 * Vi har ingen ruteleverandør i denne fasen. Avstanden beregnes derfor som
 * luftlinje med haversine, multipliseres med en dokumentert veifaktor og deles
 * på en konfigurerbar gjennomsnittsfart. Faktoren er et konservativt anslag
 * for norske forhold, ikke en ruteberegning. Når Phase 6 får en routing-
 * adapter, kan denne modulen byttes ut uten at sporingstjenesten endres.
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

export type Coordinates = {
  lat: number;
  lng: number;
};

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

/** Haversine-avstand i kilometer mellom to punkter. */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  if (
    !isValidCoordinates(from.lat, from.lng) ||
    !isValidCoordinates(to.lat, to.lng)
  ) {
    return Number.NaN;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
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
  from: Coordinates | null | undefined;
  to: Coordinates | null | undefined;
  now?: Date;
  speedKmh?: number;
}): EtaEstimate | null {
  if (!input.from || !input.to) return null;
  if (!isValidCoordinates(input.from.lat, input.from.lng)) return null;
  if (!isValidCoordinates(input.to.lat, input.to.lng)) return null;

  const straightLineKm = haversineKm(input.from, input.to);
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
