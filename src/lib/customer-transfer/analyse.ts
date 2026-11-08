// i18n-ignore-file: konfliktanalyse bruker stabile koder og id-er, ikke PII.
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { getStorageDriver } from "@/lib/storage";
import { isValidExternalQrValue, normalizeExternalQrValue } from "@/lib/equipment-qr";
import { sha256Hex } from "@/lib/zip";
import {
  TRANSFER_ERROR,
  type ConflictPolicies,
  type TransferIssue,
} from "./constants";
import {
  normaliseContractNumber,
  normaliseCustomerNumber,
  normaliseEmail,
  normaliseName,
  normaliseOrgNumber,
  normalisePath,
  normaliseReference,
  normaliseSerial,
} from "./normalise";
import type {
  AnalysisAction,
  ImportAnalysis,
  ImportOptions,
  PackageReadResult,
  TransferRow,
} from "./types";

export type EntityKey = `${string}:${string}`;

export function entityKey(type: string, id: string): EntityKey {
  return `${type}:${id}`;
}

export type TargetCustomer = {
  id: string;
  name: string;
  orgNumber: string | null;
  customerNumber: string | null;
  deletedAt: Date | null;
  updatedAt: Date;
};

export type TargetSnapshot = {
  customers: TargetCustomer[];
  customersByOrg: Map<string, TargetCustomer>;
  customersByNumber: Map<string, TargetCustomer>;
  usersByEmail: Map<string, { id: string; role: string; customerId: string | null }>;
  departmentsByName: Map<string, string>;
  templatesByKey: Map<string, string>;
  tagsByName: Map<string, string>;
  documentTagsByName: Map<string, string>;
  slaByName: Map<string, string>;
  priceListsByName: Map<string, string>;
  categoryPaths: Map<string, string>;
  folderPaths: Map<string, string>;
  contactsByCustomerEmail: Map<string, string>;
  sitesByCustomerName: Map<string, string>;
  productsByCustomerSerial: Map<string, { id: string; updatedAt: Date }>;
  equipmentQrCodesByValue: Map<
    string,
    { id: string; productId: string; customerId: string }
  >;
  contractsByNumber: Map<string, string>;
  workOrdersByReference: Map<string, string>;
  reportsByWorkOrderTemplate: Map<string, string>;
  reportsByNumber: Map<string, string>;
  documentsByHashOwner: Map<string, string>;
  uploadsByHashOwner: Map<string, string>;
  priorRecords: Map<EntityKey, string>;
};

function pathKey(parts: string[]): string {
  return normalisePath(parts.join("/"));
}

export function categoryPathMap(
  rows: Array<{ id: string; name: string; parentId: string | null }>,
): Map<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result = new Map<string, string>();
  for (const row of rows) {
    const segments: string[] = [];
    let current: typeof row | undefined = row;
    let guard = 0;
    while (current && guard < 64) {
      segments.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
    result.set(row.id, pathKey(segments));
  }
  return result;
}

function folderPathMap(
  rows: Array<{ id: string; name: string; parentId: string | null }>,
): Map<string, string> {
  return categoryPathMap(rows);
}

async function shaForUploadUrl(value: unknown): Promise<string | null> {
  if (typeof value !== "string") return null;
  const match = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(value);
  if (!match) return null;
  try {
    return sha256Hex(await getStorageDriver().read(match[1]));
  } catch {
    return null;
  }
}

function packageFileSha(row: TransferRow, field = "packagePath"): string | null {
  const value = row[field];
  if (typeof value !== "string") return null;
  const match = /^files\/[a-f0-9]{2}\/([a-f0-9]{64})\./.exec(value);
  return match ? match[1] : null;
}

function issue(
  code: TransferIssue["code"],
  pathValue: string,
  messageKey: string,
  detail?: string,
): TransferIssue {
  return { code, path: pathValue, messageKey, ...(detail ? { detail } : {}) };
}

export async function loadTargetSnapshot(
  dataset: PackageReadResult["dataset"],
): Promise<TargetSnapshot> {
  // Kundenøkler normaliseres i JS, ikke i SQL. Da matcher «NO 912 345 678
  // MVA» og «912345678» selv om målbasen lagrer råformatet ulikt.
  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      orgNumber: true,
      customerNumber: true,
      deletedAt: true,
      updatedAt: true,
    },
    take: 50_000,
  });

  const customersByOrg = new Map<string, TargetCustomer>();
  const customersByNumber = new Map<string, TargetCustomer>();
  for (const customer of customers) {
    const org = normaliseOrgNumber(customer.orgNumber);
    if (org) customersByOrg.set(org, customer);
    const number = normaliseCustomerNumber(customer.customerNumber);
    if (number) customersByNumber.set(number, customer);
  }

  const emails = new Set<string>();
  for (const user of dataset.portalUsers) {
    const email = normaliseEmail(user.email);
    if (email) emails.add(email);
  }
  // Ansattreferanser slås også opp på e-post. Uten dette ville en teknisker
  // som finnes i målbasen blitt behandlet som «mangler».
  for (const user of dataset.users) {
    const email = normaliseEmail(user.email);
    if (email) emails.add(email);
  }
  const users =
    emails.size > 0
      ? await prisma.user.findMany({
          where: { email: { in: [...emails] } },
          select: { id: true, email: true, role: true, customerId: true },
        })
      : [];
  const usersByEmail = new Map(
    users.map((user) => [normaliseEmail(user.email), user]),
  );

  const [departments, templates, tags, documentTags, slaPolicies, priceLists] =
    await Promise.all([
      prisma.department.findMany({ select: { id: true, name: true } }),
      prisma.template.findMany({
        select: { id: true, title: true, category: true, hmsType: true },
      }),
      prisma.tag.findMany({ select: { id: true, name: true } }),
      prisma.documentTag.findMany({ select: { id: true, name: true } }),
      prisma.slaPolicy.findMany({
        select: { id: true, name: true, departmentId: true, isActive: true },
      }),
      prisma.priceList.findMany({ select: { id: true, name: true } }),
    ]);

  const departmentsByName = new Map(
    departments.map((department) => [normaliseName(department.name), department.id]),
  );
  const templatesByKey = new Map(
    templates.map((template) => [
      `${normaliseName(template.title)}|${template.category}|${template.hmsType ?? ""}`,
      template.id,
    ]),
  );
  const tagsByName = new Map(tags.map((tag) => [normaliseName(tag.name), tag.id]));
  const documentTagsByName = new Map(
    documentTags.map((tag) => [normaliseName(tag.name), tag.id]),
  );
  const slaByName = new Map(
    slaPolicies.map((policy) => [normaliseName(policy.name), policy.id]),
  );
  const priceListsByName = new Map(
    priceLists.map((list) => [normaliseName(list.name), list.id]),
  );

  const [targetCategories, targetFolders] = await Promise.all([
    prisma.equipmentCategory.findMany({
      select: { id: true, name: true, parentId: true },
    }),
    prisma.documentFolder.findMany({
      select: { id: true, name: true, parentId: true },
    }),
  ]);
  const categoryPathToId = new Map<string, string>();
  for (const [id, pathValue] of categoryPathMap(targetCategories)) {
    if (!categoryPathToId.has(pathValue)) categoryPathToId.set(pathValue, id);
  }
  const folderPathToId = new Map<string, string>();
  for (const [id, pathValue] of folderPathMap(targetFolders)) {
    if (!folderPathToId.has(pathValue)) folderPathToId.set(pathValue, id);
  }

  const sourceCustomerTargets = new Map<string, string>();
  for (const customer of dataset.customers) {
    const match =
      customersByOrg.get(normaliseOrgNumber(customer.orgNumber)) ??
      customersByNumber.get(normaliseCustomerNumber(customer.customerNumber));
    if (match) sourceCustomerTargets.set(customer.id, match.id);
  }
  const targetCustomerIds = [...new Set(sourceCustomerTargets.values())];

  const [contacts, sites, products, equipmentQrCodes, contracts, workOrders, reports, documents, uploads] =
    await Promise.all([
      targetCustomerIds.length
        ? prisma.contact.findMany({
            where: { customerId: { in: targetCustomerIds } },
            select: { id: true, customerId: true, email: true },
          })
        : Promise.resolve([]),
      targetCustomerIds.length
        ? prisma.customerSite.findMany({
            where: { customerId: { in: targetCustomerIds } },
            select: { id: true, customerId: true, name: true },
          })
        : Promise.resolve([]),
      targetCustomerIds.length
        ? prisma.product.findMany({
            where: { customerId: { in: targetCustomerIds } },
            select: {
              id: true,
              customerId: true,
              serialNumber: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
      prisma.equipmentQrCode.findMany({
        select: {
          id: true,
          normalizedValue: true,
          productId: true,
          product: { select: { customerId: true } },
        },
      }),
      prisma.contract.findMany({
        where: { contractNumber: { not: null } },
        select: { id: true, contractNumber: true },
      }),
      prisma.workOrder.findMany({ select: { id: true, reference: true } }),
      prisma.report.findMany({
        select: {
          id: true,
          workOrderId: true,
          templateId: true,
          reportNumber: true,
        },
      }),
      targetCustomerIds.length
        ? prisma.document.findMany({
            where: {
              OR: [
                { customerId: { in: targetCustomerIds } },
                { customerId: { not: null } },
              ],
            },
            select: {
              id: true,
              customerId: true,
              productId: true,
              filePath: true,
            },
            take: 10_000,
          })
        : Promise.resolve([]),
      targetCustomerIds.length
        ? prisma.upload.findMany({
            where: {
              OR: [
                { ownerType: "CUSTOMER", ownerId: { in: targetCustomerIds } },
                { ownerType: "WORK_ORDER" },
              ],
            },
            select: {
              id: true,
              ownerType: true,
              ownerId: true,
              storedName: true,
              contentHash: true,
              customerId: true,
            },
            take: 20_000,
          })
        : Promise.resolve([]),
    ]);

  const contactsByCustomerEmail = new Map<string, string>();
  for (const contact of contacts) {
    const email = normaliseEmail(contact.email);
    if (email) contactsByCustomerEmail.set(`${contact.customerId}:${email}`, contact.id);
  }
  const sitesByCustomerName = new Map<string, string>();
  for (const site of sites) {
    sitesByCustomerName.set(
      `${site.customerId}:${normaliseName(site.name)}`,
      site.id,
    );
  }
  const productsByCustomerSerial = new Map<
    string,
    { id: string; updatedAt: Date }
  >();
  for (const product of products) {
    const serial = normaliseSerial(product.serialNumber);
    if (serial) {
      productsByCustomerSerial.set(`${product.customerId}:${serial}`, {
        id: product.id,
        updatedAt: product.updatedAt,
      });
    }
  }
  const equipmentQrCodesByValue = new Map<
    string,
    { id: string; productId: string; customerId: string }
  >();
  for (const code of equipmentQrCodes) {
    equipmentQrCodesByValue.set(code.normalizedValue, {
      id: code.id,
      productId: code.productId,
      customerId: code.product.customerId,
    });
  }
  const contractsByNumber = new Map<string, string>();
  for (const contract of contracts) {
    contractsByNumber.set(
      normaliseContractNumber(contract.contractNumber),
      contract.id,
    );
  }
  const workOrdersByReference = new Map<string, string>();
  for (const order of workOrders) {
    workOrdersByReference.set(normaliseReference(order.reference), order.id);
  }
  const reportsByWorkOrderTemplate = new Map<string, string>();
  const reportsByNumber = new Map<string, string>();
  for (const report of reports) {
    reportsByWorkOrderTemplate.set(
      `${report.workOrderId}:${report.templateId ?? ""}`,
      report.id,
    );
    if (report.reportNumber) reportsByNumber.set(report.reportNumber, report.id);
  }

  const documentsByHashOwner = new Map<string, string>();
  for (const document of documents) {
    const hash = await shaForUploadUrl(document.filePath);
    if (!hash) continue;
    documentsByHashOwner.set(
      `${document.customerId ?? ""}:${document.productId ?? ""}:${hash}`,
      document.id,
    );
  }
  const uploadsByHashOwner = new Map<string, string>();
  for (const upload of uploads) {
    let hash = upload.contentHash ?? null;
    if (!hash) hash = await shaForUploadUrl(`/uploads/${upload.storedName}`);
    if (!hash) continue;
    uploadsByHashOwner.set(
      `${upload.ownerType}:${upload.ownerId ?? ""}:${hash}`,
      upload.id,
    );
  }

  const sourceKeys = new Set<string>();
  for (const [key] of Object.entries(dataset)) {
    void key;
  }
  const sourceIds = collectSourceRefs(dataset);
  const prior = sourceIds.length
    ? await prisma.customerTransferRecord.findMany({
        where: { sourceId: { in: sourceIds } },
        orderBy: { createdAt: "desc" },
        select: {
          sourceInstanceId: true,
          sourceEntityType: true,
          sourceId: true,
          targetId: true,
        },
      })
    : [];
  const priorRecords = new Map<EntityKey, string>();
  for (const record of prior) {
    if (!record.targetId) continue;
    const key = entityKey(record.sourceEntityType, record.sourceId);
    if (!priorRecords.has(key)) priorRecords.set(key, record.targetId);
  }
  void sourceKeys;

  return {
    customers,
    customersByOrg,
    customersByNumber,
    usersByEmail,
    departmentsByName,
    templatesByKey,
    tagsByName,
    documentTagsByName,
    slaByName,
    priceListsByName,
    categoryPaths: categoryPathToId,
    folderPaths: folderPathToId,
    contactsByCustomerEmail,
    sitesByCustomerName,
    productsByCustomerSerial,
    equipmentQrCodesByValue,
    contractsByNumber,
    workOrdersByReference,
    reportsByWorkOrderTemplate,
    reportsByNumber,
    documentsByHashOwner,
    uploadsByHashOwner,
    priorRecords,
  };
}

function collectSourceRefs(dataset: PackageReadResult["dataset"]): string[] {
  const ids = new Set<string>();
  for (const [key, rows] of Object.entries(dataset)) {
    if (key === "auditSnapshot") continue;
    for (const row of rows as TransferRow[]) {
      if (typeof row.id === "string") ids.add(row.id);
    }
  }
  return [...ids];
}

type PlanMap = Map<EntityKey, { action: AnalysisAction; targetId?: string; reason?: string }>;

function setPlan(
  plan: PlanMap,
  type: string,
  id: string,
  action: AnalysisAction,
  targetId?: string,
  reason?: string,
) {
  plan.set(entityKey(type, id), { action, targetId, reason });
}

/**
 * Sammenligner pakken med målbasen uten å skrive noe. Alle handlinger er
 * eksplisitte, og `canImport` er bare sann når det ikke finnes feil.
 */
export async function analysePackage(
  read: PackageReadResult,
  policies: ConflictPolicies,
  options: ImportOptions,
): Promise<ImportAnalysis & { snapshot: TargetSnapshot; plan: PlanMap }> {
  const dataset = read.dataset;
  const snapshot = await loadTargetSnapshot(dataset);
  const plan: PlanMap = new Map();
  const warnings: TransferIssue[] = [];
  const errors: TransferIssue[] = [];

  const customerTargets = new Map<string, { action: AnalysisAction; targetId?: string }>();
  const customerPreview: ImportAnalysis["customers"] = [];

  for (const customer of dataset.customers) {
    const match =
      snapshot.customersByOrg.get(normaliseOrgNumber(customer.orgNumber)) ??
      snapshot.customersByNumber.get(normaliseCustomerNumber(customer.customerNumber));
    if (!match) {
      setPlan(plan, "Customer", customer.id, "CREATE");
      customerTargets.set(customer.id, { action: "CREATE" });
      customerPreview.push({ sourceId: customer.id, match: "NEW", action: "CREATE" });
      continue;
    }
    if (policies.customer === "update") {
      setPlan(plan, "Customer", customer.id, "UPDATE", match.id, "matched");
      customerTargets.set(customer.id, { action: "UPDATE", targetId: match.id });
      customerPreview.push({
        sourceId: customer.id,
        match: "EXISTING",
        action: "UPDATE",
        targetId: match.id,
      });
    } else if (policies.customer === "new") {
      setPlan(plan, "Customer", customer.id, "CREATE", undefined, "explicit_new");
      customerTargets.set(customer.id, { action: "CREATE" });
      customerPreview.push({ sourceId: customer.id, match: "EXISTING", action: "CREATE" });
    } else {
      setPlan(plan, "Customer", customer.id, "SKIP", match.id, "duplicate");
      customerTargets.set(customer.id, { action: "SKIP", targetId: match.id });
      customerPreview.push({
        sourceId: customer.id,
        match: "EXISTING",
        action: "SKIP",
        targetId: match.id,
      });
    }
  }

  const targetCustomerFor = (sourceCustomerId: unknown) => {
    if (typeof sourceCustomerId !== "string") return undefined;
    return customerTargets.get(sourceCustomerId)?.targetId;
  };
  // Referanser: kategori/mappe etter sti. Ukjent sti opprettes bare med
  // eksplisitt samtykke; ellers blir koblingen null med en advarsel.
  const sourceCategoryPaths = categoryPathMap(
    dataset.equipmentCategories as Array<{
      id: string;
      name: string;
      parentId: string | null;
    }>,
  );
  for (const category of dataset.equipmentCategories) {
    const pathValue = sourceCategoryPaths.get(String(category.id)) ?? "";
    const existing = snapshot.categoryPaths.get(pathValue);
    if (existing) {
      setPlan(plan, "EquipmentCategory", String(category.id), "SKIP", existing, "reference");
    } else if (options.createMissingReferences) {
      setPlan(plan, "EquipmentCategory", String(category.id), "CREATE", undefined, "reference");
    } else {
      setPlan(plan, "EquipmentCategory", String(category.id), "SKIP", undefined, "reference_missing");
      warnings.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/equipment-categories.json#${category.id}`,
          "errors.customerTransfer.referenceMissing",
          "equipmentCategory",
        ),
      );
    }
  }

  const sourceFolderPaths = folderPathMap(
    dataset.documentFolders as Array<{
      id: string;
      name: string;
      parentId: string | null;
    }>,
  );
  for (const folder of dataset.documentFolders) {
    const pathValue = sourceFolderPaths.get(String(folder.id)) ?? "";
    const existing = snapshot.folderPaths.get(pathValue);
    if (existing) {
      setPlan(plan, "DocumentFolder", String(folder.id), "SKIP", existing, "reference");
    } else if (options.createMissingReferences) {
      setPlan(plan, "DocumentFolder", String(folder.id), "CREATE", undefined, "reference");
    } else {
      setPlan(plan, "DocumentFolder", String(folder.id), "SKIP", undefined, "reference_missing");
      warnings.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/document-folders.json#${folder.id}`,
          "errors.customerTransfer.referenceMissing",
          "documentFolder",
        ),
      );
    }
  }

  // Tags og dokumenttags opprettes bare ved eksplisitt valg.
  for (const [type, rows, map] of [
    ["Tag", dataset.tags, snapshot.tagsByName] as const,
    ["DocumentTag", dataset.documentTags, snapshot.documentTagsByName] as const,
  ]) {
    for (const row of rows) {
      const name = normaliseName(row.name);
      const existing = map.get(name);
      if (existing) {
        setPlan(plan, type, String(row.id), "SKIP", existing, "reference");
      } else if (options.createMissingReferences) {
        setPlan(plan, type, String(row.id), "CREATE", undefined, "reference");
      } else {
        setPlan(plan, type, String(row.id), "SKIP", undefined, "reference_missing");
        warnings.push(
          issue(
            "customer_transfer.invalid_reference",
            `data/${type === "Tag" ? "tags" : "document-tags"}.json#${row.id}`,
            "errors.customerTransfer.referenceMissing",
            type,
          ),
        );
      }
    }
  }

  // Avdelinger: obligatoriske for kontrakter/planer/oppdrag. Mangler de og
  // oppretting ikke er valgt, blokkeres importen.
  for (const department of dataset.departments) {
    const existing = snapshot.departmentsByName.get(normaliseName(department.name));
    if (existing) {
      setPlan(plan, "Department", String(department.id), "SKIP", existing, "reference");
    } else if (options.createMissingReferences) {
      setPlan(plan, "Department", String(department.id), "CREATE", undefined, "reference");
    } else {
      setPlan(plan, "Department", String(department.id), "SKIP", undefined, "reference_missing");
      errors.push(
        issue(
          TRANSFER_ERROR.invalid_reference,
          `data/reference/departments.json#${department.id}`,
          "errors.customerTransfer.departmentMissing",
          "department",
        ),
      );
    }
  }

  // Ansatte og maler opprettes aldri. Manglende kobling blir null + advarsel.
  for (const user of dataset.users) {
    const email = normaliseEmail(user.email);
    const existing = email ? snapshot.usersByEmail.get(email) : undefined;
    if (existing) {
      setPlan(plan, "User", String(user.id), "SKIP", existing.id, "reference");
    } else {
      setPlan(plan, "User", String(user.id), "SKIP", undefined, "reference_missing");
      warnings.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/reference/users.json#${user.id}`,
          "errors.customerTransfer.staffMissing",
          "staff",
        ),
      );
    }
  }
  for (const template of dataset.templates) {
    const key = `${normaliseName(template.title)}|${template.category}|${template.hmsType ?? ""}`;
    const existing = snapshot.templatesByKey.get(key);
    if (existing) {
      setPlan(plan, "Template", String(template.id), "SKIP", existing, "reference");
    } else {
      setPlan(plan, "Template", String(template.id), "SKIP", undefined, "reference_missing");
      warnings.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/reference/templates.json#${template.id}`,
          "errors.customerTransfer.templateMissing",
          "template",
        ),
      );
    }
  }
  for (const policy of dataset.slaPolicies) {
    const existing = snapshot.slaByName.get(normaliseName(policy.name));
    if (existing) {
      setPlan(plan, "SlaPolicy", String(policy.id), "SKIP", existing, "reference");
    } else {
      setPlan(plan, "SlaPolicy", String(policy.id), "SKIP", undefined, "reference_missing");
      warnings.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/reference/sla-policies.json#${policy.id}`,
          "errors.customerTransfer.referenceMissing",
          "slaPolicy",
        ),
      );
    }
  }
  for (const list of dataset.priceLists) {
    const existing = snapshot.priceListsByName.get(normaliseName(list.name));
    if (existing) {
      setPlan(plan, "PriceList", String(list.id), "SKIP", existing, "reference");
    } else {
      setPlan(plan, "PriceList", String(list.id), "SKIP", undefined, "reference_missing");
      warnings.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/reference/price-lists.json#${list.id}`,
          "errors.customerTransfer.referenceMissing",
          "priceList",
        ),
      );
    }
  }

  const parentSkipped = new Map<string, boolean>();

  for (const contact of dataset.contacts) {
    const targetCustomer = targetCustomerFor(contact.customerId);
    const email = normaliseEmail(contact.email);
    const match =
      targetCustomer && email
        ? snapshot.contactsByCustomerEmail.get(`${targetCustomer}:${email}`)
        : undefined;
    if (match) {
      if (policies.contact === "new") {
        setPlan(plan, "Contact", String(contact.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "Contact", String(contact.id), "SKIP", match, "duplicate");
      }
    } else {
      setPlan(plan, "Contact", String(contact.id), "CREATE");
    }
  }

  for (const user of dataset.portalUsers) {
    const email = normaliseEmail(user.email);
    const existing = email ? snapshot.usersByEmail.get(email) : undefined;
    if (existing) {
      const targetCustomer = targetCustomerFor(user.customerId);
      if (
        existing.role !== "CUSTOMER" ||
        !targetCustomer ||
        existing.customerId !== targetCustomer
      ) {
        setPlan(plan, "PortalUser", String(user.id), "CONFLICT", undefined, "email_collision");
        errors.push(
          issue(
            TRANSFER_ERROR.conflict,
            `data/portal-users.json#${user.id}.email`,
            "errors.customerTransfer.portalEmailCollision",
            "portalUser",
          ),
        );
      } else {
        setPlan(plan, "PortalUser", String(user.id), "SKIP", existing.id, "duplicate");
      }
    } else {
      setPlan(plan, "PortalUser", String(user.id), "CREATE");
    }
  }

  for (const site of dataset.sites) {
    const targetCustomer = targetCustomerFor(site.customerId);
    const key = targetCustomer
      ? `${targetCustomer}:${normaliseName(site.name)}`
      : "";
    const match = key ? snapshot.sitesByCustomerName.get(key) : undefined;
    if (match) {
      if (policies.site === "new") {
        setPlan(plan, "CustomerSite", String(site.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "CustomerSite", String(site.id), "SKIP", match, "duplicate");
      }
    } else {
      setPlan(plan, "CustomerSite", String(site.id), "CREATE");
    }
  }

  // Utstyr: foreldre før barn, slik at hierarkiet kan gjenopprettes.
  const orderedProducts = orderByHierarchy(dataset.products);
  for (const product of orderedProducts) {
    const targetCustomer = targetCustomerFor(product.customerId);
    const serial = normaliseSerial(product.serialNumber);
    const match =
      targetCustomer && serial
        ? snapshot.productsByCustomerSerial.get(`${targetCustomer}:${serial}`)
        : undefined;
    if (match) {
      if (policies.equipment === "update") {
        setPlan(plan, "Product", String(product.id), "UPDATE", match.id, "matched");
      } else if (policies.equipment === "new") {
        setPlan(plan, "Product", String(product.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "Product", String(product.id), "SKIP", match.id, "duplicate");
      }
    } else {
      if (!serial && product.serialNumber) {
        warnings.push(
          issue(
            "customer_transfer.invalid_reference",
            `data/equipment.json#${product.id}.serialNumber`,
            "errors.customerTransfer.serialMissing",
            "equipment",
          ),
        );
      }
      setPlan(plan, "Product", String(product.id), "CREATE");
    }
  }

  // Kundenes eksisterende QR-koder. Verdien er globalt unik, også på tvers av
  // kunder, så en kollisjon er en konflikt og blokkerer importen.
  const sourceProductIds = new Set(
    dataset.products.map((product) => String(product.id)),
  );
  const seenQrValues = new Map<string, string>();
  for (const code of dataset.equipmentQrCodes) {
    const value = normalizeExternalQrValue(code.value);
    const pathValue = `data/equipment-qr-codes.json#${code.id}.value`;
    if (!isValidExternalQrValue(value)) {
      setPlan(plan, "EquipmentQrCode", String(code.id), "INVALID");
      errors.push(
        issue(
          "customer_transfer.invalid_data",
          pathValue,
          "errors.customerTransfer.invalidData",
          "equipmentQrCode",
        ),
      );
      continue;
    }
    const productId = String(code.productId ?? "");
    const productPlan = plan.get(entityKey("Product", productId));
    if (!productPlan || !sourceProductIds.has(productId)) {
      setPlan(plan, "EquipmentQrCode", String(code.id), "CONFLICT");
      errors.push(
        issue(
          "customer_transfer.invalid_reference",
          `data/equipment-qr-codes.json#${code.id}.productId`,
          "errors.customerTransfer.invalidReference",
          "equipmentQrCode",
        ),
      );
      continue;
    }

    const duplicateInPackage = seenQrValues.get(value);
    if (duplicateInPackage) {
      setPlan(plan, "EquipmentQrCode", String(code.id), "CONFLICT");
      errors.push(
        issue(
          "customer_transfer.conflict",
          pathValue,
          "errors.customerTransfer.qrConflict",
          "equipmentQrCode",
        ),
      );
      continue;
    }
    seenQrValues.set(value, String(code.id));

    const prior = snapshot.priorRecords.get(
      entityKey("EquipmentQrCode", String(code.id)),
    );
    if (prior) {
      setPlan(plan, "EquipmentQrCode", String(code.id), "SKIP", prior, "already_imported");
      continue;
    }

    const existing = snapshot.equipmentQrCodesByValue.get(value);
    if (existing) {
      if (productPlan.targetId && existing.productId === productPlan.targetId) {
        setPlan(plan, "EquipmentQrCode", String(code.id), "SKIP", existing.id, "duplicate");
      } else {
        setPlan(plan, "EquipmentQrCode", String(code.id), "CONFLICT");
        errors.push(
          issue(
            "customer_transfer.conflict",
            pathValue,
            "errors.customerTransfer.qrConflict",
            "equipmentQrCode",
          ),
        );
      }
      continue;
    }

    setPlan(plan, "EquipmentQrCode", String(code.id), "CREATE");
  }

  for (const contract of dataset.contracts) {
    const number = normaliseContractNumber(contract.contractNumber);
    const match = number ? snapshot.contractsByNumber.get(number) : undefined;
    if (match) {
      if (policies.contract === "new") {
        setPlan(plan, "Contract", String(contract.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "Contract", String(contract.id), "SKIP", match, "duplicate");
      }
    } else {
      setPlan(plan, "Contract", String(contract.id), "CREATE");
    }
  }
  for (const line of dataset.contractLines) {
    const contractPlan = plan.get(entityKey("Contract", String(line.contractId)));
    if (contractPlan?.action === "SKIP") {
      setPlan(plan, "ContractLine", String(line.id), "SKIP", undefined, "parent_skipped");
      parentSkipped.set(entityKey("ContractLine", String(line.id)), true);
    } else {
      setPlan(plan, "ContractLine", String(line.id), "CREATE");
    }
  }

  for (const order of dataset.workOrders) {
    const reference = normaliseReference(order.reference);
    const match = reference ? snapshot.workOrdersByReference.get(reference) : undefined;
    if (match) {
      if (policies.workOrder === "new") {
        setPlan(plan, "WorkOrder", String(order.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "WorkOrder", String(order.id), "SKIP", match, "duplicate");
        parentSkipped.set(entityKey("WorkOrder", String(order.id)), true);
      }
    } else {
      setPlan(plan, "WorkOrder", String(order.id), "CREATE");
    }
  }

  for (const visit of dataset.visits) {
    if (parentSkipped.get(entityKey("WorkOrder", String(visit.workOrderId)))) {
      setPlan(plan, "Visit", String(visit.id), "SKIP", undefined, "parent_skipped");
      parentSkipped.set(entityKey("Visit", String(visit.id)), true);
    } else {
      setPlan(plan, "Visit", String(visit.id), "CREATE");
    }
  }
  for (const link of dataset.visitTechnicians) {
    if (parentSkipped.get(entityKey("Visit", String(link.visitId)))) {
      setPlan(plan, "VisitTechnician", `${link.visitId}:${link.userId}`, "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "VisitTechnician", `${link.visitId}:${link.userId}`, "CREATE");
    }
  }
  for (const comment of dataset.comments) {
    if (
      comment.workOrderId &&
      parentSkipped.get(entityKey("WorkOrder", String(comment.workOrderId)))
    ) {
      setPlan(plan, "Comment", String(comment.id), "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "Comment", String(comment.id), "CREATE");
    }
  }

  // Rapporter: aldri update. Eksisterende (arbeidsordre + mal) eller
  // rapportnummer gir skip som standard; «new» oppretter en ny rapport.
  for (const report of dataset.reports) {
    if (parentSkipped.get(entityKey("WorkOrder", String(report.workOrderId)))) {
      const targetOrder = plan.get(entityKey("WorkOrder", String(report.workOrderId)))?.targetId;
      const existing =
        (targetOrder &&
          snapshot.reportsByWorkOrderTemplate.get(
            `${targetOrder}:${report.templateId ?? ""}`,
          )) ||
        (report.reportNumber
          ? snapshot.reportsByNumber.get(String(report.reportNumber))
          : undefined);
      if (existing && policies.report !== "new") {
        setPlan(plan, "Report", String(report.id), "SKIP", existing, "duplicate");
        parentSkipped.set(entityKey("Report", String(report.id)), true);
        continue;
      }
      if (policies.report === "new") {
        setPlan(plan, "Report", String(report.id), "CREATE", undefined, "explicit_new");
        continue;
      }
      setPlan(plan, "Report", String(report.id), "SKIP", undefined, "parent_skipped");
      parentSkipped.set(entityKey("Report", String(report.id)), true);
      continue;
    }
    const prior = snapshot.priorRecords.get(entityKey("Report", String(report.id)));
    if (prior && policies.report !== "new") {
      setPlan(plan, "Report", String(report.id), "SKIP", prior, "already_imported");
      parentSkipped.set(entityKey("Report", String(report.id)), true);
    } else {
      setPlan(plan, "Report", String(report.id), "CREATE");
    }
  }
  for (const unit of dataset.reportUnits) {
    if (parentSkipped.get(entityKey("Report", String(unit.reportId)))) {
      setPlan(plan, "ReportUnit", String(unit.id), "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "ReportUnit", String(unit.id), "CREATE");
    }
  }
  for (const revision of dataset.reportRevisions) {
    if (parentSkipped.get(entityKey("Report", String(revision.reportId)))) {
      setPlan(plan, "ReportRevision", String(revision.id), "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "ReportRevision", String(revision.id), "CREATE");
    }
  }

  for (const planRow of dataset.maintenancePlans) {
    const prior = snapshot.priorRecords.get(entityKey("MaintenancePlan", String(planRow.id)));
    if (prior) {
      setPlan(plan, "MaintenancePlan", String(planRow.id), "SKIP", prior, "already_imported");
    } else {
      setPlan(plan, "MaintenancePlan", String(planRow.id), "CREATE");
    }
  }
  for (const occurrence of dataset.maintenanceOccurrences) {
    const parent = plan.get(entityKey("MaintenancePlan", String(occurrence.planId)));
    if (parent?.action === "SKIP") {
      setPlan(plan, "MaintenancePlanOccurrence", String(occurrence.id), "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "MaintenancePlanOccurrence", String(occurrence.id), "CREATE");
    }
  }
  for (const reading of dataset.meterReadings) {
    const prior = snapshot.priorRecords.get(entityKey("MeterReading", String(reading.id)));
    if (prior) {
      setPlan(plan, "MeterReading", String(reading.id), "SKIP", prior, "already_imported");
    } else {
      setPlan(plan, "MeterReading", String(reading.id), "CREATE");
    }
  }

  for (const document of dataset.documents) {
    const priorDocument = snapshot.priorRecords.get(
      entityKey("Document", String(document.id)),
    );
    if (priorDocument && policies.document !== "new") {
      setPlan(plan, "Document", String(document.id), "SKIP", priorDocument, "already_imported");
      parentSkipped.set(entityKey("Document", String(document.id)), true);
      continue;
    }
    const targetCustomer = targetCustomerFor(document.customerId);
    const targetProduct = plan.get(entityKey("Product", String(document.productId)))?.targetId;
    const hash = packageFileSha(document);
    const key =
      hash && (targetCustomer || targetProduct)
        ? `${targetCustomer ?? ""}:${targetProduct ?? ""}:${hash}`
        : "";
    const match = key ? snapshot.documentsByHashOwner.get(key) : undefined;
    if (match) {
      if (policies.document === "new") {
        setPlan(plan, "Document", String(document.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "Document", String(document.id), "SKIP", match, "duplicate");
        parentSkipped.set(entityKey("Document", String(document.id)), true);
      }
    } else {
      setPlan(plan, "Document", String(document.id), "CREATE");
    }
  }
  for (const version of dataset.documentVersions) {
    if (parentSkipped.get(entityKey("Document", String(version.documentId)))) {
      setPlan(plan, "DocumentVersion", String(version.id), "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "DocumentVersion", String(version.id), "CREATE");
    }
  }

  for (const upload of dataset.uploads) {
    const priorUpload = snapshot.priorRecords.get(
      entityKey("Upload", String(upload.id)),
    );
    if (priorUpload && policies.upload !== "new") {
      setPlan(plan, "Upload", String(upload.id), "SKIP", priorUpload, "already_imported");
      continue;
    }
    const hash = packageFileSha(upload);
    const targetOwner =
      upload.ownerType === "CUSTOMER"
        ? targetCustomerFor(upload.ownerId)
        : plan.get(entityKey(
            upload.ownerType === "WORK_ORDER"
              ? "WorkOrder"
              : upload.ownerType === "EQUIPMENT"
                ? "Product"
                : upload.ownerType === "CONTRACT"
                  ? "Contract"
                  : "Document",
            String(upload.ownerId),
          ))?.targetId;
    const key = hash && targetOwner ? `${upload.ownerType}:${targetOwner}:${hash}` : "";
    const match = key ? snapshot.uploadsByHashOwner.get(key) : undefined;
    if (match) {
      if (policies.upload === "new") {
        setPlan(plan, "Upload", String(upload.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "Upload", String(upload.id), "SKIP", match, "duplicate");
      }
    } else {
      setPlan(plan, "Upload", String(upload.id), "CREATE");
    }
  }

  for (const attachment of dataset.customerAttachments) {
    const priorAttachment = snapshot.priorRecords.get(
      entityKey("CustomerAttachment", String(attachment.id)),
    );
    if (priorAttachment && policies.upload !== "new") {
      setPlan(plan, "CustomerAttachment", String(attachment.id), "SKIP", priorAttachment, "already_imported");
      continue;
    }
    const targetCustomer = targetCustomerFor(attachment.customerId);
    const hash = packageFileSha(attachment);
    const key = hash && targetCustomer ? `${targetCustomer}:${hash}` : "";
    const match = key ? snapshot.uploadsByHashOwner.get(`CUSTOMER:${key}`) : undefined;
    if (match) {
      if (policies.upload === "new") {
        setPlan(plan, "CustomerAttachment", String(attachment.id), "CREATE", undefined, "explicit_new");
      } else {
        setPlan(plan, "CustomerAttachment", String(attachment.id), "SKIP", match, "duplicate");
      }
    } else {
      setPlan(plan, "CustomerAttachment", String(attachment.id), "CREATE");
    }
  }
  for (const attachment of dataset.attachments) {
    const priorAttachment = snapshot.priorRecords.get(
      entityKey("Attachment", String(attachment.id)),
    );
    if (priorAttachment && policies.upload !== "new") {
      setPlan(plan, "Attachment", String(attachment.id), "SKIP", priorAttachment, "already_imported");
      continue;
    }
    if (parentSkipped.get(entityKey("WorkOrder", String(attachment.workOrderId)))) {
      setPlan(plan, "Attachment", String(attachment.id), "SKIP", undefined, "parent_skipped");
    } else {
      setPlan(plan, "Attachment", String(attachment.id), "CREATE");
    }
  }

  const counts: Record<string, number> = {
    create: 0,
    skip: 0,
    update: 0,
    conflict: 0,
    invalid: 0,
  };
  const entities = [];
  for (const [key, value] of plan) {
    const separator = key.indexOf(":");
    const type = key.slice(0, separator);
    const sourceId = key.slice(separator + 1);
    entities.push({
      type,
      sourceId,
      action: value.action,
      ...(value.targetId ? { targetId: value.targetId } : {}),
      ...(value.reason ? { reason: value.reason } : {}),
    });
    if (value.action === "CREATE") counts.create += 1;
    else if (value.action === "SKIP") counts.skip += 1;
    else if (value.action === "UPDATE") counts.update += 1;
    else if (value.action === "CONFLICT") counts.conflict += 1;
    else counts.invalid += 1;
  }
  entities.sort((left, right) =>
    `${left.type}:${left.sourceId}` < `${right.type}:${right.sourceId}` ? -1 : 1,
  );

  // Fingeravtrykket dekker både oppdaterte kunder/utstyr og mengden av de
  // viktigste måltabellene. Det oppdager vanlige endringer mellom forhåndsvisning
  // og bekreftelse uten å lese hele databasen.
  const fingerprintCounts = await Promise.all([
    prisma.contact.count(),
    prisma.customerSite.count(),
    prisma.product.count(),
    prisma.equipmentQrCode.count(),
    prisma.contract.count(),
    prisma.workOrder.count(),
    prisma.report.count(),
    prisma.document.count(),
    prisma.upload.count(),
  ]);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        snapshot.customers
          .map((customer) => `${customer.id}:${customer.updatedAt.toISOString()}`)
          .sort(),
      ),
    )
    .update(
      JSON.stringify(
        [...snapshot.productsByCustomerSerial.values()]
          .map((product) => `${product.id}:${product.updatedAt.toISOString()}`)
          .sort(),
      ),
    )
    .update(JSON.stringify(fingerprintCounts))
    .digest("hex");

  return {
    entities,
    counts,
    warnings,
    errors,
    canImport: errors.length === 0,
    fingerprint,
    customers: customerPreview,
    snapshot,
    plan,
  };
}

/** Foreldre før barn; stabile bånd mellom søsken. */
export function orderByHierarchy(rows: TransferRow[]): TransferRow[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const result: TransferRow[] = [];
  const seen = new Set<string>();
  const visit = (row: TransferRow, guard: number) => {
    const id = String(row.id);
    if (seen.has(id) || guard > rows.length + 1) return;
    if (row.parentId && byId.has(String(row.parentId))) {
      visit(byId.get(String(row.parentId)) as TransferRow, guard + 1);
    }
    if (seen.has(id)) return;
    seen.add(id);
    result.push(row);
  };
  for (const row of [...rows].sort((left, right) =>
    String(left.id) < String(right.id) ? -1 : 1,
  )) {
    visit(row, 0);
  }
  return result;
}

export type { PlanMap };
