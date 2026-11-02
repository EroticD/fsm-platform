// i18n-ignore-file: eksporten bygger tekniske datafiler og advarselskoder.
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";
import { sniffFileMime } from "@/lib/upload-validation";
import { sha256Hex } from "@/lib/zip";
import {
  ALLOWED_MIME_SET,
  MIME_EXTENSION,
  TRANSFER_LIMITS,
  type TransferIssue,
} from "./constants";
import { contentAddressedPath } from "./manifest";
import { compareById } from "./normalise";
import type {
  ExportOptions,
  TransferDataset,
  TransferFileEntry,
  TransferRow,
} from "./types";

const UPLOAD_URL = /^\/uploads\/([A-Za-z0-9._-]+)$/;

export type CollectedFile = {
  sha256: string;
  data: Buffer;
  mimeType: string;
  extension: string;
  kind: string;
  originalName?: string;
  sourceUrl?: string;
  references: Array<{
    kind: string;
    sourceEntityType: string;
    sourceEntityId: string;
    originalName?: string;
  }>;
};

export type FileCollector = {
  files: Map<string, CollectedFile>;
  warnings: TransferIssue[];
  addBuffer(input: {
    data: Buffer;
    declaredMime?: string | null;
    kind: string;
    sourceEntityType: string;
    sourceEntityId: string;
    originalName?: string | null;
    sourceUrl?: string | null;
  }): string | null;
  addStoredName(input: {
    storedName: string;
    kind: string;
    sourceEntityType: string;
    sourceEntityId: string;
    originalName?: string | null;
    declaredMime?: string | null;
  }): Promise<{ packagePath: string | null; state: "ok" | "missing" | "too_large" }>;
  addUrl(input: {
    url: string;
    kind: string;
    sourceEntityType: string;
    sourceEntityId: string;
    originalName?: string | null;
    declaredMime?: string | null;
  }): Promise<{ packagePath: string | null; state: "ok" | "missing" | "too_large" | "external" }>;
};

function extensionFor(mime: string): string {
  return MIME_EXTENSION[mime] ?? "bin";
}

export function createFileCollector(): FileCollector {
  const files = new Map<string, CollectedFile>();
  const warnings: TransferIssue[] = [];

  function addBuffer(input: Parameters<FileCollector["addBuffer"]>[0]) {
    if (input.data.length > TRANSFER_LIMITS.maxFileBytes) {
      warnings.push({
        code: "customer_transfer.file_too_large",
        path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
        messageKey: "errors.customerTransfer.fileTooLarge",
        detail: input.kind,
      });
      return null;
    }
    const actual = sniffFileMime(input.data);
    if (!actual || !ALLOWED_MIME_SET.has(actual)) {
      warnings.push({
        code: "customer_transfer.unsupported_mime",
        path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
        messageKey: "errors.customerTransfer.unsupportedMime",
        detail: input.kind,
      });
      return null;
    }
    if (
      input.declaredMime &&
      input.declaredMime !== actual &&
      input.declaredMime !== "application/octet-stream"
    ) {
      warnings.push({
        code: "customer_transfer.mime_mismatch",
        path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
        messageKey: "errors.customerTransfer.mimeMismatch",
        detail: input.kind,
      });
      return null;
    }
    const sha256 = sha256Hex(input.data);
    const existing = files.get(sha256);
    if (existing) {
      if (
        !existing.references.some(
          (reference) =>
            reference.sourceEntityType === input.sourceEntityType &&
            reference.sourceEntityId === input.sourceEntityId &&
            reference.kind === input.kind,
        )
      ) {
        existing.references.push({
          kind: input.kind,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          ...(input.originalName ? { originalName: input.originalName } : {}),
        });
      }
      return contentAddressedPath(sha256, existing.extension);
    }
    const entry: CollectedFile = {
      sha256,
      data: input.data,
      mimeType: actual,
      extension: extensionFor(actual),
      kind: input.kind,
      references: [
        {
          kind: input.kind,
          sourceEntityType: input.sourceEntityType,
          sourceEntityId: input.sourceEntityId,
          ...(input.originalName ? { originalName: input.originalName } : {}),
        },
      ],
    };
    if (input.originalName) entry.originalName = input.originalName;
    if (input.sourceUrl) entry.sourceUrl = input.sourceUrl;
    files.set(sha256, entry);
    return contentAddressedPath(sha256, entry.extension);
  }

  async function readStoredName(storedName: string) {
    if (
      !storedName ||
      storedName.length > TRANSFER_LIMITS.maxPathLength ||
      storedName.includes("/") ||
      storedName.includes("\\") ||
      storedName.includes("\u0000") ||
      storedName === "." ||
      storedName === ".."
    ) {
      return null;
    }
    const root = path.resolve(uploadDir());
    const target = path.resolve(root, storedName);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) return null;
      if (stat.size > TRANSFER_LIMITS.maxFileBytes) return "too_large" as const;
      return await fs.readFile(target);
    } catch {
      return null;
    }
  }

  async function addStoredName(
    input: Parameters<FileCollector["addStoredName"]>[0],
  ) {
    const data = await readStoredName(input.storedName);
    if (data === "too_large") {
      warnings.push({
        code: "customer_transfer.file_too_large",
        path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
        messageKey: "errors.customerTransfer.fileTooLarge",
        detail: input.kind,
      });
      return { packagePath: null, state: "too_large" as const };
    }
    if (!data) {
      warnings.push({
        code: "customer_transfer.missing_file",
        path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
        messageKey: "errors.customerTransfer.missingFile",
        detail: input.kind,
      });
      return { packagePath: null, state: "missing" as const };
    }
    const packagePath = addBuffer({
      data,
      declaredMime: input.declaredMime,
      kind: input.kind,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      originalName: input.originalName,
    });
    return {
      packagePath,
      state: packagePath ? ("ok" as const) : ("missing" as const),
    };
  }

  async function addUrl(input: Parameters<FileCollector["addUrl"]>[0]) {
    const url = input.url.trim();
    if (url.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
      if (!match) {
        warnings.push({
          code: "customer_transfer.unsupported_mime",
          path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
          messageKey: "errors.customerTransfer.unsupportedMime",
          detail: input.kind,
        });
        return { packagePath: null, state: "missing" as const };
      }
      const data = Buffer.from(match[2], "base64");
      const packagePath = addBuffer({
        data,
        declaredMime: input.declaredMime ?? match[1],
        kind: input.kind,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        originalName: input.originalName,
      });
      return {
        packagePath,
        state: packagePath ? ("ok" as const) : ("missing" as const),
      };
    }
    const match = UPLOAD_URL.exec(url);
    if (match) {
      return addStoredName({
        storedName: match[1],
        kind: input.kind,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        originalName: input.originalName,
        declaredMime: input.declaredMime,
      });
    }
    // Eksterne URL-er hentes aldri under eksport (SSRF). De beholdes som
    // metadata i klientraden og markeres «external_unfetched» der.
    warnings.push({
      code: "customer_transfer.missing_file",
      path: `files/${input.sourceEntityType}/${input.sourceEntityId}`,
      messageKey: "errors.customerTransfer.externalFileNotFetched",
      detail: input.kind,
    });
    return { packagePath: null, state: "external" as const };
  }

  return { files, warnings, addBuffer, addStoredName, addUrl };
}

export type BuiltExportData = {
  dataset: TransferDataset;
  files: TransferFileEntry[];
  warnings: TransferIssue[];
  customerIds: string[];
  customerNamesForAudit: Array<{ id: string; name: string }>;
};

async function collectCategoryClosure(
  categoryIds: Set<string>,
): Promise<TransferRow[]> {
  if (categoryIds.size === 0) return [];
  const all = await prisma.equipmentCategory.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(all.map((category) => [category.id, category]));
  const included = new Set<string>();
  for (const id of categoryIds) {
    let current = byId.get(id);
    let guard = 0;
    while (current && guard < 64) {
      included.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
  }
  // Ta med hele undertreet under de refererte kategoriene, slik at
  // kategoritreet kan gjenopprettes uten å gjette foreldre.
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of all) {
      if (
        category.parentId &&
        included.has(category.parentId) &&
        !included.has(category.id)
      ) {
        included.add(category.id);
        changed = true;
      }
    }
  }
  return all
    .filter((category) => included.has(category.id))
    .map((category) => ({ ...category }) as TransferRow)
    .sort(compareById);
}

async function collectFolderClosure(
  folderIds: Set<string>,
): Promise<TransferRow[]> {
  if (folderIds.size === 0) return [];
  const all = await prisma.documentFolder.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(all.map((folder) => [folder.id, folder]));
  const included = new Set<string>();
  for (const id of folderIds) {
    let current = byId.get(id);
    let guard = 0;
    while (current && guard < 64) {
      included.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
  }
  return all
    .filter((folder) => included.has(folder.id))
    .map((folder) => ({ ...folder }) as TransferRow)
    .sort(compareById);
}

/**
 * Bygger hele datasettet for valgte kunder. Alle spørringer er begrenset til
 * kundens egne rader; globale dokumenter uten `customerId`/`productId` tas
 * aldri med.
 */
export async function collectExportDataset(
  options: ExportOptions,
): Promise<BuiltExportData> {
  const requested = [...new Set(options.customerIds)].slice(
    0,
    TRANSFER_LIMITS.maxCustomers,
  );
  if (requested.length === 0) {
    return {
      dataset: emptyDataset(),
      files: [],
      warnings: [],
      customerIds: [],
      customerNamesForAudit: [],
    };
  }

  const customers = await prisma.customer.findMany({
    where: {
      id: { in: requested },
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
  });
  const customerIds = customers.map((customer) => customer.id);
  if (customerIds.length === 0) {
    return {
      dataset: emptyDataset(),
      files: [],
      warnings: [],
      customerIds: [],
      customerNamesForAudit: [],
    };
  }

  const contacts = await prisma.contact.findMany({
    where: { customerId: { in: customerIds } },
  });
  const contactIds = contacts.map((contact) => contact.id);
  const sites = await prisma.customerSite.findMany({
    where: { customerId: { in: customerIds } },
  });
  const delegations = await prisma.portalDelegation.findMany({
    where: { contactId: { in: contactIds } },
  });
  const portalUsers = await prisma.user.findMany({
    where: { customerId: { in: customerIds }, role: "CUSTOMER" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      customerId: true,
      contactId: true,
      isActive: true,
      locale: true,
      emailVerified: true,
    },
  });

  const products = await prisma.product.findMany({
    where: { customerId: { in: customerIds } },
  });
  const productIds = products.map((product) => product.id);
  const categoryIds = new Set(
    products
      .map((product) => product.categoryId)
      .filter((value): value is string => Boolean(value)),
  );
  const equipmentCategories = await collectCategoryClosure(categoryIds);

  const meterReadings = await prisma.meterReading.findMany({
    where: { productId: { in: productIds } },
  });
  const maintenancePlans = await prisma.maintenancePlan.findMany({
    where: { customerId: { in: customerIds } },
  });
  const planIds = maintenancePlans.map((plan) => plan.id);
  const maintenanceOccurrences = await prisma.maintenancePlanOccurrence.findMany({
    where: { planId: { in: planIds } },
  });

  const contracts = await prisma.contract.findMany({
    where: { customerId: { in: customerIds } },
  });
  const contractIds = contracts.map((contract) => contract.id);
  const contractLines = await prisma.contractLine.findMany({
    where: { contractId: { in: contractIds } },
  });

  const workOrders = await prisma.workOrder.findMany({
    where: {
      customerId: { in: customerIds },
      ...(options.includeDeleted ? {} : { deletedAt: null }),
      ...(options.includeLegalHold ? {} : { legalHold: false }),
    },
    include: {
      templates: { select: { id: true } },
      tags: { select: { id: true } },
      technicians: { select: { id: true } },
    },
  });
  const workOrderIds = workOrders.map((order) => order.id);

  const visits = await prisma.visit.findMany({
    where: { workOrderId: { in: workOrderIds } },
  });
  const visitIds = visits.map((visit) => visit.id);
  const visitTechnicians = await prisma.visitTechnician.findMany({
    where: { visitId: { in: visitIds } },
  });

  const comments = await prisma.comment.findMany({
    where: {
      OR: [
        { customerId: { in: customerIds } },
        { workOrderId: { in: workOrderIds } },
      ],
    },
  });

  const reports = await prisma.report.findMany({
    where: {
      workOrderId: { in: workOrderIds },
      ...(options.includeDeleted ? {} : { deletedAt: null }),
      ...(options.includeLegalHold ? {} : { legalHold: false }),
    },
  });
  const reportIds = reports.map((report) => report.id);
  const reportUnits = await prisma.reportUnit.findMany({
    where: { reportId: { in: reportIds } },
  });
  const reportRevisions = await prisma.reportRevision.findMany({
    where: { reportId: { in: reportIds } },
  });

  const customerAttachments = await prisma.customerAttachment.findMany({
    where: { customerId: { in: customerIds } },
  });
  const attachments = await prisma.attachment.findMany({
    where: { workOrderId: { in: workOrderIds } },
  });

  const uploads = await prisma.upload.findMany({
    where: {
      OR: [
        { ownerType: "CUSTOMER", ownerId: { in: customerIds } },
        { ownerType: "WORK_ORDER", ownerId: { in: workOrderIds } },
        { ownerType: "EQUIPMENT", ownerId: { in: productIds } },
        { ownerType: "CONTRACT", ownerId: { in: contractIds } },
      ],
    },
  });

  const documents = await prisma.document.findMany({
    where: {
      OR: [
        { customerId: { in: customerIds } },
        { productId: { in: productIds } },
      ],
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
    include: { tags: { select: { id: true } } },
  });
  const documentIds = documents.map((document) => document.id);
  const documentVersions = await prisma.documentVersion.findMany({
    where: { documentId: { in: documentIds } },
  });
  const folderIds = new Set(
    documents
      .map((document) => document.folderId)
      .filter((value): value is string => Boolean(value)),
  );
  const documentFolders = await collectFolderClosure(folderIds);
  const documentTagIds = new Set(
    documents.flatMap((document) => document.tags.map((tag) => tag.id)),
  );
  const documentTags =
    documentTagIds.size > 0
      ? await prisma.documentTag.findMany({
          where: { id: { in: [...documentTagIds] } },
        })
      : [];

  const tagIds = new Set(workOrders.flatMap((order) => order.tags.map((tag) => tag.id)));
  const tags =
    tagIds.size > 0
      ? await prisma.tag.findMany({ where: { id: { in: [...tagIds] } } })
      : [];

  const templateIds = new Set<string>();
  for (const contract of contracts) if (contract.templateId) templateIds.add(contract.templateId);
  for (const plan of maintenancePlans) if (plan.templateId) templateIds.add(plan.templateId);
  for (const report of reports) if (report.templateId) templateIds.add(report.templateId);
  for (const order of workOrders) for (const template of order.templates) templateIds.add(template.id);
  const templates =
    templateIds.size > 0
      ? await prisma.template.findMany({ where: { id: { in: [...templateIds] } } })
      : [];

  const slaPolicyIds = new Set(
    contracts
      .map((contract) => contract.slaPolicyId)
      .filter((value): value is string => Boolean(value)),
  );
  const slaPolicies =
    slaPolicyIds.size > 0
      ? await prisma.slaPolicy.findMany({ where: { id: { in: [...slaPolicyIds] } } })
      : [];
  const priceListIds = new Set(
    contracts
      .map((contract) => contract.priceListId)
      .filter((value): value is string => Boolean(value)),
  );
  const priceLists =
    priceListIds.size > 0
      ? await prisma.priceList.findMany({ where: { id: { in: [...priceListIds] } } })
      : [];
  const priceListItems =
    priceLists.length > 0
      ? await prisma.priceListItem.findMany({
          where: { priceListId: { in: priceLists.map((list) => list.id) } },
        })
      : [];

  const departmentIds = new Set<string>();
  for (const customer of customers) if (customer.departmentId) departmentIds.add(customer.departmentId);
  for (const contract of contracts) departmentIds.add(contract.departmentId);
  for (const plan of maintenancePlans) departmentIds.add(plan.departmentId);
  for (const order of workOrders) departmentIds.add(order.departmentId);
  for (const upload of uploads) if (upload.departmentId) departmentIds.add(upload.departmentId);
  const departments =
    departmentIds.size > 0
      ? await prisma.department.findMany({ where: { id: { in: [...departmentIds] } } })
      : [];

  const userIds = new Set<string>();
  for (const customer of customers) if (customer.responsibleTechnicianId) userIds.add(customer.responsibleTechnicianId);
  for (const reading of meterReadings) if (reading.userId) userIds.add(reading.userId);
  for (const link of visitTechnicians) userIds.add(link.userId);
  for (const order of workOrders) for (const user of order.technicians) userIds.add(user.id);
  for (const upload of uploads) if (upload.uploadedById) userIds.add(upload.uploadedById);
  for (const revision of reportRevisions) if (revision.createdById) userIds.add(revision.createdById);
  const users =
    userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
          },
        })
      : [];

  const collector = createFileCollector();
  const warnings: TransferIssue[] = [];

  const customerRows = [];
  for (const customer of customers) {
    let logoFile: string | null = null;
    let logoState: string | null = null;
    if (customer.logoUrl) {
      if (options.includeFiles) {
        const result = await collector.addUrl({
          url: customer.logoUrl,
          kind: "CUSTOMER_LOGO",
          sourceEntityType: "Customer",
          sourceEntityId: customer.id,
          originalName: "logo",
        });
        logoFile = result.packagePath;
        logoState = result.state === "ok" ? "ok" : result.state;
      } else {
        logoState = "excluded";
      }
    }
    customerRows.push({
      id: customer.id,
      name: customer.name,
      customerNumber: customer.customerNumber,
      orgNumber: customer.orgNumber,
      brandColor: customer.brandColor,
      logoUrl: customer.logoUrl,
      logoFile,
      logoState,
      address: customer.address,
      postalCode: customer.postalCode,
      city: customer.city,
      phone: customer.phone,
      email: customer.email,
      notes: customer.notes,
      departmentId: customer.departmentId,
      responsibleTechnicianId: customer.responsibleTechnicianId,
      deletedAt: customer.deletedAt,
      deletedBy: customer.deletedBy,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    });
  }

  const uploadRows = [];
  for (const upload of uploads) {
    let packagePath: string | null = null;
    let fileState = "excluded";
    if (options.includeFiles) {
      const result = await collector.addStoredName({
        storedName: upload.storedName,
        kind: upload.ownerType,
        sourceEntityType: "Upload",
        sourceEntityId: upload.id,
        originalName: upload.originalName,
        declaredMime: upload.mimeType,
      });
      packagePath = result.packagePath;
      fileState = result.state;
    }
    uploadRows.push({
      id: upload.id,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.size,
      ownerType: upload.ownerType,
      ownerId: upload.ownerId,
      departmentId: upload.departmentId,
      customerId: upload.customerId,
      uploadedById: upload.uploadedById,
      contentHash: upload.contentHash,
      createdAt: upload.createdAt,
      packagePath,
      fileState,
    });
  }

  const customerAttachmentRows = [];
  for (const attachment of customerAttachments) {
    let packagePath: string | null = null;
    let fileState = "excluded";
    let mimeType: string | null = null;
    if (options.includeFiles) {
      const result = await collector.addUrl({
        url: attachment.dataUrl,
        kind: "CUSTOMER_ATTACHMENT",
        sourceEntityType: "CustomerAttachment",
        sourceEntityId: attachment.id,
        originalName: attachment.fileName,
      });
      packagePath = result.packagePath;
      fileState = result.state;
      if (packagePath) {
        const found = [...collector.files.values()].find(
          (file) => contentAddressedPath(file.sha256, file.extension) === packagePath,
        );
        mimeType = found?.mimeType ?? null;
      }
    }
    customerAttachmentRows.push({
      id: attachment.id,
      fileName: attachment.fileName,
      customerId: attachment.customerId,
      createdAt: attachment.createdAt,
      packagePath,
      fileState,
      mimeType,
    });
  }

  const attachmentRows = [];
  for (const attachment of attachments) {
    let packagePath: string | null = null;
    let fileState = "excluded";
    let mimeType: string | null = null;
    if (options.includeFiles) {
      const result = await collector.addUrl({
        url: attachment.dataUrl,
        kind: "WORK_ORDER_ATTACHMENT",
        sourceEntityType: "Attachment",
        sourceEntityId: attachment.id,
        originalName: attachment.fileName,
      });
      packagePath = result.packagePath;
      fileState = result.state;
      if (packagePath) {
        const found = [...collector.files.values()].find(
          (file) => contentAddressedPath(file.sha256, file.extension) === packagePath,
        );
        mimeType = found?.mimeType ?? null;
      }
    }
    attachmentRows.push({
      id: attachment.id,
      fileName: attachment.fileName,
      workOrderId: attachment.workOrderId,
      packagePath,
      fileState,
      mimeType,
    });
  }

  const documentRows = [];
  for (const document of documents) {
    let packagePath: string | null = null;
    let fileState = "excluded";
    if (options.includeFiles) {
      const stored = UPLOAD_URL.exec(document.filePath);
      const result = stored
        ? await collector.addStoredName({
            storedName: stored[1],
            kind: "DOCUMENT",
            sourceEntityType: "Document",
            sourceEntityId: document.id,
            originalName: document.fileName,
            declaredMime: document.mimeType,
          })
        : await collector.addUrl({
            url: document.filePath,
            kind: "DOCUMENT",
            sourceEntityType: "Document",
            sourceEntityId: document.id,
            originalName: document.fileName,
            declaredMime: document.mimeType,
          });
      packagePath = result.packagePath;
      fileState = result.state;
    }
    documentRows.push({
      id: document.id,
      title: document.title,
      description: document.description,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      contentText: document.contentText,
      pageTexts: document.pageTexts,
      folderId: document.folderId,
      tagIds: document.tags.map((tag) => tag.id),
      uploadedBy: document.uploadedBy,
      customerId: document.customerId,
      productId: document.productId,
      deletedAt: document.deletedAt,
      deletedBy: document.deletedBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      packagePath,
      fileState,
    });
  }

  const documentVersionRows = [];
  for (const version of documentVersions) {
    let packagePath: string | null = null;
    let fileState = "excluded";
    if (options.includeFiles) {
      const stored = UPLOAD_URL.exec(version.filePath);
      const result = stored
        ? await collector.addStoredName({
            storedName: stored[1],
            kind: "DOCUMENT_VERSION",
            sourceEntityType: "DocumentVersion",
            sourceEntityId: version.id,
            originalName: version.fileName,
            declaredMime: version.mimeType,
          })
        : await collector.addUrl({
            url: version.filePath,
            kind: "DOCUMENT_VERSION",
            sourceEntityType: "DocumentVersion",
            sourceEntityId: version.id,
            originalName: version.fileName,
            declaredMime: version.mimeType,
          });
      packagePath = result.packagePath;
      fileState = result.state;
    }
    documentVersionRows.push({
      id: version.id,
      documentId: version.documentId,
      fileName: version.fileName,
      fileSize: version.fileSize,
      mimeType: version.mimeType,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      packagePath,
      fileState,
    });
  }

  const reportRows = [];
  for (const report of reports) {
    let pdfFile: string | null = null;
    let pdfState = "excluded";
    if (options.includeFiles && report.pdfUrl) {
      const result = await collector.addUrl({
        url: report.pdfUrl,
        kind: "REPORT_PDF",
        sourceEntityType: "Report",
        sourceEntityId: report.id,
        originalName: "rapport.pdf",
        declaredMime: "application/pdf",
      });
      pdfFile = result.packagePath;
      pdfState = result.state;
    } else if (!report.pdfUrl) {
      pdfState = "missing";
      warnings.push({
        code: "customer_transfer.missing_file",
        path: `data/reports.json#${report.id}.pdfUrl`,
        messageKey: "errors.customerTransfer.missingPdf",
        detail: "REPORT_PDF",
      });
    }
    let technicianSignatureFile: string | null = null;
    let customerSignatureFile: string | null = null;
    if (options.includeSignatures) {
      if (report.technicianSignatureUrl) {
        technicianSignatureFile = (
          await collector.addUrl({
            url: report.technicianSignatureUrl,
            kind: "SIGNATURE",
            sourceEntityType: "Report",
            sourceEntityId: report.id,
            originalName: "signatur-tekniker",
          })
        ).packagePath;
      }
      if (report.customerSignatureUrl) {
        customerSignatureFile = (
          await collector.addUrl({
            url: report.customerSignatureUrl,
            kind: "SIGNATURE",
            sourceEntityType: "Report",
            sourceEntityId: report.id,
            originalName: "signatur-kunde",
          })
        ).packagePath;
      }
    }
    reportRows.push({
      id: report.id,
      dataJson: report.dataJson,
      comments: report.comments,
      completedAt: report.completedAt,
      technicianSignatureUrl: options.includeSignatures ? report.technicianSignatureUrl : null,
      technicianSignatureFile,
      technicianName: report.technicianName,
      customerSignatureUrl: options.includeSignatures ? report.customerSignatureUrl : null,
      customerSignatureFile,
      customerName: report.customerName,
      signatureExcluded: !options.includeSignatures,
      workOrderId: report.workOrderId,
      templateId: report.templateId,
      templateTitle: report.templateTitle,
      name: report.name,
      reportNumber: report.reportNumber,
      requiresUnits: report.requiresUnits,
      templateCategory: report.templateCategory,
      hmsType: report.hmsType,
      templateSnapshotJson: report.templateSnapshotJson,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      isLocked: report.isLocked,
      lockedAt: report.lockedAt,
      lockedByName: report.lockedByName,
      pdfFile,
      pdfState,
      pdfHash: report.pdfHash,
      pdfGeneratedAt: report.pdfGeneratedAt,
      customerAcknowledgedAt: report.customerAcknowledgedAt,
      customerAcknowledgedBy: report.customerAcknowledgedBy,
      customerAcknowledgedComment: report.customerAcknowledgedComment,
      revision: report.revision,
      deletedAt: report.deletedAt,
      deletedBy: report.deletedBy,
      legalHold: report.legalHold,
    });
  }

  const revisionRows = [];
  for (const revision of reportRevisions) {
    let technicianSignatureFile: string | null = null;
    let customerSignatureFile: string | null = null;
    if (options.includeSignatures) {
      if (revision.technicianSignatureUrl) {
        technicianSignatureFile = (
          await collector.addUrl({
            url: revision.technicianSignatureUrl,
            kind: "SIGNATURE",
            sourceEntityType: "ReportRevision",
            sourceEntityId: revision.id,
            originalName: "signatur-tekniker",
          })
        ).packagePath;
      }
      if (revision.customerSignatureUrl) {
        customerSignatureFile = (
          await collector.addUrl({
            url: revision.customerSignatureUrl,
            kind: "SIGNATURE",
            sourceEntityType: "ReportRevision",
            sourceEntityId: revision.id,
            originalName: "signatur-kunde",
          })
        ).packagePath;
      }
    }
    revisionRows.push({
      ...revision,
      technicianSignatureUrl: options.includeSignatures ? revision.technicianSignatureUrl : null,
      customerSignatureUrl: options.includeSignatures ? revision.customerSignatureUrl : null,
      technicianSignatureFile,
      customerSignatureFile,
      signatureExcluded: !options.includeSignatures,
    });
  }

  warnings.push(...collector.warnings);

  const dataset: TransferDataset = {
    customers: customerRows.sort(compareById),
    contacts: contacts.map((row) => ({ ...row })).sort(compareById),
    portalUsers: portalUsers
      .map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        customerId: row.customerId,
        contactId: row.contactId,
        isActive: row.isActive,
        locale: row.locale,
        emailVerified: Boolean(row.emailVerified),
      }))
      .sort(compareById),
    portalDelegations: delegations.map((row) => ({ ...row })).sort(compareById),
    sites: sites.map((row) => ({ ...row })).sort(compareById),
    equipmentCategories: equipmentCategories.sort(compareById),
    products: products
      .map((product) => {
        const { qrToken, ...safe } = product;
        return { ...safe, qrTokenPresent: Boolean(qrToken) };
      })
      .sort(compareById),
    meterReadings: meterReadings
      .map((row) => ({ ...row, value: row.value.toString() }))
      .sort(compareById),
    maintenancePlans: maintenancePlans
      .map((row) => ({
        ...row,
        meterInterval: row.meterInterval?.toString() ?? null,
        lastMeterValue: row.lastMeterValue?.toString() ?? null,
      }))
      .sort(compareById),
    maintenanceOccurrences: maintenanceOccurrences
      .map((row) => ({
        ...row,
        meterValue: row.meterValue?.toString() ?? null,
      }))
      .sort(compareById),
    contracts: contracts
      .map((row) => ({
        ...row,
        indexationPercent: row.indexationPercent?.toString() ?? null,
      }))
      .sort(compareById),
    contractLines: contractLines.map((row) => ({ ...row })).sort(compareById),
    tags: tags.map((row) => ({ ...row })).sort(compareById),
    workOrders: workOrders
      .map(({ templates, tags: orderTags, technicians, ...order }) => ({
        ...order,
        templateIds: templates.map((template) => template.id).sort(),
        tagIds: orderTags.map((tag) => tag.id).sort(),
        technicianIds: technicians.map((user) => user.id).sort(),
      }))
      .sort(compareById),
    visits: visits.map((row) => ({ ...row })).sort(compareById),
    visitTechnicians: visitTechnicians
      .map(
        (row) =>
          ({
            id: `${row.visitId}:${row.userId}`,
            visitId: row.visitId,
            userId: row.userId,
          }) as TransferRow,
      )
      .sort((left, right) => (String(left.id) < String(right.id) ? -1 : 1)),
    comments: comments.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    reports: reportRows.sort(compareById),
    reportUnits: reportUnits.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    reportRevisions: revisionRows.sort(compareById),
    customerAttachments: customerAttachmentRows.sort(compareById),
    attachments: attachmentRows.sort(compareById),
    documents: documentRows.sort(compareById),
    documentVersions: documentVersionRows.sort(compareById),
    documentFolders: documentFolders.sort(compareById),
    documentTags: documentTags.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    uploads: uploadRows.sort(compareById),
    departments: departments.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    users: users.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    templates: templates.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    slaPolicies: slaPolicies.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    priceLists: priceLists.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    priceListItems: priceListItems.map((row) => ({ ...row }) as TransferRow).sort(compareById),
    auditSnapshot: [],
  } as unknown as TransferDataset;

  const files: TransferFileEntry[] = [...collector.files.values()]
    .map((file) => ({
      path: contentAddressedPath(file.sha256, file.extension),
      sha256: file.sha256,
      size: file.data.length,
      mimeType: file.mimeType,
      kind: file.kind,
      originalName: file.originalName,
      sourceUrl: file.sourceUrl,
      sourceEntityType: file.references[0]?.sourceEntityType,
      sourceEntityId: file.references[0]?.sourceEntityId,
      references: file.references,
      data: file.data,
    }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));

  return {
    dataset,
    files,
    warnings,
    customerIds,
    customerNamesForAudit: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
    })),
  };
}

export function emptyDataset(): TransferDataset {
  return {
    customers: [],
    contacts: [],
    portalUsers: [],
    portalDelegations: [],
    sites: [],
    equipmentCategories: [],
    products: [],
    meterReadings: [],
    maintenancePlans: [],
    maintenanceOccurrences: [],
    contracts: [],
    contractLines: [],
    tags: [],
    workOrders: [],
    visits: [],
    visitTechnicians: [],
    comments: [],
    reports: [],
    reportUnits: [],
    reportRevisions: [],
    customerAttachments: [],
    attachments: [],
    documents: [],
    documentVersions: [],
    documentFolders: [],
    documentTags: [],
    uploads: [],
    departments: [],
    users: [],
    templates: [],
    slaPolicies: [],
    priceLists: [],
    priceListItems: [],
    auditSnapshot: [],
  };
}

