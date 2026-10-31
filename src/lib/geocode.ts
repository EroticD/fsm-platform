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

/**
 * Geokoder en adresse med OpenStreetMap Nominatim.
 *
 * Dette er en best-effort tjeneste: kartet skal fortsatt virke hvis nettverket
 * eller geokoderen er utilgjengelig. Resultatet caches i databasen av
 * createWorkOrder/updateWorkOrder.
 */
export async function geocodeAddress(
  query: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  const value = query?.trim();
  // Testene skal aldri gjøre eksterne nettverkskall.
  if (
    !value ||
    process.env.NODE_ENV === "test" ||
    process.env.GEOCODE_ENABLED === "false"
  ) {
    return null;
  }

  const endpoint =
    process.env.GEOCODE_ENDPOINT ??
    "https://nominatim.openstreetmap.org/search";
  const url = new URL(endpoint);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "no");
  url.searchParams.set("q", value);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          process.env.GEOCODE_USER_AGENT ??
          process.env.APP_URL ??
          "FSM-platform/0.8.5",
      },
      signal: AbortSignal.timeout(Number(process.env.GEOCODE_TIMEOUT_MS) || 3500),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
    }>;
    const first = data[0];
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
