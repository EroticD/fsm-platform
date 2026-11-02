// i18n-ignore-file: interne typer og stabile handlingstyper, ikke UI-tekst.
import type { DatasetKey, ReferenceKey, TransferIssue } from "./constants";

/** Én eksportert rad. `id` er alltid kildens id og brukes bare som referanse. */
export type TransferRow = { id: string } & Record<string, unknown>;

export type AuditSnapshotRow = {
  entityType: string;
  entityId: string;
  action: string;
  userName: string;
  actorId: string | null;
  departmentId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type TransferDataset = Record<DatasetKey, TransferRow[]> & {
  departments: TransferRow[];
  users: TransferRow[];
  templates: TransferRow[];
  slaPolicies: TransferRow[];
  priceLists: TransferRow[];
  priceListItems: TransferRow[];
  auditSnapshot: AuditSnapshotRow[];
};

export type TransferFileEntry = {
  path: string;
  sha256: string;
  size: number;
  mimeType: string;
  kind: string;
  originalName?: string;
  sourceUrl?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  references?: Array<{
    kind: string;
    sourceEntityType: string;
    sourceEntityId: string;
    originalName?: string;
  }>;
  data: Buffer;
};

export type ExportOptions = {
  customerIds: string[];
  includeFiles: boolean;
  includeDeleted: boolean;
  includeLegalHold: boolean;
  includeAudit: boolean;
  includeSignatures: boolean;
};

export type ImportOptions = {
  createMissingReferences: boolean;
  restoreDeleted: false;
};

export type AnalysisAction = "CREATE" | "SKIP" | "UPDATE" | "CONFLICT" | "INVALID";

export type EntityPlan = {
  type: string;
  sourceId: string;
  action: AnalysisAction;
  targetId?: string;
  reason?: string;
  /** Bare id-er og koder, aldri navn/e-post. */
  matchKey?: string;
};

export type ImportAnalysis = {
  entities: EntityPlan[];
  counts: Record<string, number>;
  warnings: TransferIssue[];
  errors: TransferIssue[];
  canImport: boolean;
  fingerprint: string;
  customers: Array<{
    sourceId: string;
    match: "NEW" | "EXISTING" | "CONFLICT";
    action: AnalysisAction;
    targetId?: string;
  }>;
};

export type ImportPreview = {
  jobId: string;
  package: {
    schemaVersion: string;
    sourceInstanceId: string;
    checksum: string;
    exportedAt: string;
    appVersion: string;
  };
  customers: ImportAnalysis["customers"];
  entities: EntityPlan[];
  counts: Record<string, number>;
  warnings: TransferIssue[];
  errors: TransferIssue[];
  canImport: boolean;
  previewToken?: string;
  expiresAt?: string;
};

export type PackageReadResult = {
  dataset: TransferDataset;
  files: Map<string, Buffer>;
  fileEntries: TransferFileEntry[];
  manifest: import("./manifest").TransferManifest;
  checksum: string;
  warnings: TransferIssue[];
  missingFiles: string[];
};

export type ReferenceMaps = {
  departments: Map<string, string>;
  users: Map<string, string>;
  templates: Map<string, string>;
  slaPolicies: Map<string, string>;
  priceLists: Map<string, string>;
  tags: Map<string, string>;
  documentTags: Map<string, string>;
  categories: Map<string, string>;
  folders: Map<string, string>;
};

export type ReferenceKeyType = ReferenceKey;
