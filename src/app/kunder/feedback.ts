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
  "avtale-oppdatert": "customers.feedback.status.contractUpdated",
  "avtale-aktivert": "customers.feedback.status.contractActivated",
  "avtale-gjenopptatt": "customers.feedback.status.contractResumed",
  "avtale-pauset": "customers.feedback.status.contractPaused",
  "avtale-avsluttet": "customers.feedback.status.contractTerminated",
  "avtale-fornyet": "customers.feedback.status.contractRenewed",
  "avtale-slettet": "customers.feedback.status.contractDeleted",
  "avtale-linje-lagt-til": "customers.feedback.status.contractLineCreated",
  "avtale-linje-slettet": "customers.feedback.status.contractLineDeleted",
};

export const CUSTOMER_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "ugyldig-data": "customers.feedback.error.invalid",
  forbidden: "customers.feedback.error.forbidden",
  "ikke-funnet": "customers.feedback.error.notFound",
  konflikt: "customers.feedback.error.conflict",
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
    case "conflict":
      return "konflikt";
    default:
      return "ukjent";
  }
}
