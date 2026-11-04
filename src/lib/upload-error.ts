import {
  apiErrorMessage,
  type ApiErrorPayload,
} from "@/lib/api-error-message";

type Translate = (key: string) => string;

/**
 * Statuskoder fra opplastingsruten har alltid en `messageKey` når svaret
 * kommer fra appen. Kommer 413 fra en reverse proxy (Caddy/nginx), er kroppen
 * ofte ren tekst eller HTML, og klienten får ingen JSON. Da velger vi den
 * lokale oversettelsen ut fra statuskoden, slik at brukeren ser «Filen er for
 * stor» i stedet for en generisk «opplasting feilet».
 */
const STATUS_MESSAGE_KEYS: Record<number, string> = {
  413: "errors.api.upload.tooLarge",
  415: "errors.api.upload.invalidType",
  429: "errors.api.upload.rateLimited",
  503: "errors.api.upload.busy",
  507: "errors.api.upload.quota",
};

export function uploadErrorMessage(
  response: { status: number } | null | undefined,
  payload: ApiErrorPayload | null | undefined,
  t: Translate,
  fallback: string,
): string {
  // Tom fallback gjør at vi kan se om svaret selv ga en oversettbar melding.
  const message = apiErrorMessage(payload, t, "");
  if (message) return message;

  const statusKey = response ? STATUS_MESSAGE_KEYS[response.status] : undefined;
  if (statusKey) {
    const translated = t(statusKey);
    if (translated) return translated;
  }

  return fallback;
}

export type UploadFailure = {
  name: string;
  /** Lokalisert feilmelding fra serveren, eller tom når den mangler. */
  message: string;
};

/**
 * Oppsummerer feilede filer uten å kaste bort den faktiske årsaken (413, 415,
 * 429, 507 eller 503). Ved flere filer vises antallet og navnene som før, men
 * de unike årsakene henges på slik at brukeren ser hva som må rettes.
 */
export function uploadFailureText(
  failures: UploadFailure[],
  one: (name: string) => string,
  many: (count: number, names: string) => string,
): string {
  if (failures.length === 0) return "";
  if (failures.length === 1) {
    return failures[0].message || one(failures[0].name);
  }

  const names = failures.map((failure) => failure.name).join(", ");
  const details = [
    ...new Set(failures.map((failure) => failure.message).filter(Boolean)),
  ];
  const summary = many(failures.length, names);
  return details.length > 0 ? `${summary} ${details.join(" ")}` : summary;
}
