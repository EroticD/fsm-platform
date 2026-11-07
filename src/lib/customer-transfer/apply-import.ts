/* eslint-disable @typescript-eslint/no-explicit-any */
// i18n-ignore-file: importmotoren skriver data og stabile feilkoder, ikke UI.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { uploadDir } from "@/lib/uploads";
import { writeFinalFilesLedger } from "./reconcile";
import { isValidExternalQrValue, normalizeExternalQrValue } from "@/lib/equipment-qr";
import { generateWorkOrderReference } from "@/lib/work-order-reference";
import { toAuditActor, type ServiceActor } from "@/server/actor";
import {
  TRANSFER_ERROR,
  TRANSFER_LIMITS,
  type ConflictPolicies,
  type TransferIssue,
} from "./constants";
import { analysePackage, entityKey, orderByHierarchy } from "./analyse";
import {
  normaliseCustomerNumber,
  normaliseName,
  normaliseOrgNumber,
  normalisePath,
  normaliseSerial,
} from "./normalise";
import type {
  ImportAnalysis,
  ImportOptions,
  PackageReadResult,
} from "./types";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOr(value: unknown, fallback: Date): Date {
  return dateOrNull(value) ?? fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function extensionForMime(mime: string): string {
  return (
    {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    }[mime] ?? "bin"
  );
}

type PendingFile = {
  storedName: string;
  absolutePath: string;
  data: Buffer;
};

type AnalysisResult = Awaited<ReturnType<typeof analysePackage>>;

type ApplyContext = {
  tx: Tx;
  actor: ServiceActor;
  jobId: string;
  read: PackageReadResult;
  analysis: AnalysisResult;
  policies: ConflictPolicies;
  options: ImportOptions;
  targets: Map<string, string>;
  pendingFiles: PendingFile[];
  errors: TransferIssue[];
  affectedCustomers: string[];
  affectedDepartments: Set<string>;
};

function targetFor(ctx: ApplyContext, type: string, sourceId: unknown): string | undefined {
  if (typeof sourceId !== "string" || !sourceId) return undefined;
  return (
    ctx.targets.get(entityKey(type, sourceId)) ??
    ctx.analysis.plan.get(entityKey(type, sourceId))?.targetId
  );
}

function planFor(ctx: ApplyContext, type: string, sourceId: unknown) {
  if (typeof sourceId !== "string") return undefined;
  return ctx.analysis.plan.get(entityKey(type, sourceId));
}

function mapIds(
  ctx: ApplyContext,
  type: string,
  values: unknown,
): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => targetFor(ctx, type, value))
    .filter((value): value is string => Boolean(value));
}

function allocateFile(
  ctx: ApplyContext,
  packagePath: unknown,
): { storedName: string; url: string; data: Buffer; mimeType: string } | null {
  if (typeof packagePath !== "string") return null;
  const data = ctx.read.files.get(packagePath);
  if (!data) return null;
  const entry = ctx.read.fileEntries.find((file) => file.path === packagePath);
  if (!entry) return null;
  const storedName = `${crypto.randomUUID()}.${extensionForMime(entry.mimeType)}`;
  const absolutePath = path.join(uploadDir(), storedName);
  ctx.pendingFiles.push({ storedName, absolutePath, data });
  return {
    storedName,
    url: `/uploads/${storedName}`,
    data,
    mimeType: entry.mimeType,
  };
}

async function movePendingFiles(pending: PendingFile[]): Promise<string[]> {
  const moved: string[] = [];
  await fs.mkdir(uploadDir(), { recursive: true, mode: 0o700 });
  for (const file of pending) {
    const handle = await fs.open(file.absolutePath, "wx", 0o600);
    try {
      await handle.writeFile(file.data);
    } finally {
      await handle.close();
    }
    moved.push(file.absolutePath);
  }
  return moved;
}

async function deleteFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((filePath) => fs.unlink(filePath).catch(() => undefined)),
  );
}

async function createReferences(ctx: ApplyContext) {
  const { tx, analysis, read } = ctx;
  const dataset = read.dataset;

  // Avdelinger
  for (const department of dataset.departments) {
    const plan = planFor(ctx, "Department", department.id);
    const name = String(department.name);
    if (plan?.targetId) {
      ctx.targets.set(entityKey("Department", String(department.id)), plan.targetId);
    } else if (plan?.action === "CREATE") {
      const existing = analysis.snapshot.departmentsByName.get(normaliseName(name));
      if (existing) {
        ctx.targets.set(entityKey("Department", String(department.id)), existing);
      } else {
        const created = await tx.department.create({
          data: {
            name,
            description: stringOrNull(department.description),
            isActive: boolOr(department.isActive, true),
          } as any,
          select: { id: true },
        });
        ctx.targets.set(entityKey("Department", String(department.id)), created.id);
      }
    }
  }

  // Ansatte og maler: aldri opprett.
  for (const user of dataset.users) {
    const plan = planFor(ctx, "User", user.id);
    if (plan?.targetId) {
      ctx.targets.set(entityKey("User", String(user.id)), plan.targetId);
    }
  }
  for (const template of dataset.templates) {
    const plan = planFor(ctx, "Template", template.id);
    if (plan?.targetId) {
      ctx.targets.set(entityKey("Template", String(template.id)), plan.targetId);
    }
  }
  for (const policy of dataset.slaPolicies) {
    const plan = planFor(ctx, "SlaPolicy", policy.id);
    if (plan?.targetId) {
      ctx.targets.set(entityKey("SlaPolicy", String(policy.id)), plan.targetId);
    }
  }
  for (const list of dataset.priceLists) {
    const plan = planFor(ctx, "PriceList", list.id);
    if (plan?.targetId) {
      ctx.targets.set(entityKey("PriceList", String(list.id)), plan.targetId);
    }
  }

  // Tags og dokumenttags
  for (const [type, rows] of [
    ["Tag", dataset.tags],
    ["DocumentTag", dataset.documentTags],
  ] as const) {
    for (const row of rows) {
      const plan = planFor(ctx, type, row.id);
      if (plan?.targetId) {
        ctx.targets.set(entityKey(type, String(row.id)), plan.targetId);
      } else if (plan?.action === "CREATE") {
        const created =
          type === "Tag"
            ? await tx.tag.create({
                data: {
                  name: String(row.name),
                  color: stringOrNull(row.color) ?? "#3b82f6",
                } as any,
                select: { id: true },
              })
            : await tx.documentTag.create({
                data: {
                  name: String(row.name),
                  color: stringOrNull(row.color) ?? "#3b82f6",
                } as any,
                select: { id: true },
              });
        ctx.targets.set(entityKey(type, String(row.id)), created.id);
      }
    }
  }

  // Kategoritre: foreldre først. Stien er normalisert uten kjøring mot DB.
  const sourceCategoryPaths = new Map<string, string>();
  {
    const rows = dataset.equipmentCategories as Array<{
      id: string;
      name: string;
      parentId: string | null;
    }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows) {
      const segments: string[] = [];
      let current: typeof row | undefined = row;
      let guard = 0;
      while (current && guard < 64) {
        segments.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
        guard += 1;
      }
      sourceCategoryPaths.set(row.id, normalisePath(segments.join("/")));
    }
  }
  for (const category of orderByHierarchy(dataset.equipmentCategories)) {
    const plan = planFor(ctx, "EquipmentCategory", category.id);
    if (plan?.targetId) {
      ctx.targets.set(
        entityKey("EquipmentCategory", String(category.id)),
        plan.targetId,
      );
    } else if (plan?.action === "CREATE") {
      const parentId = targetFor(ctx, "EquipmentCategory", category.parentId) ?? null;
      const created = await tx.equipmentCategory.create({
        data: { name: String(category.name), parentId } as any,
        select: { id: true },
      });
      ctx.targets.set(
        entityKey("EquipmentCategory", String(category.id)),
        created.id,
      );
    }
  }

  // Dokumentmapper: samme mønster.
  for (const folder of orderByHierarchy(dataset.documentFolders)) {
    const plan = planFor(ctx, "DocumentFolder", folder.id);
    if (plan?.targetId) {
      ctx.targets.set(entityKey("DocumentFolder", String(folder.id)), plan.targetId);
    } else if (plan?.action === "CREATE") {
      const parentId = targetFor(ctx, "DocumentFolder", folder.parentId) ?? null;
      const created = await tx.documentFolder.create({
        data: { name: String(folder.name), parentId } as any,
        select: { id: true },
      });
      ctx.targets.set(entityKey("DocumentFolder", String(folder.id)), created.id);
    }
  }
  void sourceCategoryPaths;
}

async function importCustomers(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const customer of read.dataset.customers) {
    const plan = planFor(ctx, "Customer", customer.id);
    const departmentId = targetFor(ctx, "Department", customer.departmentId) ?? null;
    const responsibleTechnicianId =
      targetFor(ctx, "User", customer.responsibleTechnicianId) ?? null;
    const data = {
      name: String(customer.name),
      customerNumber: stringOrNull(customer.customerNumber),
      orgNumber: stringOrNull(customer.orgNumber),
      brandColor: stringOrNull(customer.brandColor),
      logoUrl: null,
      address: stringOrNull(customer.address),
      postalCode: stringOrNull(customer.postalCode),
      city: stringOrNull(customer.city),
      phone: stringOrNull(customer.phone),
      email: stringOrNull(customer.email),
      notes: stringOrNull(customer.notes),
      departmentId,
      responsibleTechnicianId,
      deletedAt: dateOrNull(customer.deletedAt),
      deletedBy: stringOrNull(customer.deletedBy),
      ...(dateOrNull(customer.createdAt)
        ? { createdAt: dateOrNull(customer.createdAt) as Date }
        : {}),
    };

    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("Customer", String(customer.id)), plan.targetId);
      if (departmentId) ctx.affectedDepartments.add(departmentId);
      continue;
    }
    if (plan?.action === "UPDATE" && plan.targetId) {
      const logo = allocateFile(ctx, customer.logoFile);
      // Bare trygge, muterbare felter. Identitet (org.nr/kundenummer),
      // sletting og revisjonsspor endres ikke av en import. Eksterne logo-URL-er
      // importeres aldri; bare en fil som faktisk ligger i pakken.
      const updated = await tx.customer.update({
        where: { id: plan.targetId },
        data: {
          name: String(customer.name),
          brandColor: stringOrNull(customer.brandColor),
          logoUrl: logo?.url ?? null,
          address: stringOrNull(customer.address),
          postalCode: stringOrNull(customer.postalCode),
          city: stringOrNull(customer.city),
          phone: stringOrNull(customer.phone),
          email: stringOrNull(customer.email),
          notes: stringOrNull(customer.notes),
          departmentId,
          responsibleTechnicianId,
        } as any,
        select: { id: true },
      });
      ctx.targets.set(entityKey("Customer", String(customer.id)), updated.id);
      ctx.affectedCustomers.push(updated.id);
      if (departmentId) ctx.affectedDepartments.add(departmentId);
      continue;
    }
    // Analysebildet kan være utdatert hvis to importer av samme pakke
    // konkurrerer. Etter rad-/advisory-låsen slår vi opp forretningsnøkkelen på
    // nytt, slik at vi hopper over i stedet for å lage en duplikatkunde.
    if (ctx.policies.customer !== "new") {
      const org = normaliseOrgNumber(customer.orgNumber);
      const number = normaliseCustomerNumber(customer.customerNumber);
      const candidates = [
        stringOrNull(customer.orgNumber),
        stringOrNull(customer.customerNumber),
        org || null,
        number || null,
      ].filter((value): value is string => Boolean(value));
      if (candidates.length > 0) {
        const matches = await tx.customer.findMany({
          where: {
            OR: [
              { orgNumber: { in: candidates } },
              { customerNumber: { in: candidates } },
            ],
          },
          select: { id: true, orgNumber: true, customerNumber: true },
          take: 10,
        });
        const match = matches.find(
          (candidate) =>
            (org && normaliseOrgNumber(candidate.orgNumber) === org) ||
            (number &&
              normaliseCustomerNumber(candidate.customerNumber) === number),
        );
        if (match) {
          ctx.targets.set(entityKey("Customer", String(customer.id)), match.id);
          ctx.analysis.plan.set(entityKey("Customer", String(customer.id)), {
            action: "SKIP",
            targetId: match.id,
            reason: "duplicate",
          });
          if (departmentId) ctx.affectedDepartments.add(departmentId);
          continue;
        }
      }
    }
    const logo = allocateFile(ctx, customer.logoFile);
    const created = await tx.customer.create({
      data: { ...data, logoUrl: logo?.url ?? null } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Customer", String(customer.id)), created.id);
    ctx.affectedCustomers.push(created.id);
    if (departmentId) ctx.affectedDepartments.add(departmentId);
  }
}

async function importContactsAndSites(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const contact of read.dataset.contacts) {
    const plan = planFor(ctx, "Contact", contact.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("Contact", String(contact.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", contact.customerId);
    if (!customerId) continue;
    const created = await tx.contact.create({
      data: {
        name: String(contact.name),
        email: stringOrNull(contact.email),
        phone: stringOrNull(contact.phone),
        role: stringOrNull(contact.role),
        locale: stringOrNull(contact.locale) ?? "nb",
        customerId,
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Contact", String(contact.id)), created.id);
  }

  for (const delegation of read.dataset.portalDelegations) {
    const contactId = targetFor(ctx, "Contact", delegation.contactId);
    const contactPlan = planFor(ctx, "Contact", delegation.contactId);
    if (!contactId || contactPlan?.action === "SKIP") continue;
    await tx.portalDelegation.create({
      data: {
        contactId,
        canBook: boolOr(delegation.canBook, false),
        canViewDocuments: boolOr(delegation.canViewDocuments, false),
        canViewContracts: boolOr(delegation.canViewContracts, false),
        canViewEquipment: boolOr(delegation.canViewEquipment, true),
        isActive: boolOr(delegation.isActive, true),
      } as any,
    });
  }

  for (const user of read.dataset.portalUsers) {
    const plan = planFor(ctx, "PortalUser", user.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("PortalUser", String(user.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", user.customerId);
    if (!customerId) continue;
    const created = await tx.user.create({
      data: {
        name: stringOrNull(user.name),
        email: stringOrNull(user.email),
        phone: stringOrNull(user.phone),
        role: "CUSTOMER",
        // Importerte portalerbrukere er alltid deaktiverte og uten passord.
        isActive: false,
        password: null,
        resetToken: null,
        resetTokenExpiry: null,
        emailVerified: null,
        locale: stringOrNull(user.locale) ?? "nb",
        customerId,
        contactId: targetFor(ctx, "Contact", user.contactId) ?? null,
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("PortalUser", String(user.id)), created.id);
  }

  for (const site of read.dataset.sites) {
    const plan = planFor(ctx, "CustomerSite", site.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("CustomerSite", String(site.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", site.customerId);
    if (!customerId) continue;
    const created = await tx.customerSite.create({
      data: {
        customerId,
        name: String(site.name),
        address: stringOrNull(site.address),
        postalCode: stringOrNull(site.postalCode),
        city: stringOrNull(site.city),
        latitude: numberOrNull(site.latitude),
        longitude: numberOrNull(site.longitude),
        isPrimary: boolOr(site.isPrimary, false),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("CustomerSite", String(site.id)), created.id);
  }
}

async function importEquipment(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const product of orderByHierarchy(read.dataset.products)) {
    const plan = planFor(ctx, "Product", product.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("Product", String(product.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", product.customerId);
    if (!customerId) continue;
    const shared = {
      model: String(product.model),
      serialNumber: stringOrNull(product.serialNumber),
      location: stringOrNull(product.location),
      siteId: targetFor(ctx, "CustomerSite", product.siteId) ?? null,
      categoryId: targetFor(ctx, "EquipmentCategory", product.categoryId) ?? null,
      parentId: targetFor(ctx, "Product", product.parentId) ?? null,
      status: (stringOrNull(product.status) ?? "ACTIVE") as any,
      criticality: numberOrNull(product.criticality) ?? 2,
      meterUnit: stringOrNull(product.meterUnit),
      installDate: dateOrNull(product.installDate),
      warrantyUntil: dateOrNull(product.warrantyUntil),
      warrantyNotifiedAt: dateOrNull(product.warrantyNotifiedAt),
    };
    if (plan?.action === "UPDATE" && plan.targetId) {
      const updated = await tx.product.update({
        where: { id: plan.targetId },
        data: {
          model: shared.model,
          location: shared.location,
          siteId: shared.siteId,
          categoryId: shared.categoryId,
          criticality: shared.criticality,
          meterUnit: shared.meterUnit,
          installDate: shared.installDate,
          warrantyUntil: shared.warrantyUntil,
        } as any,
        select: { id: true },
      });
      ctx.targets.set(entityKey("Product", String(product.id)), updated.id);
      continue;
    }
    // Analysen kan være utdatert under en samtidig import. Slå opp
    // (kunde, serienummer) på nytt før vi oppretter en duplikat.
    if (ctx.policies.equipment !== "new" && shared.serialNumber) {
      const serial = normaliseSerial(shared.serialNumber);
      const candidates = await tx.product.findMany({
        where: { customerId },
        select: {
          id: true,
          serialNumber: true,
          model: true,
          location: true,
          siteId: true,
          categoryId: true,
          criticality: true,
          meterUnit: true,
          installDate: true,
          warrantyUntil: true,
        },
        take: 5000,
      });
      const match = candidates.find(
        (candidate) => normaliseSerial(candidate.serialNumber) === serial,
      );
      if (match) {
        if (ctx.policies.equipment === "update") {
          await tx.product.update({
            where: { id: match.id },
            data: {
              model: shared.model,
              location: shared.location,
              siteId: shared.siteId,
              categoryId: shared.categoryId,
              criticality: shared.criticality,
              meterUnit: shared.meterUnit,
              installDate: shared.installDate,
              warrantyUntil: shared.warrantyUntil,
            } as any,
          });
        }
        ctx.targets.set(entityKey("Product", String(product.id)), match.id);
        ctx.analysis.plan.set(entityKey("Product", String(product.id)), {
          action: ctx.policies.equipment === "update" ? "UPDATE" : "SKIP",
          targetId: match.id,
          reason: "duplicate",
        });
        continue;
      }
    }
    // qrToken settes bevisst aldri: en gammel QR-etikett skal ikke peke på
    // feil fysisk enhet i målinstallasjonen.
    const created = await tx.product.create({
      data: { ...shared, customerId, qrToken: null } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Product", String(product.id)), created.id);
  }

  // Eksisterende QR-koder importeres etter enhetene. Kilden settes til
  // IMPORT, og Product.qrToken er fortsatt alltid tom ved import.
  for (const code of read.dataset.equipmentQrCodes) {
    const plan = planFor(ctx, "EquipmentQrCode", code.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(
        entityKey("EquipmentQrCode", String(code.id)),
        plan.targetId,
      );
      continue;
    }
    const productId = targetFor(ctx, "Product", code.productId);
    const value = normalizeExternalQrValue(code.value);
    if (!productId || !isValidExternalQrValue(value)) continue;
    const created = await tx.equipmentQrCode.create({
      data: {
        productId,
        value,
        normalizedValue: value,
        label: stringOrNull(code.label),
        source: "IMPORT",
        createdById: targetFor(ctx, "User", code.createdById) ?? null,
        createdAt: dateOr(code.createdAt, new Date()),
        lastScannedAt: dateOrNull(code.lastScannedAt),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(
      entityKey("EquipmentQrCode", String(code.id)),
      created.id,
    );
  }

  for (const reading of read.dataset.meterReadings) {
    const plan = planFor(ctx, "MeterReading", reading.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("MeterReading", String(reading.id)), plan.targetId);
      continue;
    }
    const productId = targetFor(ctx, "Product", reading.productId);
    if (!productId) continue;
    const created = await tx.meterReading.create({
      data: {
        productId,
        value: String(reading.value),
        readAt: dateOr(reading.readAt, new Date()),
        source: stringOrNull(reading.source) ?? "MANUAL",
        visitId: targetFor(ctx, "Visit", reading.visitId) ?? null,
        userId: targetFor(ctx, "User", reading.userId) ?? null,
        note: stringOrNull(reading.note),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("MeterReading", String(reading.id)), created.id);
  }

  for (const maintenancePlan of read.dataset.maintenancePlans) {
    const plan = planFor(ctx, "MaintenancePlan", maintenancePlan.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("MaintenancePlan", String(maintenancePlan.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", maintenancePlan.customerId);
    const departmentId = targetFor(ctx, "Department", maintenancePlan.departmentId);
    if (!customerId || !departmentId) continue;
    const created = await tx.maintenancePlan.create({
      data: {
        title: String(maintenancePlan.title),
        trigger: (stringOrNull(maintenancePlan.trigger) ?? "CALENDAR") as any,
        intervalMonths: numberOrNull(maintenancePlan.intervalMonths),
        meterInterval: stringOrNull(maintenancePlan.meterInterval),
        leadDays: numberOrNull(maintenancePlan.leadDays) ?? 14,
        nextDueDate: dateOrNull(maintenancePlan.nextDueDate),
        lastMeterValue: stringOrNull(maintenancePlan.lastMeterValue),
        isActive: boolOr(maintenancePlan.isActive, true),
        productId: targetFor(ctx, "Product", maintenancePlan.productId) ?? null,
        customerId,
        departmentId,
        templateId: targetFor(ctx, "Template", maintenancePlan.templateId) ?? null,
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("MaintenancePlan", String(maintenancePlan.id)), created.id);
  }

  for (const occurrence of read.dataset.maintenanceOccurrences) {
    const plan = planFor(ctx, "MaintenancePlanOccurrence", occurrence.id);
    if (plan?.action === "SKIP") continue;
    const planId = targetFor(ctx, "MaintenancePlan", occurrence.planId);
    if (!planId) continue;
    const created = await tx.maintenancePlanOccurrence.create({
      data: {
        planId,
        dueDate: dateOr(occurrence.dueDate, new Date()),
        status: stringOrNull(occurrence.status) ?? "PENDING",
        workOrderId: targetFor(ctx, "WorkOrder", occurrence.workOrderId) ?? null,
        meterValue: stringOrNull(occurrence.meterValue),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("MaintenancePlanOccurrence", String(occurrence.id)), created.id);
  }
}

async function importContracts(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const contract of read.dataset.contracts) {
    const plan = planFor(ctx, "Contract", contract.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("Contract", String(contract.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", contract.customerId);
    const departmentId = targetFor(ctx, "Department", contract.departmentId);
    if (!customerId || !departmentId) continue;
    let contractNumber = stringOrNull(contract.contractNumber);
    if (contractNumber) {
      const clash = await tx.contract.findFirst({
        where: { contractNumber },
        select: { id: true },
      });
      if (clash) {
        contractNumber = `${contractNumber}-IMP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      }
    }
    const created = await tx.contract.create({
      data: {
        title: String(contract.title),
        contractNumber,
        intervalMonths: numberOrNull(contract.intervalMonths) ?? 12,
        startDate: dateOr(contract.startDate, new Date()),
        endDate: dateOrNull(contract.endDate),
        nextServiceDate: dateOr(contract.nextServiceDate, new Date()),
        status: (stringOrNull(contract.status) ?? "ACTIVE") as any,
        isActive: boolOr(contract.isActive, true),
        renewalMode: (stringOrNull(contract.renewalMode) ?? "MANUAL") as any,
        noticeDays: numberOrNull(contract.noticeDays) ?? 30,
        indexationPercent: stringOrNull(contract.indexationPercent),
        customerId,
        departmentId,
        contactId: targetFor(ctx, "Contact", contract.contactId) ?? null,
        templateId: targetFor(ctx, "Template", contract.templateId) ?? null,
        slaPolicyId: targetFor(ctx, "SlaPolicy", contract.slaPolicyId) ?? null,
        priceListId: targetFor(ctx, "PriceList", contract.priceListId) ?? null,
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Contract", String(contract.id)), created.id);
    ctx.affectedDepartments.add(departmentId);
  }

  for (const line of read.dataset.contractLines) {
    const plan = planFor(ctx, "ContractLine", line.id);
    if (plan?.action === "SKIP") continue;
    const contractId = targetFor(ctx, "Contract", line.contractId);
    if (!contractId) continue;
    const created = await tx.contractLine.create({
      data: {
        contractId,
        productId: targetFor(ctx, "Product", line.productId) ?? null,
        scope: stringOrNull(line.scope) ?? "",
        visitsPerYear: numberOrNull(line.visitsPerYear),
        responseMinutes: numberOrNull(line.responseMinutes),
        resolutionMinutes: numberOrNull(line.resolutionMinutes),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("ContractLine", String(line.id)), created.id);
  }
}

async function importWorkOrders(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const order of read.dataset.workOrders) {
    const plan = planFor(ctx, "WorkOrder", order.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("WorkOrder", String(order.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", order.customerId) ?? null;
    const departmentId = targetFor(ctx, "Department", order.departmentId);
    if (!departmentId) continue;
    let reference = stringOrNull(order.reference) ?? generateWorkOrderReference();
    const clash = await tx.workOrder.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (clash) reference = generateWorkOrderReference();
    let orderNumberNormalized = stringOrNull(order.orderNumberNormalized);
    if (orderNumberNormalized) {
      const numberClash = await tx.workOrder.findFirst({
        where: { departmentId, orderNumberNormalized },
        select: { id: true },
      });
      if (numberClash) orderNumberNormalized = null;
    }
    const tagIds = mapIds(ctx, "Tag", order.tagIds);
    const templateIds = mapIds(ctx, "Template", order.templateIds);
    const technicianIds = mapIds(ctx, "User", order.technicianIds);
    const created = await tx.workOrder.create({
      data: {
        title: String(order.title),
        reference,
        orderNumber: stringOrNull(order.orderNumber),
        orderNumberNormalized,
        description: stringOrNull(order.description),
        address: stringOrNull(order.address),
        postalCode: stringOrNull(order.postalCode),
        city: stringOrNull(order.city),
        latitude: numberOrNull(order.latitude),
        longitude: numberOrNull(order.longitude),
        geoAddressHash: stringOrNull(order.geoAddressHash),
        scheduledFor: dateOrNull(order.scheduledFor),
        scheduledTo: dateOrNull(order.scheduledTo),
        status: (stringOrNull(order.status) ?? "PLANNED") as any,
        creatorName: stringOrNull(order.creatorName),
        deletedAt: dateOrNull(order.deletedAt),
        deletedBy: stringOrNull(order.deletedBy),
        legalHold: boolOr(order.legalHold, false),
        departmentId,
        customerId,
        siteId: targetFor(ctx, "CustomerSite", order.siteId) ?? null,
        productId: targetFor(ctx, "Product", order.productId) ?? null,
        contactId: targetFor(ctx, "Contact", order.contactId) ?? null,
        contractId: targetFor(ctx, "Contract", order.contractId) ?? null,
        ...(tagIds.length ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
        ...(templateIds.length
          ? { templates: { connect: templateIds.map((id) => ({ id })) } }
          : {}),
        ...(technicianIds.length
          ? { technicians: { connect: technicianIds.map((id) => ({ id })) } }
          : {}),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("WorkOrder", String(order.id)), created.id);
    ctx.affectedDepartments.add(departmentId);
    if (customerId) ctx.affectedCustomers.push(customerId);
  }

  for (const visit of read.dataset.visits) {
    const plan = planFor(ctx, "Visit", visit.id);
    if (plan?.action === "SKIP") continue;
    const workOrderId = targetFor(ctx, "WorkOrder", visit.workOrderId);
    if (!workOrderId) continue;
    const created = await tx.visit.create({
      data: {
        workOrderId,
        sequence: numberOrNull(visit.sequence) ?? 0,
        startsAt: dateOr(visit.startsAt, new Date()),
        endsAt: dateOr(visit.endsAt, new Date()),
        allDay: boolOr(visit.allDay, false),
        status: (stringOrNull(visit.status) ?? "PLANNED") as any,
        notes: stringOrNull(visit.notes),
        enRouteAt: dateOrNull(visit.enRouteAt),
        onSiteAt: dateOrNull(visit.onSiteAt),
        doneAt: dateOrNull(visit.doneAt),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Visit", String(visit.id)), created.id);
  }

  for (const link of read.dataset.visitTechnicians) {
    const visitPlan = planFor(ctx, "VisitTechnician", `${link.visitId}:${link.userId}`);
    if (visitPlan?.action === "SKIP") continue;
    const visitId = targetFor(ctx, "Visit", link.visitId);
    const userId = targetFor(ctx, "User", link.userId);
    if (!visitId || !userId) continue;
    await tx.visitTechnician.create({
      data: { visitId, userId } as any,
    });
  }

  for (const comment of read.dataset.comments) {
    const plan = planFor(ctx, "Comment", comment.id);
    if (plan?.action === "SKIP") continue;
    const workOrderId = targetFor(ctx, "WorkOrder", comment.workOrderId) ?? null;
    const customerId = targetFor(ctx, "Customer", comment.customerId) ?? null;
    if (!workOrderId && !customerId) continue;
    await tx.comment.create({
      data: {
        content: String(comment.content),
        authorName: stringOrNull(comment.authorName),
        workOrderId,
        customerId,
        contactId: targetFor(ctx, "Contact", comment.contactId) ?? null,
        createdAt: dateOr(comment.createdAt, new Date()),
      } as any,
    });
  }
}

async function importReports(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const report of read.dataset.reports) {
    const plan = planFor(ctx, "Report", report.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("Report", String(report.id)), plan.targetId);
      continue;
    }
    const workOrderId = targetFor(ctx, "WorkOrder", report.workOrderId);
    if (!workOrderId) continue;
    const order = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { departmentId: true, customerId: true },
    });
    const pdf = allocateFile(ctx, report.pdfFile);
    if (pdf) {
      await tx.upload.create({
        data: {
          storedName: pdf.storedName,
          originalName: "rapport.pdf",
          mimeType: "application/pdf",
          size: pdf.data.length,
          ownerType: "WORK_ORDER",
          ownerId: workOrderId,
          departmentId: order?.departmentId ?? null,
          customerId: order?.customerId ?? null,
          uploadedById: ctx.actor.id,
          contentHash: crypto.createHash("sha256").update(pdf.data).digest("hex"),
        } as any,
      });
    }
    const technicianSignature = allocateFile(ctx, report.technicianSignatureFile);
    const customerSignature = allocateFile(ctx, report.customerSignatureFile);
    let templateId = targetFor(ctx, "Template", report.templateId) ?? null;
    if (templateId) {
      const templateClash = await tx.report.findFirst({
        where: { workOrderId, templateId },
        select: { id: true },
      });
      if (templateClash) templateId = null;
    }
    let reportNumber = stringOrNull(report.reportNumber);
    if (reportNumber) {
      const numberClash = await tx.report.findFirst({
        where: { reportNumber },
        select: { id: true },
      });
      if (numberClash) reportNumber = null;
    }
    const created = await tx.report.create({
      data: {
        dataJson: String(report.dataJson ?? "{}"),
        comments: stringOrNull(report.comments),
        completedAt: dateOr(report.completedAt, new Date()),
        technicianSignatureUrl: technicianSignature?.url ?? null,
        technicianName: stringOrNull(report.technicianName),
        customerSignatureUrl: customerSignature?.url ?? null,
        customerName: stringOrNull(report.customerName),
        workOrderId,
        templateId,
        templateTitle: stringOrNull(report.templateTitle),
        name: stringOrNull(report.name),
        reportNumber,
        requiresUnits: boolOr(report.requiresUnits, true),
        templateCategory: (stringOrNull(report.templateCategory) ?? "SERVICE") as any,
        hmsType: (stringOrNull(report.hmsType) ?? null) as any,
        templateSnapshotJson: stringOrNull(report.templateSnapshotJson),
        isLocked: boolOr(report.isLocked, false),
        lockedAt: dateOrNull(report.lockedAt),
        lockedByName: stringOrNull(report.lockedByName),
        pdfUrl: pdf?.url ?? null,
        pdfHash: stringOrNull(report.pdfHash),
        pdfGeneratedAt: dateOrNull(report.pdfGeneratedAt),
        customerAcknowledgedAt: dateOrNull(report.customerAcknowledgedAt),
        customerAcknowledgedBy: stringOrNull(report.customerAcknowledgedBy),
        customerAcknowledgedComment: stringOrNull(report.customerAcknowledgedComment),
        revision: numberOrNull(report.revision) ?? 0,
        deletedAt: dateOrNull(report.deletedAt),
        deletedBy: stringOrNull(report.deletedBy),
        legalHold: boolOr(report.legalHold, false),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Report", String(report.id)), created.id);
  }

  for (const unit of read.dataset.reportUnits) {
    const plan = planFor(ctx, "ReportUnit", unit.id);
    if (plan?.action === "SKIP") continue;
    const reportId = targetFor(ctx, "Report", unit.reportId);
    if (!reportId) continue;
    const created = await tx.reportUnit.create({
      data: {
        reportId,
        label: String(unit.label),
        serialNumber: stringOrNull(unit.serialNumber),
        location: stringOrNull(unit.location),
        status: stringOrNull(unit.status) ?? "GODKJENT",
        answersJson: stringOrNull(unit.answersJson) ?? "{}",
        comment: stringOrNull(unit.comment),
        productId: targetFor(ctx, "Product", unit.productId) ?? null,
        sortOrder: numberOrNull(unit.sortOrder) ?? 0,
        createdAt: dateOr(unit.createdAt, new Date()),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("ReportUnit", String(unit.id)), created.id);
  }

  for (const revision of read.dataset.reportRevisions) {
    const plan = planFor(ctx, "ReportRevision", revision.id);
    if (plan?.action === "SKIP") continue;
    const reportId = targetFor(ctx, "Report", revision.reportId);
    if (!reportId) continue;
    const technicianSignature = allocateFile(ctx, revision.technicianSignatureFile);
    const customerSignature = allocateFile(ctx, revision.customerSignatureFile);
    const created = await tx.reportRevision.create({
      data: {
        reportId,
        revision: numberOrNull(revision.revision) ?? 0,
        dataJson: String(revision.dataJson ?? "{}"),
        unitsJson: String(revision.unitsJson ?? "[]"),
        comments: stringOrNull(revision.comments),
        templateTitle: stringOrNull(revision.templateTitle),
        name: stringOrNull(revision.name),
        reportNumber: stringOrNull(revision.reportNumber),
        requiresUnits: boolOr(revision.requiresUnits, true),
        templateCategory: (stringOrNull(revision.templateCategory) ?? "SERVICE") as any,
        hmsType: (stringOrNull(revision.hmsType) ?? null) as any,
        completedAt: dateOrNull(revision.completedAt),
        templateSnapshotJson: stringOrNull(revision.templateSnapshotJson),
        technicianSignatureUrl: technicianSignature?.url ?? null,
        customerSignatureUrl: customerSignature?.url ?? null,
        technicianName: stringOrNull(revision.technicianName),
        customerName: stringOrNull(revision.customerName),
        customerAcknowledgedAt: dateOrNull(revision.customerAcknowledgedAt),
        customerAcknowledgedBy: stringOrNull(revision.customerAcknowledgedBy),
        customerAcknowledgedComment: stringOrNull(revision.customerAcknowledgedComment),
        reason: stringOrNull(revision.reason),
        createdById: targetFor(ctx, "User", revision.createdById) ?? null,
        createdAt: dateOr(revision.createdAt, new Date()),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("ReportRevision", String(revision.id)), created.id);
  }
}

function dataUrlFromFile(file: { data: Buffer; mimeType: string }): string {
  return `data:${file.mimeType};base64,${file.data.toString("base64")}`;
}

async function importDocuments(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const document of read.dataset.documents) {
    const plan = planFor(ctx, "Document", document.id);
    if (plan?.action === "SKIP" && plan.targetId) {
      ctx.targets.set(entityKey("Document", String(document.id)), plan.targetId);
      continue;
    }
    const customerId = targetFor(ctx, "Customer", document.customerId) ?? null;
    const productId = targetFor(ctx, "Product", document.productId) ?? null;
    if (!customerId && !productId) continue;
    const file = allocateFile(ctx, document.packagePath);
    const created = await tx.document.create({
      data: {
        title: String(document.title),
        description: stringOrNull(document.description),
        fileName: String(document.fileName),
        filePath: file?.url ?? "",
        fileSize: file?.data.length ?? numberOrNull(document.fileSize) ?? 0,
        mimeType: file?.mimeType ?? stringOrNull(document.mimeType) ?? "application/pdf",
        contentText: stringOrNull(document.contentText),
        pageTexts: stringOrNull(document.pageTexts),
        folderId: targetFor(ctx, "DocumentFolder", document.folderId) ?? null,
        customerId,
        productId,
        uploadedBy: stringOrNull(document.uploadedBy),
        deletedAt: dateOrNull(document.deletedAt),
        deletedBy: stringOrNull(document.deletedBy),
        ...(mapIds(ctx, "DocumentTag", document.tagIds).length
          ? {
              tags: {
                connect: mapIds(ctx, "DocumentTag", document.tagIds).map((id) => ({ id })),
              },
            }
          : {}),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Document", String(document.id)), created.id);
    if (file) {
      await tx.upload.create({
        data: {
          storedName: file.storedName,
          originalName: String(document.fileName),
          mimeType: file.mimeType,
          size: file.data.length,
          ownerType: "DOCUMENT",
          ownerId: created.id,
          customerId,
          uploadedById: ctx.actor.id,
          contentHash: crypto.createHash("sha256").update(file.data).digest("hex"),
        } as any,
      });
    }
    if (customerId) ctx.affectedCustomers.push(customerId);
  }

  for (const version of read.dataset.documentVersions) {
    const plan = planFor(ctx, "DocumentVersion", version.id);
    if (plan?.action === "SKIP") continue;
    const documentId = targetFor(ctx, "Document", version.documentId);
    if (!documentId) continue;
    const file = allocateFile(ctx, version.packagePath);
    if (file) {
      await tx.upload.create({
        data: {
          storedName: file.storedName,
          originalName: String(version.fileName),
          mimeType: file.mimeType,
          size: file.data.length,
          ownerType: "DOCUMENT",
          ownerId: documentId,
          uploadedById: ctx.actor.id,
          contentHash: crypto.createHash("sha256").update(file.data).digest("hex"),
        } as any,
      });
    }
    await tx.documentVersion.create({
      data: {
        documentId,
        fileName: String(version.fileName),
        filePath: file?.url ?? "",
        fileSize: file?.data.length ?? numberOrNull(version.fileSize) ?? 0,
        mimeType: file?.mimeType ?? stringOrNull(version.mimeType) ?? "application/pdf",
        createdBy: stringOrNull(version.createdBy),
        createdAt: dateOr(version.createdAt, new Date()),
      } as any,
    });
  }
}

async function importAttachments(ctx: ApplyContext) {
  const { tx, read } = ctx;

  for (const attachment of read.dataset.customerAttachments) {
    const plan = planFor(ctx, "CustomerAttachment", attachment.id);
    if (plan?.action === "SKIP") continue;
    const customerId = targetFor(ctx, "Customer", attachment.customerId);
    if (!customerId) continue;
    const file = allocateFile(ctx, attachment.packagePath);
    await tx.customerAttachment.create({
      data: {
        customerId,
        fileName: String(attachment.fileName),
        dataUrl: file ? dataUrlFromFile(file) : "",
      } as any,
    });
  }

  for (const attachment of read.dataset.attachments) {
    const plan = planFor(ctx, "Attachment", attachment.id);
    if (plan?.action === "SKIP") continue;
    const workOrderId = targetFor(ctx, "WorkOrder", attachment.workOrderId);
    if (!workOrderId) continue;
    const file = allocateFile(ctx, attachment.packagePath);
    await tx.attachment.create({
      data: {
        workOrderId,
        fileName: String(attachment.fileName),
        dataUrl: file ? dataUrlFromFile(file) : "",
      } as any,
    });
  }
}

async function importUploads(ctx: ApplyContext) {
  const { tx, read } = ctx;
  for (const upload of read.dataset.uploads) {
    const plan = planFor(ctx, "Upload", upload.id);
    if (plan?.action === "SKIP") continue;
    const file = allocateFile(ctx, upload.packagePath);
    if (!file) continue;
    const ownerType = String(upload.ownerType);
    const ownerId =
      ownerType === "CUSTOMER"
        ? targetFor(ctx, "Customer", upload.ownerId)
        : ownerType === "WORK_ORDER"
          ? targetFor(ctx, "WorkOrder", upload.ownerId)
          : ownerType === "EQUIPMENT"
            ? targetFor(ctx, "Product", upload.ownerId)
            : ownerType === "CONTRACT"
              ? targetFor(ctx, "Contract", upload.ownerId)
              : ownerType === "DOCUMENT"
                ? targetFor(ctx, "Document", upload.ownerId)
                : undefined;
    if (!ownerId) continue;
    const created = await tx.upload.create({
      data: {
        storedName: file.storedName,
        originalName: String(upload.originalName),
        mimeType: file.mimeType,
        size: file.data.length,
        ownerType,
        ownerId,
        departmentId: targetFor(ctx, "Department", upload.departmentId) ?? null,
        customerId: targetFor(ctx, "Customer", upload.customerId) ?? null,
        uploadedById: ctx.actor.id,
        contentHash: crypto.createHash("sha256").update(file.data).digest("hex"),
      } as any,
      select: { id: true },
    });
    ctx.targets.set(entityKey("Upload", String(upload.id)), created.id);
  }
}

function resultCounts(analysis: ImportAnalysis): Record<string, number> {
  const perType: Record<string, number> = {};
  for (const entity of analysis.entities) {
    const key = `${entity.type}.${entity.action.toLowerCase()}`;
    perType[key] = (perType[key] ?? 0) + 1;
  }
  return { ...analysis.counts, ...perType };
}

async function persistRecords(ctx: ApplyContext) {
  const { tx, analysis, read } = ctx;
  const instance = read.manifest.source.instanceId;
  const rows = [];
  for (const entity of analysis.entities) {
    if (entity.action === "INVALID") continue;
    const targetId =
      ctx.targets.get(entityKey(entity.type, entity.sourceId)) ??
      entity.targetId ??
      null;
    rows.push({
      jobId: ctx.jobId,
      sourceInstanceId: instance,
      sourceEntityType: entity.type,
      sourceId: entity.sourceId,
      targetEntityType: entity.type,
      targetId,
      action: entity.action,
    });
  }
  if (rows.length > 0) {
    // createMany i biter for å holde parameterantallet under PostgreSQLs grense.
    const chunkSize = 1000;
    for (let index = 0; index < rows.length; index += chunkSize) {
      await tx.customerTransferRecord.createMany({
        data: rows.slice(index, index + chunkSize),
        skipDuplicates: true,
      });
    }
  }
}

/**
 * Anvender pakken i én Prisma-transaksjon. Filer skrives med `wx` (aldri
 * overskriving) før commit, og slettes hvis transaksjonen eller commit feiler.
 */
export async function applyImport(input: {
  actor: ServiceActor;
  jobId: string;
  read: PackageReadResult;
  policies: ConflictPolicies;
  options: ImportOptions;
  /** Hvilke jobbstatusser som er lov å anvende fra. */
  expectedStatuses?: readonly string[];
}): Promise<{
  ok: true;
  targets: Map<string, string>;
  counts: Record<string, number>;
  analysis: ImportAnalysis;
} | { ok: false; errors: TransferIssue[]; analysis: ImportAnalysis }> {
  const analysis = await analysePackage(input.read, input.policies, input.options);
  if (!analysis.canImport) {
    return { ok: false, errors: analysis.errors, analysis };
  }

  const movedFiles: string[] = [];
  const ctx: ApplyContext = {
    tx: undefined as unknown as Tx,
    actor: input.actor,
    jobId: input.jobId,
    read: input.read,
    analysis: analysis as ApplyContext["analysis"],
    policies: input.policies,
    options: input.options,
    targets: new Map(),
    pendingFiles: [],
    errors: [],
    affectedCustomers: [],
    affectedDepartments: new Set(),
  };

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        ctx.tx = tx;
        // Serialiser samtidige bekreftelser på samme jobb. Den andre venter på
        // radlåsen og ser deretter at status ikke lenger er DRY_RUN.
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT "status" FROM "CustomerTransferJob" WHERE "id" = ${input.jobId} FOR UPDATE
        `;
        const allowed = input.expectedStatuses ?? ["DRY_RUN"];
        if (!locked[0] || !allowed.includes(locked[0].status)) {
          throw new Error("transfer_already_completed");
        }
        const lockKey = `customer-transfer:${input.read.checksum}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        // Lås også eksisterende målkunder. To ulike pakker som treffer samme
        // kunde skal ikke kunne skrive samtidig, selv om sjekksummen er ulik.
        const targetCustomerIds = [
          ...new Set(
            analysis.customers
              .map((customer) => customer.targetId)
              .filter((id): id is string => Boolean(id)),
          ),
        ].sort();
        for (const customerId of targetCustomerIds) {
          const customerLock = `customer-transfer-customer:${customerId}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customerLock}, 0))`;
        }

        await createReferences(ctx);
        await importCustomers(ctx);
        await importContactsAndSites(ctx);
        await importEquipment(ctx);
        await importContracts(ctx);
        await importWorkOrders(ctx);
        await importReports(ctx);
        await importDocuments(ctx);
        await importAttachments(ctx);
        await importUploads(ctx);
        await persistRecords(ctx);

        // Skriv den durabare fillisten før første fil. Krasjer prosessen etter
        // dette punktet, kan avstemmingen slette nøyaktig de filene som ikke
        // ble referert av en committet transaksjon.
        await writeFinalFilesLedger(
          ctx.jobId,
          ctx.pendingFiles.map((file) => file.storedName),
        );
        const moved = await movePendingFiles(ctx.pendingFiles);
        movedFiles.push(...moved);

        const counts = resultCounts(analysis);
        const expiresAt = new Date(Date.now() + TRANSFER_LIMITS.exportTtlMs);
        await tx.customerTransferJob.update({
          where: { id: ctx.jobId },
          data: {
            status: "COMPLETED",
            countsJson: counts,
            errorJson: undefined,
            progressStage: "completed",
            progressProcessed: analysis.entities.length,
            progressTotal: analysis.entities.length,
            completedAt: new Date(),
            expiresAt,
            resultJson: {
              checksum: input.read.checksum.slice(0, 16),
              schemaVersion: input.read.manifest.schemaVersion,
              counts,
              warnings: analysis.warnings.length,
              targetCustomers: ctx.affectedCustomers.length,
            },
          },
        });

        await audit(tx, {
          entityType: "CustomerTransfer",
          entityId: ctx.jobId,
          action: `Importerte kundepakke: ${input.read.checksum.slice(0, 12)} (${analysis.customers.length} kunder)`,
          actor: toAuditActor(input.actor),
          metadata: {
            kind: "IMPORT",
            jobId: ctx.jobId,
            checksumPrefix: input.read.checksum.slice(0, 16),
            schemaVersion: input.read.manifest.schemaVersion,
            sourceInstanceId: input.read.manifest.source.instanceId,
            customerCount: analysis.customers.length,
            counts,
            warnings: analysis.warnings.length,
          },
          ...(ctx.affectedDepartments.size === 1
            ? { departmentId: [...ctx.affectedDepartments][0] }
            : {}),
        });

        return { counts };
      },
      { maxWait: 15_000, timeout: 120_000 },
    );

    return {
      ok: true,
      targets: ctx.targets,
      counts: result.counts,
      analysis,
    };
  } catch (error) {
    await deleteFiles(movedFiles);
    const alreadyCompleted =
      error instanceof Error && error.message === "transfer_already_completed";
    return {
      ok: false,
      errors: [
        {
          code: alreadyCompleted
            ? TRANSFER_ERROR.conflict
            : TRANSFER_ERROR.import_failed,
          path: "import",
          messageKey: alreadyCompleted
            ? "errors.customerTransfer.alreadyCompleted"
            : "errors.customerTransfer.importFailed",
          detail: error instanceof Error ? error.name : "error",
        },
      ],
      analysis,
    };
  }
}

export { dateOrNull, stringOrNull };
