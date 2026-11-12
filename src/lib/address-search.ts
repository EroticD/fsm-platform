/**
 * Adressesøk mot Kartverket (Geonorge).
 *
 * Tjenesten er åpen og krever ingen nøkkel. Vi bruker den til autofullføring
 * i skjemaer, der brukeren skriver en norsk gateadresse og velger blant
 * forslagene. Hvert treff inneholder ferdig oppdelte felt, slik at
 * kallstedet slipper å gjette hvor postnummeret begynner.
 */

const SEARCH_ENDPOINT = "https://ws.geonorge.no/adresser/v1/sok";

/**
 * Geonorge ber om en identifiserbar User-Agent. Vi oppgir applikasjonsnavn og
 * en URL de kan nå oss på, og lar miljøet overstyre den i installasjoner som
 * har eget domene.
 */
const DEFAULT_USER_AGENT = "FSM-platform (https://github.com/EroticD/fsm-platform)";

/** Adresser endrer seg sjelden; ett døgns cache holder og sparer tjenesten. */
const REVALIDATE_SECONDS = 86_400;

/** Kort tidsgrense: søket skjer mens brukeren skriver. */
const TIMEOUT_MS = 4_000;

/** Standard og maksimalt antall forslag. */
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

/** Under denne lengden er søket for bredt til å gi nyttige forslag. */
const MIN_QUERY_LENGTH = 3;

export type AddressHit = {
  text: string;
  postalCode: string | null;
  city: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
};

export type AddressSearch =
  | { status: "ok"; hits: AddressHit[] }
  | { status: "unavailable" };

/**
 * Valgfrie holdepunkter fra skjemaet. Geonorge sorterer ikke etter relevans, så
 * når brukeren allerede har skrevet postnummer eller sted, bruker vi det til å
 * løfte det riktige treffet øverst.
 */
export type AddressSearchHints = {
  postalCode?: string | null;
  city?: string | null;
};

function normalizeCity(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleUpperCase("nb-NO");
}

function rankHits(hits: AddressHit[], hints: AddressSearchHints): AddressHit[] {
  const postal = (hints.postalCode ?? "").replace(/\s/g, "");
  const city = normalizeCity(hints.city);
  if (!postal && !city) return hits;

  const score = (hit: AddressHit) => {
    if (postal && (hit.postalCode ?? "").replace(/\s/g, "") === postal) return 0;
    if (
      city &&
      (normalizeCity(hit.city) === city || normalizeCity(hit.municipality) === city)
    ) {
      return 1;
    }
    return 2;
  };

  // Sorteringen er stabil, så treff med samme relevans beholder kildens orden.
  return [...hits].sort((a, b) => score(a) - score(b));
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

/**
 * Leser en tekstverdi trygt: trimmer, og gir null for tomme verdier slik at
 * UI kan skjule feltet framfor å vise en tom streng.
 */
function readText(source: UnknownRecord | null, key: string): string | null {
  const value = source?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Koordinater kommer som tall fra Geonorge, men vi godtar også numeriske
 * strenger. Tomme verdier må ikke bli 0, som er en gyldig koordinat.
 */
function readCoordinate(source: UnknownRecord | null, key: string): number | null {
  const value = source?.[key];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Klemmer limit til 1..20. `undefined`, NaN, 0 og negative verdier faller
 * tilbake til standarden, slik at et uheldig kall aldri ber om null treff.
 */
function clampLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  const floored = Math.floor(limit);
  if (floored < 1) return DEFAULT_LIMIT;
  return Math.min(floored, MAX_LIMIT);
}

function userAgent(): string {
  return process.env.GEOCODE_USER_AGENT || DEFAULT_USER_AGENT;
}

function toAddressHit(raw: unknown): AddressHit | null {
  const adresse = asRecord(raw);
  // Et treff uten adressetekst kan ikke vises i en valgliste.
  const text = readText(adresse, "adressetekst");
  if (!text) return null;

  const point = asRecord(adresse?.representasjonspunkt);

  return {
    text,
    postalCode: readText(adresse, "postnummer"),
    city: readText(adresse, "poststed"),
    municipality: readText(adresse, "kommunenavn"),
    lat: readCoordinate(point, "lat"),
    lng: readCoordinate(point, "lon"),
  };
}

/**
 * Søker etter adresser og returnerer forslag til autofullføring.
 *
 * Feiler aldri med kast: nettverksfeil, timeout, uventet status og ugyldig
 * JSON blir `unavailable`, slik at kallstedet kan la brukeren skrive adressen
 * manuelt uten å vise en teknisk feil. Søk på under tre tegn gir tomt
 * resultat uten nettverkskall – vi vil ikke spamme tjenesten mens brukeren
 * skriver, og Geonorge ville uansett gitt støyende treff.
 */
export async function searchAddresses(
  query: string,
  limit?: number,
  hints: AddressSearchHints = {},
): Promise<AddressSearch> {
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (trimmed.length < MIN_QUERY_LENGTH) return { status: "ok", hits: [] };

  const size = clampLimit(limit);

  try {
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set("adressetekst", trimmed);
    url.searchParams.set("treffPerSide", String(size));
    // UTM sone 33 / ETRS89 (EPSG:4258) gir lat/lon direkte, som Leaflet vil ha.
    url.searchParams.set("utkoordsys", "4258");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent(),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (response.status !== 200) return { status: "unavailable" };

    const data = asRecord(await response.json());
    const adresser = data?.adresser;
    if (!Array.isArray(adresser)) return { status: "unavailable" };

    const hits: AddressHit[] = [];
    // Geonorge kan returnere samme adresse flere ganger (for eksempel én rad
    // per matrikkelenhet). Vi viser den bare én gang per tekst og postnummer.
    const seen = new Set<string>();

    for (const raw of adresser) {
      const hit = toAddressHit(raw);
      if (!hit) continue;

      const key = `${hit.text}\u0000${hit.postalCode ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hits.push(hit);
      // Geonorge har ingen relevanssortering, og «Karl Johans gate 1» finnes i
      // flere byer. Vi henter et bredt sett og rangerer selv, ellers kan riktig
      // by falle utenfor limit.
      if (hits.length >= Math.max(size * 5, 25)) break;
    }

    return { status: "ok", hits: rankHits(hits, hints).slice(0, size) };
  } catch {
    // Nettverksfeil, timeout eller ugyldig JSON. Vi logger ikke kroppen: den
    // kan inneholde adresser vi ikke trenger å lagre, og feilen er ikke
    // handlingsbar for kallstedet.
    return { status: "unavailable" };
  }
}
