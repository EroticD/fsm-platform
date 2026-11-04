import { createHash } from "node:crypto";
import { normalizeSearchText } from "@/lib/fuzzy";

/**
 * Adressegrunnlag for et oppdrag. Eksplisitt arbeidsadresse vinner over
 * kundens adresse, slik at et oppdrag kan utføres på en annen lokasjon.
 */
export function effectiveAddress(input: {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  customer?: {
    address?: string | null;
    postalCode?: string | null;
    city?: string | null;
  } | null;
}): {
  address: string | null;
  postalCode: string | null;
  city: string | null;
  query: string | null;
} {
  const address = input.address?.trim() || input.customer?.address?.trim() || null;
  const postalCode =
    input.postalCode?.trim() || input.customer?.postalCode?.trim() || null;
  const city = input.city?.trim() || input.customer?.city?.trim() || null;
  const query = [address, postalCode, city]
    .filter(Boolean)
    .join(", ")
    .trim();

  return { address, postalCode, city, query: query || null };
}

/** Stabil hash av adressegrunnlaget, slik at endret adresse gir ny geokoding. */
export function addressHash(query: string | null | undefined): string | null {
  const normalized = normalizeSearchText(query ?? "");
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

export type GeocodeCoordinates = { lat: number; lng: number };

export type GeocodeStatus =
  | "ok"
  | "no_result"
  | "disabled"
  | "timeout"
  | "unavailable";

export type GeocodeResult = {
  status: GeocodeStatus;
  coordinates: GeocodeCoordinates | null;
  provider?: "nominatim" | "kartverket" | "photon";
  httpStatus?: number;
};

export type GeocodeAddressParts = {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
};

function timeoutMs(): number {
  const value = Number(process.env.GEOCODE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 3_500;
}

function userAgent(): string {
  return (
    process.env.GEOCODE_USER_AGENT ??
    process.env.APP_URL ??
    "FSM-platform/0.8.9"
  );
}

async function fetchJson(
  url: URL,
  headers: Record<string, string> = {},
): Promise<
  | { kind: "ok"; data: unknown }
  | { kind: "timeout" }
  | { kind: "http"; status: number }
  | { kind: "unavailable" }
> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent(), ...headers },
      signal: AbortSignal.timeout(timeoutMs()),
      // Geokoding skal alltid svare ferskt; en cachet tom respons gjør at
      // brukeren aldri får prøvd adressen på nytt.
      cache: "no-store",
    });
    if (!response.ok) return { kind: "http", status: response.status };
    return { kind: "ok", data: await response.json() };
  } catch (error) {
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { kind: "timeout" };
    }
    return { kind: "unavailable" };
  }
}

function coordinatesFromNominatim(data: unknown): GeocodeCoordinates | null {
  if (!Array.isArray(data)) return null;
  const first = data[0] as { lat?: unknown; lon?: unknown } | undefined;
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function nominatim(query: string): Promise<GeocodeResult> {
  const url = new URL(
    process.env.GEOCODE_ENDPOINT ??
      "https://nominatim.openstreetmap.org/search",
  );
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "no");
  url.searchParams.set("q", query);

  const response = await fetchJson(url);
  if (response.kind === "timeout") {
    return { status: "timeout", coordinates: null, provider: "nominatim" };
  }
  if (response.kind === "unavailable") {
    return { status: "unavailable", coordinates: null, provider: "nominatim" };
  }
  if (response.kind === "http") {
    return {
      status: "no_result",
      coordinates: null,
      provider: "nominatim",
      httpStatus: response.status,
    };
  }
  const coordinates = coordinatesFromNominatim(response.data);
  return coordinates
    ? { status: "ok", coordinates, provider: "nominatim" }
    : { status: "no_result", coordinates: null, provider: "nominatim" };
}

/**
 * Kartverket har autoritative norske adresser og egne parametre for
 * postnummer/kommune. Brukes som fallback når Nominatim ikke gir treff.
 */
async function kartverket(
  parts: GeocodeAddressParts,
): Promise<GeocodeResult> {
  const street = parts.address?.split(",")[0]?.trim();
  if (!street) return { status: "no_result", coordinates: null };

  const url = new URL(
    process.env.GEOCODE_KARTVERKET_ENDPOINT ??
      "https://ws.geonorge.no/adresser/v1/sok",
  );
  url.searchParams.set("adressetekst", street);
  url.searchParams.set("utkoordsys", "4258");
  url.searchParams.set("treffPerSide", "1");
  if (parts.postalCode) url.searchParams.set("postnummer", parts.postalCode);
  if (parts.city) url.searchParams.set("kommunenavn", parts.city);

  const response = await fetchJson(url);
  if (response.kind === "timeout") {
    return { status: "timeout", coordinates: null, provider: "kartverket" };
  }
  if (response.kind === "unavailable") {
    return { status: "unavailable", coordinates: null, provider: "kartverket" };
  }
  if (response.kind === "http") {
    return {
      status: "no_result",
      coordinates: null,
      provider: "kartverket",
      httpStatus: response.status,
    };
  }
  const rows = (response.data as { adresser?: unknown })?.adresser;
  const first = Array.isArray(rows)
    ? (rows[0] as
        | { representasjonspunkt?: { lat?: unknown; lon?: unknown } }
        | undefined)
    : undefined;
  const lat = Number(first?.representasjonspunkt?.lat);
  const lng = Number(first?.representasjonspunkt?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { status: "ok", coordinates: { lat, lng }, provider: "kartverket" }
    : { status: "no_result", coordinates: null, provider: "kartverket" };
}

/**
 * Photon er en åpen OSM-geokoder uten API-nøkkel. Den brukes bare som siste
 * fallback, slik at en blokkert eller utilgjengelig Nominatim ikke gjør hele
 * geokodingen ubrukelig.
 */
async function photon(query: string): Promise<GeocodeResult> {
  const url = new URL(
    process.env.GEOCODE_PHOTON_ENDPOINT ?? "https://photon.komoot.io/api/",
  );
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");

  const response = await fetchJson(url);
  if (response.kind === "timeout") {
    return { status: "timeout", coordinates: null, provider: "photon" };
  }
  if (response.kind === "unavailable") {
    return { status: "unavailable", coordinates: null, provider: "photon" };
  }
  if (response.kind === "http") {
    return {
      status: "no_result",
      coordinates: null,
      provider: "photon",
      httpStatus: response.status,
    };
  }
  const features = (response.data as { features?: unknown })?.features;
  const first = Array.isArray(features)
    ? (features[0] as
        | { geometry?: { coordinates?: unknown } }
        | undefined)
    : undefined;
  const pair = first?.geometry?.coordinates;
  if (!Array.isArray(pair) || pair.length < 2) {
    return { status: "no_result", coordinates: null, provider: "photon" };
  }
  const lng = Number(pair[0]);
  const lat = Number(pair[1]);
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { status: "ok", coordinates: { lat, lng }, provider: "photon" }
    : { status: "no_result", coordinates: null, provider: "photon" };
}

/**
 * Geokoder en adresse med flere leverandører.
 *
 * Rekkefølgen er Nominatim → Kartverket → Photon. Kartverket brukes bare når
 * vi har en norsk gateadresse; Photon er siste utvei. Alle kall er
 * best-effort, og resultatet inneholder en stabil status slik at UI og
 * driftslogg kan skille «fant ingen adresse» fra «tjenesten svarte ikke».
 */
export async function geocodeAddressDetailed(
  query: string | null | undefined,
  parts: GeocodeAddressParts = {},
): Promise<GeocodeResult> {
  const value = query?.trim();
  const testWithoutNetwork =
    process.env.NODE_ENV === "test" &&
    process.env.GEOCODE_TEST_NETWORK !== "1";
  if (!value || testWithoutNetwork || process.env.GEOCODE_ENABLED === "false") {
    return { status: "disabled", coordinates: null };
  }

  const attempts: GeocodeResult[] = [];
  const providers: Array<() => Promise<GeocodeResult>> = [
    () => nominatim(value),
    () => kartverket(parts),
    () => photon(value),
  ];

  for (const provider of providers) {
    const result = await provider();
    if (result.status === "ok") return result;
    attempts.push(result);
    // Når vi har fått et konkret «ingen treff», er de andre leverandørene
    // fortsatt verdt et forsøk. Ved timeout/utilgjengelighet går vi videre
    // raskt til neste leverandør i stedet for å gi opp.
  }

  const unavailable = attempts.find(
    (attempt) =>
      attempt.status === "timeout" || attempt.status === "unavailable",
  );
  if (unavailable) {
    return {
      status: unavailable.status,
      coordinates: null,
      provider: unavailable.provider,
    };
  }
  return { status: "no_result", coordinates: null };
}

/**
 * Bakoverkompatibel hjelper for tjenestelaget: returnerer bare koordinater.
 * Bruk `geocodeAddressDetailed` når årsaken til en feil skal vises.
 */
export async function geocodeAddress(
  query: string | null | undefined,
  parts: GeocodeAddressParts = {},
): Promise<GeocodeCoordinates | null> {
  const result = await geocodeAddressDetailed(query, parts);
  if (result.status !== "ok") {
    // Stabil kode uten adresse/PII. Gjør det mulig å se i driftsloggen at
    // geokoding feiler og hvilken leverandør som eventuelt svarte.
    console.warn("geocode_failed", {
      status: result.status,
      provider: result.provider ?? null,
      httpStatus: result.httpStatus ?? null,
    });
    return null;
  }
  return result.coordinates;
}
