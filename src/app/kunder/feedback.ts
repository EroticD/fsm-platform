import type { ServiceError } from "@/server/actor";

/**
 * Statuskoder som handlingene redirecter med. Sidene oversetter koden til en
 * toast. Vi bruker query-parametere fordi skjemaene er vanlige server actions;
 * da virker tilbakemeldingen også uten klientside-JS.
 */
export const CUSTOMER_STATUS_MESSAGE_KEYS: Record<string, string> = {
  "kunde-opprettet": "customers.feedback.status.customerCreated",
  "kunde-oppdatert": "customers.feedback.status.customerUpdated",
  "kunde-slettet": "customers.feedback.status.customerDeleted",
  "kunde-gjenopprettet": "customers.feedback.status.customerRestored",
  "enhet-lagt-til": "customers.feedback.status.unitCreated",
  "enhet-oppdatert": "customers.feedback.status.unitUpdated",
  "enhet-slettet": "customers.feedback.status.unitDeleted",
  "kontakt-lagt-til": "customers.feedback.status.contactCreated",
  "kontakt-oppdatert": "customers.feedback.status.contactUpdated",
  "kontakt-slettet": "customers.feedback.status.contactDeleted",
  "avtale-opprettet": "customers.feedback.status.contractCreated",
  "avtale-aktivert": "customers.feedback.status.contractActivated",
  "avtale-pauset": "customers.feedback.status.contractPaused",
  "avtale-slettet": "customers.feedback.status.contractDeleted",
};

export const CUSTOMER_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "ugyldig-data": "customers.feedback.error.invalid",
  forbidden: "customers.feedback.error.forbidden",
  "ikke-funnet": "customers.feedback.error.notFound",
  ukjent: "customers.feedback.error.unknown",
};

export function customerStatusMessageKey(status?: string | null) {
  return status ? (CUSTOMER_STATUS_MESSAGE_KEYS[status] ?? null) : null;
}

export function customerErrorMessageKey(error?: string | null) {
  return error ? (CUSTOMER_ERROR_MESSAGE_KEYS[error] ?? null) : null;
}

/** Oversetter tjenestefeil til en query-verdi sidene kjenner igjen. */
export function customerErrorParam(reason: ServiceError): string {
  switch (reason) {
    case "invalid":
      return "ugyldig-data";
    case "forbidden":
      return "forbidden";
    case "not_found":
    case "customer_not_found":
    case "file_not_found":
      return "ikke-funnet";
    default:
      return "ukjent";
  }
}
