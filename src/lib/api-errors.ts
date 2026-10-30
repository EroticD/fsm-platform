// i18n-ignore-file: sentral feilkatalog. `messageKey` er UI-kilden, mens
// `message` er en engelsk/norsk fallback for API-klienter som ikke oversetter.
import { NextResponse } from "next/server";

/**
 * Felles svarkonvolutter for REST-API-et.
 *
 * API-et er bearer-basert, så svarene skal aldri mellomlagres delt. `Vary`
 * gjør også at en eventuell cache foran appen skiller på Authorization.
 */
export const API_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Stabile feilkoder for hele API-flaten.
 *
 * De sju første er den offentlige `/api/v1`-kontrakten og skal aldri endres.
 * Resten brukes av interne ruter, der klienten oversetter `messageKey` via
 * `errors.api.*` i katalogene. Koden er stabil; `message` er bare fallback.
 */
export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    messageKey: string;
    details?: unknown;
  };
};

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "invalid_origin"
  | "not_authenticated"
  | "user_not_found"
  | "invalid_request"
  | "invalid_json"
  | "missing_field"
  | "invalid_data"
  | "too_large"
  | "upload_busy"
  | "no_file"
  | "invalid_file_type"
  | "mime_mismatch"
  | "image_processing_failed"
  | "storage_quota_exceeded"
  | "work_order_locked"
  | "legal_hold"
  | "department_inactive"
  | "invalid_file"
  | "file_not_found"
  | "invalid_path"
  | "save_failed"
  | "invalid_date"
  | "date_missing"
  | "invalid_end_date"
  | "end_before_start"
  | "invalid_status"
  | "unknown_entity"
  | "export_too_large"
  | "invalid_report_id";

type DefaultError = {
  status: number;
  messageKey: string;
  message: string;
};

const PUBLIC_DEFAULTS: Record<
  "unauthorized" | "forbidden" | "not_found" | "validation_error" | "conflict" | "rate_limited" | "server_error",
  DefaultError
> = {
  unauthorized: {
    status: 401,
    messageKey: "errors.api.unauthorized",
    message: "Ikke autentisert.",
  },
  forbidden: {
    status: 403,
    messageKey: "errors.api.forbidden",
    message: "Ingen tilgang.",
  },
  not_found: {
    status: 404,
    messageKey: "errors.api.notFound",
    message: "Fant ikke objektet.",
  },
  validation_error: {
    status: 422,
    messageKey: "errors.api.validation",
    message: "Feltene er ikke gyldige.",
  },
  conflict: {
    status: 409,
    messageKey: "errors.api.conflict",
    message: "Konflikten kan ikke løses.",
  },
  rate_limited: {
    status: 429,
    messageKey: "errors.api.rateLimited",
    message: "For mange API-kall. Prøv igjen senere.",
  },
  server_error: {
    status: 500,
    messageKey: "errors.api.serverError",
    message: "Kunne ikke behandle forespørselen.",
  },
};

const INTERNAL_DEFAULTS: Record<
  Exclude<ApiErrorCode, keyof typeof PUBLIC_DEFAULTS>,
  DefaultError
> = {
  invalid_origin: {
    status: 403,
    messageKey: "errors.api.invalidOrigin",
    message: "Invalid origin.",
  },
  not_authenticated: {
    status: 401,
    messageKey: "errors.api.notAuthenticated",
    message: "Not authenticated.",
  },
  user_not_found: {
    status: 404,
    messageKey: "errors.api.userNotFound",
    message: "User not found.",
  },
  invalid_request: {
    status: 400,
    messageKey: "errors.api.invalidRequest",
    message: "Invalid request.",
  },
  invalid_json: {
    status: 400,
    messageKey: "errors.api.invalidJson",
    message: "Invalid JSON.",
  },
  missing_field: {
    status: 400,
    messageKey: "errors.api.missingField",
    message: "A required field is missing.",
  },
  invalid_data: {
    status: 400,
    messageKey: "errors.api.invalidData",
    message: "Invalid data.",
  },
  too_large: {
    status: 413,
    messageKey: "errors.api.tooLarge",
    message: "The request is too large.",
  },
  upload_busy: {
    status: 503,
    messageKey: "errors.api.uploadBusy",
    message: "The upload queue is busy. Try again shortly.",
  },
  no_file: {
    status: 400,
    messageKey: "errors.api.noFile",
    message: "No file selected.",
  },
  invalid_file_type: {
    status: 400,
    messageKey: "errors.api.invalidFileType",
    message: "Invalid file type. Only images and PDF are allowed.",
  },
  mime_mismatch: {
    status: 415,
    messageKey: "errors.api.mimeMismatch",
    message: "The file content does not match its type.",
  },
  image_processing_failed: {
    status: 415,
    messageKey: "errors.api.imageProcessingFailed",
    message: "The file could not be processed as an image.",
  },
  storage_quota_exceeded: {
    status: 429,
    messageKey: "errors.api.storageQuotaExceeded",
    message: "The daily storage quota has been reached. Try again later.",
  },
  work_order_locked: {
    status: 403,
    messageKey: "errors.api.workOrderLocked",
    message: "The work order is locked.",
  },
  legal_hold: {
    status: 403,
    messageKey: "errors.api.legalHold",
    message: "The work order is under legal hold.",
  },
  department_inactive: {
    status: 403,
    messageKey: "errors.api.departmentInactive",
    message: "The department is inactive.",
  },
  invalid_file: {
    status: 400,
    messageKey: "errors.api.invalidFile",
    message: "Invalid file.",
  },
  file_not_found: {
    status: 404,
    messageKey: "errors.api.fileNotFound",
    message: "File not found.",
  },
  invalid_path: {
    status: 400,
    messageKey: "errors.api.invalidPath",
    message: "Invalid path.",
  },
  save_failed: {
    status: 500,
    messageKey: "errors.api.saveFailed",
    message: "Could not save the file.",
  },
  invalid_date: {
    status: 400,
    messageKey: "errors.api.invalidDate",
    message: "Invalid date.",
  },
  date_missing: {
    status: 400,
    messageKey: "errors.api.dateMissing",
    message: "A date is required.",
  },
  invalid_end_date: {
    status: 400,
    messageKey: "errors.api.invalidEndDate",
    message: "Invalid end date.",
  },
  end_before_start: {
    status: 400,
    messageKey: "errors.api.endBeforeStart",
    message: "The end date cannot be before the start date.",
  },
  invalid_status: {
    status: 400,
    messageKey: "errors.api.invalidStatus",
    message: "Invalid status.",
  },
  unknown_entity: {
    status: 400,
    messageKey: "errors.api.unknownEntity",
    message: "Unknown entity type.",
  },
  export_too_large: {
    status: 413,
    messageKey: "errors.api.exportTooLarge",
    message: "The export is too large. Contact us for a larger extract.",
  },
  invalid_report_id: {
    status: 400,
    messageKey: "errors.api.invalidReportId",
    message: "Invalid report id.",
  },
};

/**
 * Norske fallback-tekster for kontekstspesifikke meldinger. Nøkkelen er den
 * samme som `messageKey`, slik at ruter kan sende bare nøkkelen.
 */
export const API_ERROR_FALLBACKS: Record<string, string> = {
  "errors.api.workOrders.forbidden": "Du har ikke tilgang til oppdrag.",
  "errors.api.workOrders.notFound": "Fant ikke oppdraget.",
  "errors.api.workOrders.conflict": "Oppdraget kan ikke endres.",
  "errors.api.workOrders.validation": "Feltene er ikke gyldige.",
  "errors.api.workOrders.serverError": "Kunne ikke oppdatere oppdraget.",
  "errors.api.workOrders.createForbidden": "Du har ikke tilgang til å opprette oppdrag.",
  "errors.api.workOrders.updateForbidden": "Du har ikke tilgang til å endre oppdraget.",
  "errors.api.workOrders.invalidStatusFilter": "Ugyldig statusfilter.",
  "errors.api.workOrders.invalidFromDate": "Ugyldig fra-dato.",
  "errors.api.workOrders.invalidToDate": "Ugyldig til-dato.",
  "errors.api.workOrders.fromAfterTo": "Fra-dato kan ikke være etter til-dato.",
  "errors.api.workOrders.invalidTimestamp": "Ugyldig tidspunkt.",
  "errors.api.workOrders.unknownField": "Ukjent felt.",
  "errors.api.workOrders.invalidJson": "Ugyldig JSON.",
  "errors.api.workOrders.bodyObject": "Body må være et JSON-objekt.",
  "errors.api.workOrders.noFields": "Minst ett av feltene status, scheduledFor eller scheduledTo må sendes.",
  "errors.api.workOrders.invalidStartDate": "Ugyldig startdato.",
  "errors.api.workOrders.missingStartDate": "Oppdraget mangler startdato. Send scheduledFor sammen med scheduledTo.",
  "errors.api.workOrders.invalidEndDate": "Ugyldig sluttdato.",
  "errors.api.workOrders.reasonText": "Grunn må være tekst.",
  "errors.api.workOrders.titleRequired": "Tittel er påkrevd.",
  "errors.api.workOrders.startDateRequired": "Gyldig startdato er påkrevd.",
  "errors.api.workOrders.textFields": "Feltene må være tekst.",
  "errors.api.workOrders.textLists": "Listefeltene må være tekstlister.",
  "errors.api.customers.forbidden": "Du har ikke tilgang til kunder.",
  "errors.api.customers.notFound": "Fant ikke kunden.",
  "errors.api.documents.forbidden": "Du har ikke tilgang til dokumenter.",
  "errors.api.documents.notFound": "Fant ikke dokumentet.",
  "errors.api.reports.forbidden": "Du har ikke tilgang til rapporter.",
  "errors.api.reports.notFound": "Fant ikke rapporten.",
  "errors.api.reports.invalidLocked": "Ugyldig verdi for locked.",
  "errors.api.reports.invalidAcknowledged": "Ugyldig verdi for acknowledged.",
  "errors.api.visits.forbidden": "Du har ikke tilgang til visitten.",
  "errors.api.visits.createForbidden": "Du har ikke tilgang til å opprette visiter.",
  "errors.api.visits.updateForbidden": "Du har ikke tilgang til å endre visitten.",
  "errors.api.visits.deleteForbidden": "Du har ikke tilgang til å slette visitten.",
  "errors.api.visits.notFound": "Fant ikke visitten.",
  "errors.api.visits.conflict": "Visitten kan ikke endres.",
  "errors.api.visits.rateLimited": "For mange API-kall. Prøv igjen senere.",
  "errors.api.visits.serverError": "Kunne ikke oppdatere visitten.",
  "errors.api.visits.validation": "Feltene er ikke gyldige.",
  "errors.api.visits.unknownField": "Ukjent felt.",
  "errors.api.visits.noFields": "Minst ett av feltene startsAt/endsAt, status, technicianIds, notes, allDay eller sequence må sendes.",
  "errors.api.visits.oneOperation": "Bare én operasjon kan sendes om gangen.",
  "errors.api.visits.rangeTogether": "startsAt og endsAt må sendes sammen.",
  "errors.api.visits.invalidStart": "Ugyldig starttidspunkt.",
  "errors.api.visits.invalidEnd": "Ugyldig sluttidspunkt.",
  "errors.api.visits.endBeforeStart": "Slutt må være etter start.",
  "errors.api.visits.invalidStatus": "Ugyldig status.",
  "errors.api.visits.technicianIds": "technicianIds må være en liste med id-er.",
  "errors.api.visits.notesText": "notes må være tekst.",
  "errors.api.visits.allDayBoolean": "allDay må være boolsk.",
  "errors.api.visits.sequenceInteger": "sequence må være et heltall.",
  "errors.api.visits.startRequired": "Gyldig starttidspunkt (ISO 8601) er påkrevd.",
  "errors.api.visits.endRequired": "Gyldig sluttidspunkt (ISO 8601) er påkrevd.",
  "errors.api.tooLarge": "Forespørselen er for stor.",
  "errors.api.invalidJson": "Ugyldig JSON.",
  "errors.api.bodyObject": "Body må være et JSON-objekt.",
  "errors.api.saveFailed": "Kunne ikke lagre filen.",
  "errors.api.invalidRequest": "Ugyldig forespørsel.",
  "errors.api.comments.rateLimited": "For mange kommentarer. Prøv igjen om litt.",
  "errors.api.comments.tooLarge": "Kommentaren er for stor.",
  "errors.api.comments.invalidData": "Ugyldig data.",
  "errors.api.comments.unknownType": "Ukjent type.",
  "errors.api.comments.missingField": "Manglende felt.",
  "errors.api.comments.workOrderNotFound": "Oppdraget finnes ikke.",
  "errors.api.comments.customerNotFound": "Kunden finnes ikke.",
  "errors.api.comments.contactNotFound": "Kontakten finnes ikke.",
  "errors.api.comments.saveFailed": "Kunne ikke lagre kommentar.",
  "errors.api.upload.invalidOrigin": "Ugyldig origin.",
  "errors.api.upload.tooLarge": "Filen er for stor.",
  "errors.api.upload.rateLimited": "For mange opplastinger. Prøv igjen om litt.",
  "errors.api.upload.busy": "Opplastingen er opptatt. Prøv igjen om litt.",
  "errors.api.upload.noFile": "Ingen fil valgt.",
  "errors.api.upload.invalidType": "Ugyldig filtype. Bare bilder og PDF er tillatt.",
  "errors.api.upload.mimeMismatch": "Filinnholdet stemmer ikke med filtypen.",
  "errors.api.upload.quota": "Daglig lagringskvote er nådd. Prøv igjen senere.",
  "errors.api.upload.imageFailed": "Filen kunne ikke behandles som bilde.",
  "errors.api.upload.saveFailed": "Kunne ikke lagre filen.",
  "errors.api.upload.failed": "Kunne ikke laste opp fil.",
  "errors.api.upload.legalHold": "Oppdraget har bevaringsplikt.",
  "errors.api.upload.locked": "Oppdraget er låst.",
  "errors.api.upload.departmentInactive": "Avdelingen er deaktivert.",
  "errors.api.export.rateLimited": "For mange eksporter. Prøv igjen senere.",
  "errors.api.export.tooLarge": "Eksporten er begrenset til 5000 oppdrag. Kontakt oss for et større uttrekk.",
  "errors.api.date.invalid": "Ugyldig dato.",
  "errors.api.date.missing": "Dato mangler.",
  "errors.api.date.invalidEnd": "Ugyldig sluttdato.",
  "errors.api.date.endBeforeStart": "Sluttdato kan ikke være før startdato.",
  "errors.api.date.notFound": "Oppdraget finnes ikke.",
  "errors.api.date.legalHold": "Oppdraget har bevaringsplikt og kan ikke flyttes.",
  "errors.api.date.saveFailed": "Kunne ikke oppdatere dato.",
  "errors.api.attachment.notFound": "Vedlegget finnes ikke.",
  "errors.api.attachment.legalHold": "Oppdraget har bevaringsplikt.",
  "errors.api.attachment.locked": "Oppdraget er låst.",
  "errors.api.attachment.saveFailed": "Kunne ikke lagre vedlegget.",
  "errors.api.attachment.deleteFailed": "Kunne ikke slette vedlegget.",
  "errors.api.apiKey.invalid": "Ugyldig eller utløpt API-nøkkel",
  "errors.api.apiKey.missing": "Mangler Bearer-token",
  "errors.api.apiKey.authFailed": "Kunne ikke autentisere API-forespørselen.",
};

function defaultFor(code: ApiErrorCode): DefaultError {
  if (code in PUBLIC_DEFAULTS) {
    return PUBLIC_DEFAULTS[code as keyof typeof PUBLIC_DEFAULTS];
  }
  return INTERNAL_DEFAULTS[
    code as Exclude<ApiErrorCode, keyof typeof PUBLIC_DEFAULTS>
  ];
}

export type ApiErrorOptions = {
  /** i18n-nøkkel uten `common.`-prefiks, f.eks. `errors.api.forbidden`. */
  messageKey?: string;
  /** Fallback når klienten ikke kan oversette. */
  message?: string;
  details?: unknown;
  headers?: Record<string, string>;
};

/**
 * Feilsvar på den offentlige konvolutten `{ error: { code, message, messageKey, details? } }`.
 *
 * `code` og `message` er bakoverkompatible; `messageKey` er additivt og lar
 * klienten oversette teksten. `status` kan utelates når koden har en kjent
 * standardstatus.
 */
export function apiError(
  code: ApiErrorCode,
  status?: number,
  options: ApiErrorOptions = {},
): NextResponse {
  const fallback = defaultFor(code);
  const messageKey = options.messageKey ?? fallback.messageKey;
  const message =
    options.message ??
    API_ERROR_FALLBACKS[messageKey] ??
    fallback.message;

  const body = {
    error: {
      code,
      message,
      messageKey,
      ...(options.details === undefined ? {} : { details: options.details }),
    },
  };

  return NextResponse.json(body, {
    status: status ?? fallback.status,
    headers: { ...API_RESPONSE_HEADERS, ...options.headers },
  });
}

/**
 * Feilsvar for interne ruter (ikke `/api/v1`).
 *
 * Formen er flat fordi de interne klientene allerede leste `data.error`:
 * `{ error: <stabil kode>, messageKey, message }`. Klienten viser
 * `messageKey` oversatt og faller tilbake til `message`.
 */
export function internalApiError(
  code: ApiErrorCode,
  status?: number,
  options: ApiErrorOptions = {},
): NextResponse {
  const fallback = defaultFor(code);
  const messageKey = options.messageKey ?? fallback.messageKey;
  const message =
    options.message ??
    (options.messageKey ? API_ERROR_FALLBACKS[messageKey] : undefined) ??
    fallback.message;

  return NextResponse.json(
    { error: code, messageKey, message },
    {
      status: status ?? fallback.status,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        ...options.headers,
      },
    },
  );
}

/** Er en verdi en kjent feilkode? Brukes av klienter og tester. */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    (Object.hasOwn(PUBLIC_DEFAULTS, value) ||
      Object.hasOwn(INTERNAL_DEFAULTS, value))
  );
}
