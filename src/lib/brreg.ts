/**
 * Oppslag mot Enhetsregisteret (Brønnøysundregistrene).
 *
 * API-et er åpent og krever ingen nøkkel. Vi henter bare det vi trenger for
 * kundekortet, og oversetter HTTP-status til en stabil status slik at UI kan
 * skille «finnes ikke», «slettet» og «tjenesten svarte ikke».
 */

const ENHETER_ENDPOINT =
  "https://data.brreg.no/enhetsregisteret/api/enheter";

const UNDERENHETER_ENDPOINT =
  "https://data.brreg.no/enhetsregisteret/api/underenheter";

/**
 * Brreg ber om en identifiserbar User-Agent med kontaktinformasjon. Vi bruker
 * applikasjonsnavn pluss en URL de kan nå oss på, og lar miljøet overstyre
 * adressen i installasjoner som har eget domene.
 */
const DEFAULT_CONTACT_URL = "https://github.com/EroticD/fsm-platform";

/** 24 timer cache. Enheter endrer seg sjelden, og vi vil ikke hamre på Brreg. */
const REVALIDATE_SECONDS = 86_400;

/** Kort tidsgrense: oppslaget skjer i en interaktiv flyt. */
const TIMEOUT_MS = 4_000;

export type CompanyRecord = {
  orgNumber: string;
  name: string;
  organisationForm: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  industryCode: string | null;
  industryDescription: string | null;
  employees: number | null;
  registeredInVat: boolean;
  bankrupt: boolean;
  underLiquidation: boolean;
};

export type CompanyLookup =
  | { status: "found"; company: CompanyRecord }
  | { status: "not_found" }
  | { status: "removed" }
  | { status: "unavailable" };

/**
 * Lettvektstreff fra navnesøk. Bevisst et subset av `CompanyRecord`: listen
 * viser bare det man trenger for å velge riktig firma, og detaljene hentes med
 * `lookupCompany` når brukeren har valgt.
 */
export type CompanySummary = {
  orgNumber: string;
  name: string;
  organisationForm: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  bankrupt: boolean;
  underLiquidation: boolean;
};

export type CompanySearch =
  | { status: "ok"; companies: CompanySummary[]; total: number }
  | { status: "unavailable" };

/** Underenhet (avdeling/filial) tilknyttet en hovedenhet. */
export type SubUnit = {
  orgNumber: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
};

export type SubUnitList =
  | { status: "ok"; units: SubUnit[] }
  | { status: "not_found" }
  | { status: "unavailable" };

function userAgent(): string {
  const contact = process.env.BRREG_CONTACT_URL || DEFAULT_CONTACT_URL;
  return `FSM-platform/1.0 (+${contact})`;
}

/**
 * Normaliserer et organisasjonsnummer fra skjema, CSV eller API.
 *
 * Godtar mellomrom og punktum som gruppering, valgfri `NO`-prefiks og
 * `MVA`/`-MVA`-suffiks. Returnerer de ni sifrene, eller null når inndata ikke
 * kan være et organisasjonsnummer. Vi validerer ikke kontrollsifferet her;
 * det gjør `isValidOrgNumber`.
 */
export function normalizeOrgNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;

  let value = input.replace(/[\s.]/g, "").toUpperCase();
  value = value.replace(/-?MVA$/, "");
  value = value.replace(/^NO/, "");

  return /^\d{9}$/.test(value) ? value : null;
}

/**
 * Norsk mod11-kontroll for organisasjonsnummer.
 *
 * Vektene 3,2,7,6,5,4,3,2 legges på de åtte første sifrene. Kontrollsifferet
 * er 11 - (sum % 11), der 11 blir 0 og 10 betyr ugyldig nummer.
 */
export function isValidOrgNumber(digits: string): boolean {
  if (typeof digits !== "string" || !/^\d{9}$/.test(digits)) return false;

  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    sum += Number(digits[index]) * weights[index];
  }

  const remainder = sum % 11;
  const checkDigit = 11 - remainder;
  if (checkDigit === 10) return false;

  return (checkDigit === 11 ? 0 : checkDigit) === Number(digits[8]);
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readString(source: JsonObject | null, key: string): string | null {
  const value = source?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(source: JsonObject | null, key: string): boolean {
  return source?.[key] === true;
}

function readEmployees(source: JsonObject | null): number | null {
  const value = source?.antallAnsatte;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/** Adressefeltet er en array av linjer, f.eks. ["Storgata 1", "Postboks 2"]. */
function readAddressLines(source: JsonObject | null): string | null {
  const lines = source?.adresse;
  if (!Array.isArray(lines)) return null;
  const parts = lines
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Forretningsadresse er den reelle driftsadressen og foretrekkes. Postadresse
 * brukes bare når forretningsadressen mangler. Adresse, postnummer og poststed
 * hentes fra samme objekt, slik at vi ikke blander to adresser.
 */
function readLocation(enhet: JsonObject): {
  address: string | null;
  postalCode: string | null;
  city: string | null;
} {
  const forretningsadresse = asObject(enhet.forretningsadresse);
  const postadresse = asObject(enhet.postadresse);
  const chosen = forretningsadresse ?? postadresse;

  return {
    address: readAddressLines(chosen),
    postalCode: readString(chosen, "postnummer"),
    city: readString(chosen, "poststed"),
  };
}

function toCompanyRecord(enhet: JsonObject, fallbackOrgNumber: string): CompanyRecord {
  const location = readLocation(enhet);
  const naeringskode = asObject(enhet.naeringskode1);
  const organisasjonsform = asObject(enhet.organisasjonsform);

  return {
    orgNumber: readString(enhet, "organisasjonsnummer") ?? fallbackOrgNumber,
    name: readString(enhet, "navn") ?? "",
    organisationForm: readString(organisasjonsform, "beskrivelse"),
    address: location.address,
    postalCode: location.postalCode,
    city: location.city,
    phone: readString(enhet, "telefon"),
    website: readString(enhet, "hjemmeside"),
    industryCode: readString(naeringskode, "kode"),
    industryDescription: readString(naeringskode, "beskrivelse"),
    employees: readEmployees(enhet),
    registeredInVat: readBoolean(enhet, "registrertIMvaregisteret"),
    bankrupt: readBoolean(enhet, "konkurs"),
    underLiquidation:
      readBoolean(enhet, "underAvvikling") ||
      readBoolean(enhet, "underTvangsavviklingEllerTvangsopplosning"),
  };
}

/**
 * Slår opp én enhet på organisasjonsnummer.
 *
 * Feiler aldri med kast: alle avvikende svar blir `unavailable`, slik at
 * kallstedet kan vise en nøytral melding og la brukeren skrive inn manuelt.
 */
export async function lookupCompany(orgNumber: unknown): Promise<CompanyLookup> {
  const normalized = normalizeOrgNumber(orgNumber);
  if (!normalized) return { status: "not_found" };

  try {
    const response = await fetch(`${ENHETER_ENDPOINT}/${normalized}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent(),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Enheter endrer seg sjelden; 24 timer holder.
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (response.status === 404) return { status: "not_found" };
    if (response.status === 410) return { status: "removed" };
    if (response.status !== 200) return { status: "unavailable" };

    const data = asObject(await response.json());
    if (!data) return { status: "unavailable" };

    return { status: "found", company: toCompanyRecord(data, normalized) };
  } catch {
    // Nettverksfeil, timeout eller ugyldig JSON. Vi logger ikke kroppen:
    // den kan inneholde mer enn vi trenger, og feilen er ikke handlingsbar.
    return { status: "unavailable" };
  }
}

/** Standard og maksimal sidestørrelse i navnesøket. */
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 20;

/**
 * Klemmer limit til 1..20. `undefined`, NaN, 0 og negative verdier faller
 * tilbake til standarden, slik at et uheldig kall aldri ber om 0 treff eller
 * en uendelig side.
 */
function clampSearchLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  const floored = Math.floor(limit);
  if (floored < 1) return DEFAULT_SEARCH_LIMIT;
  return Math.min(floored, MAX_SEARCH_LIMIT);
}

/**
 * Adressen til en underenhet.
 *
 * Underenheter har ikke `forretningsadresse` slik hovedenheter har; den reelle
 * driftsadressen ligger i `beliggenhetsadresse`. `postadresse` er ofte
 * hovedkontorets postadresse og brukes derfor bare når ingen av de andre
 * finnes. Vi tar første kilde som faktisk har innhold, slik at et tomt objekt
 * ikke skygger for en brukbar adresse lenger ned.
 */
function readSubUnitLocation(unit: JsonObject): {
  address: string | null;
  postalCode: string | null;
  city: string | null;
} {
  for (const key of ["forretningsadresse", "beliggenhetsadresse", "postadresse"]) {
    const candidate = asObject(unit[key]);
    if (!candidate) continue;

    const location = {
      address: readAddressLines(candidate),
      postalCode: readString(candidate, "postnummer"),
      city: readString(candidate, "poststed"),
    };
    if (location.address || location.postalCode || location.city) return location;
  }

  return { address: null, postalCode: null, city: null };
}

function toCompanySummary(enhet: JsonObject): CompanySummary {
  const location = readLocation(enhet);
  const organisasjonsform = asObject(enhet.organisasjonsform);

  return {
    orgNumber: readString(enhet, "organisasjonsnummer") ?? "",
    name: readString(enhet, "navn") ?? "",
    organisationForm: readString(organisasjonsform, "beskrivelse"),
    address: location.address,
    postalCode: location.postalCode,
    city: location.city,
    bankrupt: readBoolean(enhet, "konkurs"),
    underLiquidation:
      readBoolean(enhet, "underAvvikling") ||
      readBoolean(enhet, "underTvangsavviklingEllerTvangsopplosning"),
  };
}

/**
 * Søker etter enheter på navn.
 *
 * `total` er antall treff i hele registeret (fra `page.totalElements`), ikke
 * antall rader vi returnerte, slik at UI kan si «viser 10 av 1 375 treff».
 * Søk på under to tegn gir tomt resultat uten nettverkskall – Brreg ville
 * uansett avvist det, og vi vil ikke spamme tjenesten mens brukeren skriver.
 */
export async function searchCompaniesByName(
  query: string,
  limit?: number,
): Promise<CompanySearch> {
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (trimmed.length < 2) return { status: "ok", companies: [], total: 0 };

  const size = clampSearchLimit(limit);

  try {
    const response = await fetch(
      `${ENHETER_ENDPOINT}?navn=${encodeURIComponent(trimmed)}&size=${size}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent(),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: REVALIDATE_SECONDS },
      },
    );

    if (response.status !== 200) return { status: "unavailable" };

    const data = asObject(await response.json());
    if (!data) return { status: "unavailable" };

    const enheter = asObject(data._embedded)?.enheter;
    const companies: CompanySummary[] = [];

    if (Array.isArray(enheter)) {
      for (const raw of enheter) {
        const enhet = asObject(raw);
        if (!enhet) continue;

        // Treff uten navn kan ikke vises i en valgliste. Vi hopper over dem
        // framfor å vise en tom rad brukeren ikke kan skille fra de andre.
        const summary = toCompanySummary(enhet);
        if (!summary.name) continue;

        companies.push(summary);
      }
    }

    // Mangler `page`, er svaret ikke det vi forventer; da er antallet ukjent og
    // vi rapporterer det vi faktisk har.
    const totalElements = asObject(data.page)?.totalElements;
    const total =
      typeof totalElements === "number" && Number.isFinite(totalElements)
        ? Math.max(0, Math.trunc(totalElements))
        : companies.length;

    return { status: "ok", companies, total };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Lister underenhetene til en hovedenhet.
 *
 * Brreg svarer 200 med tom liste for organisasjonsnumre som ikke finnes, så
 * `not_found` kommer i praksis bare fra 404 eller ugyldig inndata. Vi beholder
 * begge, slik at kallstedet ikke trenger å kjenne den detaljen.
 */
export async function listSubUnits(orgNumber: unknown): Promise<SubUnitList> {
  const normalized = normalizeOrgNumber(orgNumber);
  if (!normalized) return { status: "not_found" };

  try {
    const response = await fetch(
      `${UNDERENHETER_ENDPOINT}?overordnetEnhet=${normalized}&size=100`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent(),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: REVALIDATE_SECONDS },
      },
    );

    if (response.status === 404) return { status: "not_found" };
    if (response.status !== 200) return { status: "unavailable" };

    const data = asObject(await response.json());
    if (!data) return { status: "unavailable" };

    const underenheter = asObject(data._embedded)?.underenheter;
    const units: SubUnit[] = [];

    if (Array.isArray(underenheter)) {
      for (const raw of underenheter) {
        const unit = asObject(raw);
        if (!unit) continue;

        const unitOrgNumber = readString(unit, "organisasjonsnummer");
        if (!unitOrgNumber) continue;

        const location = readSubUnitLocation(unit);
        units.push({
          orgNumber: unitOrgNumber,
          // Underenheter kan mangle navn i registeret; tom streng gjør at UI
          // kan vise orgnummeret i stedet uten å håndtere null.
          name: readString(unit, "navn") ?? "",
          address: location.address,
          postalCode: location.postalCode,
          city: location.city,
        });
      }
    }

    return { status: "ok", units };
  } catch {
    return { status: "unavailable" };
  }
}
