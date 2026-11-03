// i18n-ignore-file: validering av pakkestruktur bruker stabile feilkoder.
import { readZip, sha256Hex, type ZipEntry } from "@/lib/zip";
import { sniffFileMime } from "@/lib/upload-validation";
import {
  ALLOWED_MIME_SET,
  DATA_FILES,
  MIME_EXTENSION,
  REFERENCE_FILES,
  TRANSFER_ERROR,
  TRANSFER_LIMITS,
  type DatasetKey,
  type TransferIssue,
} from "./constants";
import {
  contentAddressedPath,
  manifestSchema,
  parseChecksumsFile,
  supportedSchemaVersion,
} from "./manifest";
import type { PackageReadResult, TransferDataset, TransferRow } from "./types";

export type PackageReadOutcome =
  | { ok: true; result: PackageReadResult }
  | { ok: false; errors: TransferIssue[] };

function issue(
  code: TransferIssue["code"],
  path: string,
  messageKey: string,
  detail?: string,
): TransferIssue {
  return {
    code,
    path,
    messageKey,
    ...(detail ? { detail } : {}),
  };
}

function mapZipError(message: string): TransferIssue {
  if (message.includes("Krypterte")) {
    return issue(
      TRANSFER_ERROR.encrypted_archive,
      "package.zip",
      "errors.customerTransfer.encryptedArchive",
    );
  }
  if (message.includes("Duplikat")) {
    return issue(
      TRANSFER_ERROR.duplicate_entry,
      "package.zip",
      "errors.customerTransfer.duplicateEntry",
    );
  }
  if (message.includes("Kompresjonsforhold")) {
    return issue(
      TRANSFER_ERROR.compression_ratio,
      "package.zip",
      "errors.customerTransfer.compressionRatio",
    );
  }
  if (message.includes("Symlink")) {
    return issue(
      TRANSFER_ERROR.path_traversal,
      "package.zip",
      "errors.customerTransfer.symlink",
    );
  }
  if (message.includes("Utrygg filbane")) {
    return issue(
      TRANSFER_ERROR.path_traversal,
      "package.zip",
      "errors.customerTransfer.pathTraversal",
    );
  }
  if (message.includes("For mange")) {
    return issue(
      TRANSFER_ERROR.too_many_entries,
      "package.zip",
      "errors.customerTransfer.tooManyEntries",
    );
  }
  return issue(
    TRANSFER_ERROR.invalid_manifest,
    "package.zip",
    "errors.customerTransfer.invalidManifest",
  );
}

function rowArray(value: unknown): TransferRow[] | null {
  if (!Array.isArray(value)) return null;
  return value as TransferRow[];
}

function idsFor(rows: TransferRow[]): Set<string> {
  return new Set(rows.map((row) => String(row.id)));
}

function expectRef(
  errors: TransferIssue[],
  id: unknown,
  set: Set<string>,
  path: string,
): boolean {
  if (id === null || id === undefined || id === "") return true;
  if (typeof id !== "string" || !set.has(id)) {
    errors.push(
      issue(
        TRANSFER_ERROR.invalid_reference,
        path,
        "errors.customerTransfer.invalidReference",
      ),
    );
    return false;
  }
  return true;
}

function expectOptionalRef(
  errors: TransferIssue[],
  id: unknown,
  set: Set<string>,
  path: string,
) {
  return expectRef(errors, id, set, path);
}

function crossCustomer(
  errors: TransferIssue[],
  childCustomerId: unknown,
  parentCustomerId: unknown,
  path: string,
) {
  if (
    typeof childCustomerId === "string" &&
    typeof parentCustomerId === "string" &&
    childCustomerId !== parentCustomerId
  ) {
    errors.push(
      issue(
        TRANSFER_ERROR.cross_customer_reference,
        path,
        "errors.customerTransfer.crossCustomerReference",
      ),
    );
  }
}

/** Validerer referanser og eierskap. Returnerer stabile feilkoder, ikke PII. */
function validateReferences(
  dataset: TransferDataset,
  fileMap: Map<string, Buffer>,
  errors: TransferIssue[],
) {
  const customerIds = idsFor(dataset.customers);
  const contacts = idsFor(dataset.contacts);
  const sites = idsFor(dataset.sites);
  const categories = idsFor(dataset.equipmentCategories);
  const products = idsFor(dataset.products);
  const readings = idsFor(dataset.meterReadings);
  const plans = idsFor(dataset.maintenancePlans);
  const occurrences = idsFor(dataset.maintenanceOccurrences);
  const contracts = idsFor(dataset.contracts);
  const lines = idsFor(dataset.contractLines);
  const workOrders = idsFor(dataset.workOrders);
  const visits = idsFor(dataset.visits);
  const reports = idsFor(dataset.reports);
  const units = idsFor(dataset.reportUnits);
  const revisions = idsFor(dataset.reportRevisions);
  const documents = idsFor(dataset.documents);
  const documentVersions = idsFor(dataset.documentVersions);
  const folders = idsFor(dataset.documentFolders);
  const tags = idsFor(dataset.tags);
  const documentTags = idsFor(dataset.documentTags);
  const templates = idsFor(dataset.templates);
  const departments = idsFor(dataset.departments);
  const users = idsFor(dataset.users);
  const slaPolicies = idsFor(dataset.slaPolicies);
  const priceLists = idsFor(dataset.priceLists);
  const attachments = idsFor(dataset.attachments);
  const customerAttachments = idsFor(dataset.customerAttachments);
  const delegations = idsFor(dataset.portalDelegations);

  const productCustomer = new Map(
    dataset.products.map((row) => [String(row.id), row.customerId]),
  );
  const workOrderCustomer = new Map(
    dataset.workOrders.map((row) => [String(row.id), row.customerId]),
  );

  if (dataset.customers.length === 0) {
    errors.push(
      issue(
        TRANSFER_ERROR.invalid_data,
        "data/customers.json",
        "errors.customerTransfer.noCustomers",
      ),
    );
  }

  dataset.contacts.forEach((row, index) => {
    expectRef(errors, row.customerId, customerIds, `data/contacts.json[${index}].customerId`);
  });
  dataset.portalDelegations.forEach((row, index) => {
    expectRef(
      errors,
      row.contactId,
      contacts,
      `data/portal-delegations.json[${index}].contactId`,
    );
  });
  dataset.sites.forEach((row, index) => {
    expectRef(errors, row.customerId, customerIds, `data/sites.json[${index}].customerId`);
  });
  dataset.portalUsers.forEach((row, index) => {
    expectRef(
      errors,
      row.customerId,
      customerIds,
      `data/portal-users.json[${index}].customerId`,
    );
    expectOptionalRef(
      errors,
      row.contactId,
      contacts,
      `data/portal-users.json[${index}].contactId`,
    );
    if (row.role !== "CUSTOMER") {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          `data/portal-users.json[${index}].role`,
          "errors.customerTransfer.invalidPortalRole",
        ),
      );
    }
  });

  dataset.equipmentCategories.forEach((row, index) => {
    expectOptionalRef(
      errors,
      row.parentId,
      categories,
      `data/equipment-categories.json[${index}].parentId`,
    );
  });
  dataset.products.forEach((row, index) => {
    expectRef(
      errors,
      row.customerId,
      customerIds,
      `data/equipment.json[${index}].customerId`,
    );
    expectOptionalRef(errors, row.siteId, sites, `data/equipment.json[${index}].siteId`);
    expectOptionalRef(
      errors,
      row.categoryId,
      categories,
      `data/equipment.json[${index}].categoryId`,
    );
    expectOptionalRef(errors, row.parentId, products, `data/equipment.json[${index}].parentId`);
    if (row.parentId && row.parentId === row.id) {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_reference,
          `data/equipment.json[${index}].parentId`,
          "errors.customerTransfer.invalidReference",
        ),
      );
    }
    const parent = dataset.products.find((candidate) => candidate.id === row.parentId);
    if (parent) {
      crossCustomer(
        errors,
        row.customerId,
        parent.customerId,
        `data/equipment.json[${index}].parentId`,
      );
    }
  });

  const detectCycle = (
    rows: TransferRow[],
    label: string,
  ) => {
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    for (const row of rows) {
      const seen = new Set<string>();
      let current: TransferRow | undefined = row;
      let guard = 0;
      while (current && guard < rows.length + 1) {
        const id = String(current.id);
        if (seen.has(id)) {
          errors.push(
            issue(
              TRANSFER_ERROR.invalid_reference,
              `data/${label}.json#${row.id}`,
              "errors.customerTransfer.cycle",
            ),
          );
          break;
        }
        seen.add(id);
        current =
          typeof current.parentId === "string"
            ? byId.get(current.parentId)
            : undefined;
        guard += 1;
      }
    }
  };
  detectCycle(dataset.equipmentCategories, "equipment-categories");
  detectCycle(dataset.documentFolders, "document-folders");
  detectCycle(dataset.products, "equipment");

  dataset.meterReadings.forEach((row, index) => {
    expectRef(errors, row.productId, products, `data/meter-readings.json[${index}].productId`);
    expectOptionalRef(errors, row.visitId, visits, `data/meter-readings.json[${index}].visitId`);
    expectOptionalRef(errors, row.userId, users, `data/meter-readings.json[${index}].userId`);
  });
  dataset.maintenancePlans.forEach((row, index) => {
    expectRef(
      errors,
      row.customerId,
      customerIds,
      `data/maintenance-plans.json[${index}].customerId`,
    );
    expectOptionalRef(
      errors,
      row.productId,
      products,
      `data/maintenance-plans.json[${index}].productId`,
    );
    expectRef(
      errors,
      row.departmentId,
      departments,
      `data/maintenance-plans.json[${index}].departmentId`,
    );
    expectOptionalRef(
      errors,
      row.templateId,
      templates,
      `data/maintenance-plans.json[${index}].templateId`,
    );
  });
  dataset.maintenanceOccurrences.forEach((row, index) => {
    expectRef(
      errors,
      row.planId,
      plans,
      `data/maintenance-occurrences.json[${index}].planId`,
    );
    expectOptionalRef(
      errors,
      row.workOrderId,
      workOrders,
      `data/maintenance-occurrences.json[${index}].workOrderId`,
    );
  });

  dataset.contracts.forEach((row, index) => {
    expectRef(
      errors,
      row.customerId,
      customerIds,
      `data/contracts.json[${index}].customerId`,
    );
    expectRef(
      errors,
      row.departmentId,
      departments,
      `data/contracts.json[${index}].departmentId`,
    );
    expectOptionalRef(errors, row.contactId, contacts, `data/contracts.json[${index}].contactId`);
    expectOptionalRef(
      errors,
      row.templateId,
      templates,
      `data/contracts.json[${index}].templateId`,
    );
    expectOptionalRef(
      errors,
      row.slaPolicyId,
      slaPolicies,
      `data/contracts.json[${index}].slaPolicyId`,
    );
    expectOptionalRef(
      errors,
      row.priceListId,
      priceLists,
      `data/contracts.json[${index}].priceListId`,
    );
  });
  dataset.contractLines.forEach((row, index) => {
    expectRef(errors, row.contractId, contracts, `data/contract-lines.json[${index}].contractId`);
    expectOptionalRef(errors, row.productId, products, `data/contract-lines.json[${index}].productId`);
  });

  dataset.workOrders.forEach((row, index) => {
    expectRef(
      errors,
      row.customerId,
      customerIds,
      `data/work-orders.json[${index}].customerId`,
    );
    expectRef(
      errors,
      row.departmentId,
      departments,
      `data/work-orders.json[${index}].departmentId`,
    );
    expectOptionalRef(errors, row.siteId, sites, `data/work-orders.json[${index}].siteId`);
    expectOptionalRef(errors, row.productId, products, `data/work-orders.json[${index}].productId`);
    expectOptionalRef(errors, row.contactId, contacts, `data/work-orders.json[${index}].contactId`);
    expectOptionalRef(
      errors,
      row.contractId,
      contracts,
      `data/work-orders.json[${index}].contractId`,
    );
    for (const templateId of (row.templateIds as string[]) ?? []) {
      expectRef(errors, templateId, templates, `data/work-orders.json[${index}].templateIds`);
    }
    for (const tagId of (row.tagIds as string[]) ?? []) {
      expectRef(errors, tagId, tags, `data/work-orders.json[${index}].tagIds`);
    }
    for (const userId of (row.technicianIds as string[]) ?? []) {
      expectRef(errors, userId, users, `data/work-orders.json[${index}].technicianIds`);
    }
  });

  dataset.visits.forEach((row, index) => {
    expectRef(errors, row.workOrderId, workOrders, `data/visits.json[${index}].workOrderId`);
  });
  dataset.visitTechnicians.forEach((row, index) => {
    expectRef(errors, row.visitId, visits, `data/visit-technicians.json[${index}].visitId`);
    expectRef(errors, row.userId, users, `data/visit-technicians.json[${index}].userId`);
  });

  dataset.comments.forEach((row, index) => {
    expectOptionalRef(
      errors,
      row.workOrderId,
      workOrders,
      `data/comments.json[${index}].workOrderId`,
    );
    expectOptionalRef(
      errors,
      row.customerId,
      customerIds,
      `data/comments.json[${index}].customerId`,
    );
    expectOptionalRef(errors, row.contactId, contacts, `data/comments.json[${index}].contactId`);
  });

  dataset.reports.forEach((row, index) => {
    expectRef(errors, row.workOrderId, workOrders, `data/reports.json[${index}].workOrderId`);
    expectOptionalRef(errors, row.templateId, templates, `data/reports.json[${index}].templateId`);
  });
  dataset.reportUnits.forEach((row, index) => {
    expectRef(errors, row.reportId, reports, `data/report-units.json[${index}].reportId`);
    expectOptionalRef(errors, row.productId, products, `data/report-units.json[${index}].productId`);
  });
  dataset.reportRevisions.forEach((row, index) => {
    expectRef(errors, row.reportId, reports, `data/report-revisions.json[${index}].reportId`);
  });

  dataset.customerAttachments.forEach((row, index) => {
    expectRef(
      errors,
      row.customerId,
      customerIds,
      `data/customer-attachments.json[${index}].customerId`,
    );
  });
  dataset.attachments.forEach((row, index) => {
    expectRef(errors, row.workOrderId, workOrders, `data/attachments.json[${index}].workOrderId`);
  });

  dataset.documents.forEach((row, index) => {
    expectOptionalRef(
      errors,
      row.customerId,
      customerIds,
      `data/documents.json[${index}].customerId`,
    );
    expectOptionalRef(errors, row.productId, products, `data/documents.json[${index}].productId`);
    if (!row.customerId && !row.productId) {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          `data/documents.json[${index}].customerId`,
          "errors.customerTransfer.documentOwnerMissing",
        ),
      );
    }
    expectOptionalRef(
      errors,
      row.folderId,
      folders,
      `data/documents.json[${index}].folderId`,
    );
    for (const tagId of (row.tagIds as string[]) ?? []) {
      expectRef(errors, tagId, documentTags, `data/documents.json[${index}].tagIds`);
    }
    if (row.customerId && row.productId) {
      const productOwner = productCustomer.get(String(row.productId));
      crossCustomer(
        errors,
        row.customerId,
        productOwner,
        `data/documents.json[${index}].productId`,
      );
    }
  });
  dataset.documentVersions.forEach((row, index) => {
    expectRef(
      errors,
      row.documentId,
      documents,
      `data/document-versions.json[${index}].documentId`,
    );
  });
  dataset.documentFolders.forEach((row, index) => {
    expectOptionalRef(
      errors,
      row.parentId,
      folders,
      `data/document-folders.json[${index}].parentId`,
    );
  });

  dataset.uploads.forEach((row, index) => {
    const ownerType = row.ownerType;
    if (ownerType === "CUSTOMER") {
      expectRef(errors, row.ownerId, customerIds, `data/uploads.json[${index}].ownerId`);
    } else if (ownerType === "WORK_ORDER") {
      expectRef(errors, row.ownerId, workOrders, `data/uploads.json[${index}].ownerId`);
    } else if (ownerType === "EQUIPMENT") {
      expectRef(errors, row.ownerId, products, `data/uploads.json[${index}].ownerId`);
    } else if (ownerType === "CONTRACT") {
      expectRef(errors, row.ownerId, contracts, `data/uploads.json[${index}].ownerId`);
    } else if (ownerType === "DOCUMENT") {
      expectRef(errors, row.ownerId, documents, `data/uploads.json[${index}].ownerId`);
    } else {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          `data/uploads.json[${index}].ownerType`,
          "errors.customerTransfer.invalidUploadOwner",
        ),
      );
    }
    expectOptionalRef(
      errors,
      row.customerId,
      customerIds,
      `data/uploads.json[${index}].customerId`,
    );
    expectOptionalRef(
      errors,
      row.uploadedById,
      users,
      `data/uploads.json[${index}].uploadedById`,
    );
  });

  // Kryssjekk: rapportens arbeidsordre må tilhøre samme kunde som rapportens
  // enheter/vedlegg. Vi sammenligner bare id-er, aldri innhold.
  for (const report of dataset.reports) {
    const orderId = String(report.workOrderId);
    const customerId = workOrderCustomer.get(orderId);
    if (!customerId) continue;
    for (const unit of dataset.reportUnits) {
      if (unit.reportId !== report.id) continue;
      if (!unit.productId) continue;
      crossCustomer(
        errors,
        productCustomer.get(String(unit.productId)),
        customerId,
        `data/report-units.json#${unit.id}.productId`,
      );
    }
  }

  // Hver referert fil må finnes, og hver filreferanse må peke på en fil i
  // pakken. Manglende fil er en hard feil for full import.
  const validateFileRefs = (rows: TransferRow[], label: string, field = "packagePath") => {
    for (const row of rows) {
      const value = row[field];
      if (value === null || value === undefined) {
        if (row.fileState === "missing") {
          errors.push(
            issue(
              TRANSFER_ERROR.missing_file,
              `data/${label}.json#${row.id}.${field}`,
              "errors.customerTransfer.missingFile",
            ),
          );
        }
        continue;
      }
      if (typeof value !== "string" || !fileMap.has(value)) {
        errors.push(
          issue(
            TRANSFER_ERROR.missing_file,
            `data/${label}.json#${row.id}.${field}`,
            "errors.customerTransfer.missingFile",
          ),
        );
      }
    }
  };
  validateFileRefs(dataset.uploads, "uploads");
  validateFileRefs(dataset.documents, "documents");
  validateFileRefs(dataset.documentVersions, "document-versions");
  validateFileRefs(dataset.customerAttachments, "customer-attachments");
  validateFileRefs(dataset.attachments, "attachments");
  validateFileRefs(dataset.reports, "reports", "pdfFile");
  validateFileRefs(dataset.reports, "reports", "technicianSignatureFile");
  validateFileRefs(dataset.reports, "reports", "customerSignatureFile");
  validateFileRefs(dataset.reportRevisions, "report-revisions", "technicianSignatureFile");
  validateFileRefs(dataset.reportRevisions, "report-revisions", "customerSignatureFile");

  void readings;
  void occurrences;
  void lines;
  void units;
  void revisions;
  void documentVersions;
  void attachments;
  void customerAttachments;
  void delegations;
}

export function readPackage(buffer: Buffer): PackageReadOutcome {
  const errors: TransferIssue[] = [];
  const warnings: TransferIssue[] = [];

  if (buffer.length > TRANSFER_LIMITS.maxPackageBytes) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.package_too_large,
          "package.zip",
          "errors.customerTransfer.packageTooLarge",
        ),
      ],
    };
  }
  if (buffer.length === 0) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "package.zip",
          "errors.customerTransfer.invalidManifest",
        ),
      ],
    };
  }

  let entries: ZipEntry[];
  try {
    entries = readZip(buffer);
  } catch (error) {
    return {
      ok: false,
      errors: [mapZipError(error instanceof Error ? error.message : "")],
    };
  }

  if (entries.length === 0) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "package.zip",
          "errors.customerTransfer.invalidManifest",
        ),
      ],
    };
  }
  if (entries.length > TRANSFER_LIMITS.maxEntries) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.too_many_entries,
          "package.zip",
          "errors.customerTransfer.tooManyEntries",
        ),
      ],
    };
  }

  for (const entry of entries) {
    if (entry.path.length > TRANSFER_LIMITS.maxPathLength) {
      return {
        ok: false,
        errors: [
          issue(
            TRANSFER_ERROR.path_traversal,
            "package.zip",
            "errors.customerTransfer.pathTraversal",
          ),
        ],
      };
    }
  }
  const entryMap = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntries = entries.filter((entry) => entry.path === "manifest.json");
  if (manifestEntries.length !== 1) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "manifest.json",
          "errors.customerTransfer.invalidManifest",
        ),
      ],
    };
  }
  const manifestEntry = manifestEntries[0];
  if (manifestEntry.data.length > TRANSFER_LIMITS.maxJsonBytes) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.file_too_large,
          "manifest.json",
          "errors.customerTransfer.fileTooLarge",
        ),
      ],
    };
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "manifest.json",
          "errors.customerTransfer.invalidManifest",
        ),
      ],
    };
  }
  const parsed = manifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "manifest.json",
          "errors.customerTransfer.invalidManifest",
        ),
      ],
    };
  }
  const manifest = parsed.data;
  const knownManifestKeys = new Set([
    "format",
    "schemaVersion",
    "exportedAt",
    "source",
    "scope",
    "counts",
    "files",
    "checksums",
    "totals",
  ]);
  if (manifestJson && typeof manifestJson === "object") {
    for (const key of Object.keys(manifestJson)) {
      if (!knownManifestKeys.has(key)) {
        warnings.push(
          issue(
            TRANSFER_ERROR.invalid_data,
            `manifest.json.${key}`,
            "errors.customerTransfer.unknownEntry",
            "warning",
          ),
        );
      }
    }
  }
  if (!supportedSchemaVersion(manifest.schemaVersion)) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.unsupported_schema,
          "manifest.json.schemaVersion",
          "errors.customerTransfer.unsupportedSchema",
        ),
      ],
    };
  }
  if (!manifest.scope.includeFiles) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "manifest.json.scope.includeFiles",
          "errors.customerTransfer.filesRequired",
        ),
      ],
    };
  }

  const checksumEntry = entryMap.get("checksums.sha256");
  if (!checksumEntry) {
    return {
      ok: false,
      errors: [
        issue(
          TRANSFER_ERROR.invalid_manifest,
          "checksums.sha256",
          "errors.customerTransfer.invalidManifest",
        ),
      ],
    };
  }
  const listedChecksums = parseChecksumsFile(checksumEntry.data.toString("utf8"));
  const manifestChecksums = new Map(Object.entries(manifest.checksums));
  for (const [path, checksum] of manifestChecksums) {
    if (listedChecksums.get(path) !== checksum) {
      errors.push(
        issue(
          TRANSFER_ERROR.checksum_mismatch,
          `checksums.sha256#${path}`,
          "errors.customerTransfer.checksumMismatch",
        ),
      );
    }
  }
  for (const path of listedChecksums.keys()) {
    if (!manifestChecksums.has(path)) {
      errors.push(
        issue(
          TRANSFER_ERROR.checksum_mismatch,
          `checksums.sha256#${path}`,
          "errors.customerTransfer.checksumMismatch",
        ),
      );
    }
  }

  const dataset = {
    ...Object.fromEntries(
      (Object.keys(DATA_FILES) as DatasetKey[]).map((key) => [key, []]),
    ),
    departments: [],
    users: [],
    templates: [],
    slaPolicies: [],
    priceLists: [],
    priceListItems: [],
    auditSnapshot: [],
  } as unknown as TransferDataset;

  const expectedDataFiles = new Set<string>();
  for (const key of Object.keys(DATA_FILES) as DatasetKey[]) {
    expectedDataFiles.add(`data/${DATA_FILES[key]}.json`);
  }
  for (const key of Object.keys(REFERENCE_FILES) as Array<keyof typeof REFERENCE_FILES>) {
    expectedDataFiles.add(`data/${REFERENCE_FILES[key]}.json`);
  }
  if (manifest.scope.includeAudit) expectedDataFiles.add("data/audit-snapshot.json");

  const datasetFileKey = new Map<string, string>();
  for (const key of Object.keys(DATA_FILES) as DatasetKey[]) {
    datasetFileKey.set(`data/${DATA_FILES[key]}.json`, key);
  }
  for (const key of Object.keys(REFERENCE_FILES) as Array<keyof typeof REFERENCE_FILES>) {
    datasetFileKey.set(`data/${REFERENCE_FILES[key]}.json`, key);
  }
  datasetFileKey.set("data/audit-snapshot.json", "auditSnapshot");

  for (const filePath of expectedDataFiles) {
    const entry = entryMap.get(filePath);
    if (!entry) {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          filePath,
          "errors.customerTransfer.missingDataFile",
        ),
      );
      continue;
    }
    if (entry.data.length > TRANSFER_LIMITS.maxJsonBytes) {
      errors.push(
        issue(
          TRANSFER_ERROR.file_too_large,
          filePath,
          "errors.customerTransfer.fileTooLarge",
        ),
      );
      continue;
    }
    const expected = manifest.checksums[filePath];
    const actual = sha256Hex(entry.data);
    if (!expected || expected !== actual) {
      errors.push(
        issue(
          TRANSFER_ERROR.checksum_mismatch,
          filePath,
          "errors.customerTransfer.checksumMismatch",
        ),
      );
      continue;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(entry.data.toString("utf8"));
    } catch {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          filePath,
          "errors.customerTransfer.invalidData",
        ),
      );
      continue;
    }
    if (!Array.isArray(decoded)) {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          filePath,
          "errors.customerTransfer.invalidData",
        ),
      );
      continue;
    }
    const key = datasetFileKey.get(filePath);
    if (!key) continue;
    if (key === "auditSnapshot") {
      dataset.auditSnapshot = decoded as TransferDataset["auditSnapshot"];
      continue;
    }
    const rows = rowArray(decoded);
    if (!rows) {
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          filePath,
          "errors.customerTransfer.invalidData",
        ),
      );
      continue;
    }
    const expectedCount = manifest.counts[key];
    const isReferenceFile = Object.hasOwn(REFERENCE_FILES, key);
    if (!isReferenceFile && expectedCount !== rows.length) {
      errors.push(
        issue(
          TRANSFER_ERROR.count_mismatch,
          `${filePath}#count`,
          "errors.customerTransfer.countMismatch",
        ),
      );
    }
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id) {
        errors.push(
          issue(
            TRANSFER_ERROR.invalid_data,
            `${filePath}[${index}].id`,
            "errors.customerTransfer.invalidData",
          ),
        );
        return;
      }
      if (seen.has(row.id)) {
        errors.push(
          issue(
            TRANSFER_ERROR.duplicate_source_id,
            `${filePath}[${index}].id`,
            "errors.customerTransfer.duplicateSourceId",
          ),
        );
      }
      seen.add(row.id);
    });
    (dataset as unknown as Record<string, TransferRow[]>)[key] = rows;
  }

  for (const [path] of entryMap) {
    if (
      path.startsWith("data/") &&
      !expectedDataFiles.has(path) &&
      path !== "data/import-map.json"
    ) {
      warnings.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          path,
          "errors.customerTransfer.unknownDataFile",
          "warning",
        ),
      );
      continue;
    }
    const knownTopLevel =
      path === "manifest.json" ||
      path === "checksums.sha256" ||
      path === "README.txt" ||
      path === "manifest.sig" ||
      path.startsWith("data/") ||
      path.startsWith("files/") ||
      path.startsWith("provenance/");
    if (!knownTopLevel) {
      warnings.push(
        issue(
          TRANSFER_ERROR.invalid_data,
          path,
          "errors.customerTransfer.unknownEntry",
          "warning",
        ),
      );
    }
  }

  const fileMap = new Map<string, Buffer>();
  const fileEntries = [];
  const totalCompressed = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.compressedSize),
    0,
  );
  const totalUncompressed = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  if (
    totalCompressed > 0 &&
    totalUncompressed / totalCompressed > TRANSFER_LIMITS.maxCompressionRatio
  ) {
    errors.push(
      issue(
        TRANSFER_ERROR.compression_ratio,
        "package.zip",
        "errors.customerTransfer.compressionRatio",
      ),
    );
  }

  for (const file of manifest.files) {
    const entry = entryMap.get(file.path);
    if (!entry) {
      errors.push(
        issue(
          TRANSFER_ERROR.missing_file,
          file.path,
          "errors.customerTransfer.missingFile",
        ),
      );
      continue;
    }
    if (
      entry.data.length !== file.size ||
      sha256Hex(entry.data) !== file.sha256 ||
      file.path !== contentAddressedPath(file.sha256, MIME_EXTENSION[file.mimeType] ?? "bin")
    ) {
      errors.push(
        issue(
          TRANSFER_ERROR.checksum_mismatch,
          file.path,
          "errors.customerTransfer.checksumMismatch",
        ),
      );
      continue;
    }
    if (file.size > TRANSFER_LIMITS.maxFileBytes) {
      errors.push(
        issue(
          TRANSFER_ERROR.file_too_large,
          file.path,
          "errors.customerTransfer.fileTooLarge",
        ),
      );
      continue;
    }
    const sniffed = sniffFileMime(entry.data);
    if (!sniffed || !ALLOWED_MIME_SET.has(sniffed)) {
      errors.push(
        issue(
          TRANSFER_ERROR.unsupported_mime,
          file.path,
          "errors.customerTransfer.unsupportedMime",
        ),
      );
      continue;
    }
    if (sniffed !== file.mimeType) {
      errors.push(
        issue(
          TRANSFER_ERROR.mime_mismatch,
          file.path,
          "errors.customerTransfer.mimeMismatch",
        ),
      );
      continue;
    }
    fileMap.set(file.path, entry.data);
    fileEntries.push({ ...file, data: entry.data });
  }

  for (const [path, entry] of entryMap) {
    if (!path.startsWith("files/")) continue;
    if (!manifest.files.some((file) => file.path === path)) {
      errors.push(
        issue(
          TRANSFER_ERROR.checksum_mismatch,
          path,
          "errors.customerTransfer.unreferencedFile",
        ),
      );
    }
    // Nestet arkiv avvises uansett MIME; denne sjekken gir en tydelig kode.
    if (
      entry.data.length >= 4 &&
      entry.data[0] === 0x50 &&
      entry.data[1] === 0x4b &&
      entry.data[2] === 0x03 &&
      entry.data[3] === 0x04
    ) {
      errors.push(
        issue(
          TRANSFER_ERROR.nested_archive,
          path,
          "errors.customerTransfer.nestedArchive",
        ),
      );
    }
  }

  if (manifest.counts.files !== manifest.files.length) {
    errors.push(
      issue(
        TRANSFER_ERROR.count_mismatch,
        "manifest.json.counts.files",
        "errors.customerTransfer.countMismatch",
      ),
    );
  }

  validateReferences(dataset, fileMap, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const missingFiles: string[] = [];
  for (const row of dataset.uploads) {
    if (row.fileState === "missing") missingFiles.push(`uploads:${row.id}`);
  }
  for (const row of dataset.documents) {
    if (row.fileState === "missing") missingFiles.push(`documents:${row.id}`);
  }

  return {
    ok: true,
    result: {
      dataset,
      files: fileMap,
      fileEntries,
      manifest,
      checksum: sha256Hex(buffer),
      warnings,
      missingFiles,
    },
  };
}

export { idsFor };
