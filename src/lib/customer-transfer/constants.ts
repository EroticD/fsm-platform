// i18n-ignore-file: stabile feilkoder, MIME-typer og tekniske grenser er data,
// ikke UI-tekst. Brukervendte meldinger ligger i message-katalogene.
/**
 * Felles kontrakter for admin-eksport/import av kundepakker.
 *
 * Grensene er bevisst konservative. Hele ZIP-en holdes i minnet i v1 (ingen
 * strømmende arkivskriver), så `MAX_PACKAGE_BYTES` er også en minnegrense.
 * Se docs/OPERATIONS.md og docs/DECISIONS.md.
 */
export const TRANSFER_FORMAT = "fsm-customer-export";
/** Gjeldende format. 1.1 legger bare til en deterministisk `packageId`. */
export const TRANSFER_SCHEMA_VERSION = "1.1";
export const TRANSFER_SUPPORTED_MAJOR = 1;
/** Eksplisitt liste. Ukjente minor-/majorversjoner avvises, aldri gjettet. */
export const TRANSFER_SUPPORTED_SCHEMA_VERSIONS = ["1.0", "1.1"] as const;

const MiB = 1024 * 1024;

export const TRANSFER_LIMITS = {
  /** Maks størrelse på hele ZIP-pakken (lastes i minnet i v1). */
  maxPackageBytes: 500 * MiB,
  /** Maks størrelse på én fil i pakken. */
  maxFileBytes: 50 * MiB,
  /** Maks størrelse på én JSON-fil i data/. */
  maxJsonBytes: 100 * MiB,
  /** Maks antall oppføringer i ZIP-en. */
  maxEntries: 20_000,
  /** Maks ukomprimert totalstørrelse. */
  maxTotalBytes: 500 * MiB,
  /** Maks kompresjonsforhold per oppføring og totalt. */
  maxCompressionRatio: 100,
  /** Maks banelengde i arkivet. */
  maxPathLength: 255,
  /** Maks antall kunder i én eksport. */
  maxCustomers: 100,
  /** Maks antall revisjonsrader i proveniens-snapshotet. */
  maxAuditRows: 5_000,
  /** Levetid for eksportartefakter og staging. */
  exportTtlMs: 24 * 60 * 60 * 1000,
  /** Levetid for et forhåndsvisningstoken. */
  previewTtlMs: 30 * 60 * 1000,
} as const;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

export const ALLOWED_MIME_SET = new Set<string>(ALLOWED_MIME_TYPES);

export const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Stabile feilkoder. Brukes både i API-svar og i jobbens errorJson. */
export const TRANSFER_ERROR = {
  forbidden: "customer_transfer.forbidden",
  not_found: "customer_transfer.not_found",
  invalid_manifest: "customer_transfer.invalid_manifest",
  unsupported_schema: "customer_transfer.unsupported_schema",
  invalid_data: "customer_transfer.invalid_data",
  count_mismatch: "customer_transfer.count_mismatch",
  checksum_mismatch: "customer_transfer.checksum_mismatch",
  duplicate_source_id: "customer_transfer.duplicate_source_id",
  invalid_reference: "customer_transfer.invalid_reference",
  cross_customer_reference: "customer_transfer.cross_customer_reference",
  missing_file: "customer_transfer.missing_file",
  file_too_large: "customer_transfer.file_too_large",
  too_many_entries: "customer_transfer.too_many_entries",
  compression_ratio: "customer_transfer.compression_ratio",
  path_traversal: "customer_transfer.path_traversal",
  duplicate_entry: "customer_transfer.duplicate_entry",
  unsupported_mime: "customer_transfer.unsupported_mime",
  mime_mismatch: "customer_transfer.mime_mismatch",
  encrypted_archive: "customer_transfer.encrypted_archive",
  nested_archive: "customer_transfer.nested_archive",
  signature_invalid: "customer_transfer.signature_invalid",
  signature_missing: "customer_transfer.signature_missing",
  decryption_failed: "customer_transfer.decryption_failed",
  passphrase_required: "customer_transfer.passphrase_required",
  conflict: "customer_transfer.conflict",
  policy_required: "customer_transfer.policy_required",
  preview_stale: "customer_transfer.preview_stale",
  preview_expired: "customer_transfer.preview_expired",
  invalid_job_state: "customer_transfer.invalid_job_state",
  package_too_large: "customer_transfer.package_too_large",
  rate_limited: "customer_transfer.rate_limited",
  job_expired: "customer_transfer.job_expired",
  import_failed: "customer_transfer.import_failed",
  export_failed: "customer_transfer.export_failed",
  export_in_progress: "customer_transfer.export_in_progress",
  cleanup_failed: "customer_transfer.cleanup_failed",
  module_disabled: "customer_transfer.module_disabled",
} as const;

export type TransferErrorCode =
  (typeof TRANSFER_ERROR)[keyof typeof TRANSFER_ERROR];

export type TransferIssue = {
  code: TransferErrorCode;
  /** JSON-peker eller relativ sti. Aldri personopplysninger. */
  path: string;
  messageKey: string;
  /** Valgfri stabil detalj, f.eks. entitetstype. Aldri fritekst fra kunden. */
  detail?: string;
};

export type PolicyAction = "skip" | "new" | "update";

export type ConflictPolicies = {
  customer: PolicyAction;
  contact: PolicyAction;
  site: PolicyAction;
  equipment: PolicyAction;
  contract: PolicyAction;
  workOrder: PolicyAction;
  report: PolicyAction;
  document: PolicyAction;
  upload: PolicyAction;
  maintenancePlan: PolicyAction;
  meterReading: PolicyAction;
  category: PolicyAction;
  folder: PolicyAction;
};

export const DEFAULT_POLICIES: ConflictPolicies = {
  customer: "skip",
  contact: "skip",
  site: "skip",
  equipment: "skip",
  contract: "skip",
  workOrder: "skip",
  report: "skip",
  document: "skip",
  upload: "skip",
  maintenancePlan: "skip",
  meterReading: "skip",
  category: "skip",
  folder: "skip",
};

/** Entiteter der `update` er trygt og støttet i v1. */
export const UPDATE_ALLOWED: ReadonlySet<keyof ConflictPolicies> = new Set([
  "customer",
  "equipment",
]);

export function normalisePolicies(
  input: unknown,
): ConflictPolicies {
  const result = { ...DEFAULT_POLICIES };
  if (!input || typeof input !== "object") return result;
  for (const key of Object.keys(result) as Array<keyof ConflictPolicies>) {
    const value = (input as Record<string, unknown>)[key];
    if (value === "skip" || value === "new" || value === "update") {
      if (value === "update" && !UPDATE_ALLOWED.has(key)) continue;
      result[key] = value;
    }
  }
  return result;
}

export const TRANSFER_KIND = {
  export: "EXPORT",
  import: "IMPORT",
} as const;

export const TRANSFER_STATUS = {
  /** Venter på at eksportworkeren skal bygge pakken. */
  pending: "PENDING",
  /** Import er bekreftet og venter på at workeren skal anvende den. */
  queued: "QUEUED",
  /** Workeren eier jobben nå. En gammel RUNNING uten hjerteslag re-køes. */
  running: "RUNNING",
  staged: "STAGED",
  dryRun: "DRY_RUN",
  ready: "READY",
  completed: "COMPLETED",
  failed: "FAILED",
  aborted: "ABORTED",
  expired: "EXPIRED",
} as const;

/** Statusser der en jobb eier midlertidige filer eller en låst køplass. */
export const TRANSFER_ACTIVE_STATUSES = [
  TRANSFER_STATUS.pending,
  TRANSFER_STATUS.queued,
  TRANSFER_STATUS.running,
  TRANSFER_STATUS.staged,
  TRANSFER_STATUS.dryRun,
] as const;

/** Terminale statusser. Jobbraden beholdes etter retensjonspolicyen. */
export const TRANSFER_TERMINAL_STATUSES = [
  TRANSFER_STATUS.ready,
  TRANSFER_STATUS.completed,
  TRANSFER_STATUS.failed,
  TRANSFER_STATUS.aborted,
  TRANSFER_STATUS.expired,
] as const;

/** Datafilnavn → nøkkel i manifest.counts. Rekkefølgen er kanonisk. */
export const DATA_FILES = {
  customers: "customers",
  contacts: "contacts",
  portalUsers: "portal-users",
  portalDelegations: "portal-delegations",
  sites: "sites",
  equipmentCategories: "equipment-categories",
  products: "equipment",
  equipmentQrCodes: "equipment-qr-codes",
  meterReadings: "meter-readings",
  maintenancePlans: "maintenance-plans",
  maintenanceOccurrences: "maintenance-occurrences",
  contracts: "contracts",
  contractLines: "contract-lines",
  tags: "tags",
  workOrders: "work-orders",
  visits: "visits",
  visitTechnicians: "visit-technicians",
  comments: "comments",
  reports: "reports",
  reportUnits: "report-units",
  reportRevisions: "report-revisions",
  customerAttachments: "customer-attachments",
  attachments: "attachments",
  documents: "documents",
  documentVersions: "document-versions",
  documentFolders: "document-folders",
  documentTags: "document-tags",
  uploads: "uploads",
} as const;

export type DatasetKey = keyof typeof DATA_FILES;

/**
 * Datafiler som kan mangle i eldre pakker. Nye eksportpakker skriver dem alltid,
 * men importen skal fortsatt godta en pakke laget før filen fantes.
 */
export const OPTIONAL_DATA_FILES: ReadonlySet<DatasetKey> = new Set([
  "equipmentQrCodes",
]);

export const REFERENCE_FILES = {
  departments: "reference/departments",
  users: "reference/users",
  templates: "reference/templates",
  slaPolicies: "reference/sla-policies",
  priceLists: "reference/price-lists",
  priceListItems: "reference/price-list-items",
} as const;

export type ReferenceKey = keyof typeof REFERENCE_FILES;

export const README_TEXT = `FSM kundepakke – KONFIDENSIELL

Denne ZIP-filen inneholder personopplysninger, kundedata, servicehistorikk,
rapporter, dokumenter og vedlegg for én eller flere kunder.

- Pakken er et overførings-/migreringsverktøy, ikke en sikkerhetskopi.
- Den inneholder ALDRI passord, passordhasher, 2FA-hemmeligheter, sesjoner,
  API-nøkler eller andre innloggingshemmeligheter.
- Portalerbrukere importeres deaktivert og uten passord. De må inviteres eller
  tilbakestille passord i målinstallasjonen.
- Sjekksummene i checksums.sha256 oppdager korrupsjon. Når installasjonen har
  en signeringsnøkkel, ligger en HMAC-SHA256-signatur i manifest.sig og binder
  manifest og sjekksummer til nøkkelen. Uten nøkkel beviser ikke pakken hvem
  som lagde den.
- Rapporter kan inneholde helse-/HMS-opplysninger og signaturer. Signaturbilder
  er som standard ikke inkludert; PDF-en er den visuelle hovedkilden.
- Behandle filen som konfidensielt materiale, oppbevar den tilgangsbegrenset og
  slett den når overføringen er fullført.

Verifiser innholdet manuelt med:

  sha256sum -c checksums.sha256

Format: ${TRANSFER_FORMAT} schema ${TRANSFER_SCHEMA_VERSION}
`;
