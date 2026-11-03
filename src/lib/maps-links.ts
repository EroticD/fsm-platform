/**
 * Lenker til kart og telefon uten API-nøkkel.
 *
 * Feltappen skal åpne den installerte kartappen på telefonen:
 *  - iOS: Apple Maps (https-lenken åpnes i appen når den er installert)
 *  - Android: `geo:`-skjemaet, som Android sender til valgt kartapp
 *  - ellers: Google Maps i nettleseren
 *
 * All tekst blir URL-kodet, og koordinater valideres før de brukes. En
 * adresse eller et telefonnummer fra databasen skal aldri kunne bli en
 * vilkårlig URL.
 */

export type MapPlatform = "ios" | "android" | "desktop";

export type MapTarget = {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
};

export function isValidCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
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

/** «Storgata 1, 0184 Oslo» – uten tomme ledd eller doble komma. */
export function formatMapAddress(target: MapTarget): string | null {
  const parts = [target.address, target.postalCode, target.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Målet kartappen skal navigere til. Koordinater vinner over adresse fordi
 * de er mer presise; mangler begge, finnes ingen navigasjonslenke.
 */
export function mapDestination(target: MapTarget): string | null {
  if (isValidCoordinates(target.latitude, target.longitude)) {
    return `${target.latitude},${target.longitude}`;
  }
  return formatMapAddress(target);
}

export function detectMapPlatform(
  userAgent: string | null | undefined,
  maxTouchPoints = 0,
): MapPlatform {
  const ua = userAgent ?? "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ melder seg som Macintosh. Berøringsskjerm skiller den fra en
  // vanlig Mac.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  return "desktop";
}

/**
 * Bygger navigasjonslenke. Returnerer `null` når både koordinater og adresse
 * mangler, slik at UI-et kan skjule handlingen i stedet for å vise en død knapp.
 */
export function buildDirectionsUrl(
  target: MapTarget,
  platform: MapPlatform = "desktop",
): string | null {
  const destination = mapDestination(target);
  if (!destination) return null;
  const encoded = encodeURIComponent(destination);

  if (platform === "ios") {
    return `https://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  }

  if (platform === "android") {
    // `geo:0,0?q=` ber Android velge installert kartapp. Med koordinater
    // bruker vi den presise posisjonen i stedet for adresseoppslag.
    return `geo:0,0?q=${encoded}`;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}

/**
 * Trygg `tel:`-lenke. Bokstaver og skilletegn som ikke hører hjemme i et
 * telefonnummer avvises, slik at feltet ikke kan brukes til å smugle en annen
 * URI inn i `href`.
 */
export function buildPhoneUrl(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s().-]/g, "");
  if (!/^\+?\d{3,20}$/.test(compact)) return null;
  return `tel:${compact}`;
}
