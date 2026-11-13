// i18n-ignore-file: revisjonshandlingen lagres som stabil norsk data, på samme
// måte som de øvrige utstyrstjenestene.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "./actor";
import { equipmentScopeFor } from "./equipment";
import { logServerError } from "@/lib/log-context";
import type { ErrorCode } from "@/lib/error-codes";

/**
 * Flytting av en enhet med hele servicehistorikken til en annen kunde.
 *
 * Enhetene er felles for avdelingene, men oppdragene er avdelingssperret. Når
 * en enhet bytter kunde, må derfor også oppdragene, planene, dokumentene og
 * filene få ny kunde og ny avdeling. Ellers ville den gamle kunden fortsatt se
 * historikken gjennom oppdragene, og den nye kunden bare se en tom enhet.
 *
 * Kontraktlinjer er bevisst en hard stopp: en flytting kan ikke stille endre
 * hvem en økonomisk forpliktelse peker på. Da må avtalen ryddes først.
 */

export const EQUIPMENT_MOVE_MAX_SUBTREE = 1000;

export const EQUIPMENT_MOVE_ERROR_CODES = {
  invalidInput: "equipment.errors.invalidInput",
  targetCustomerNotFound: "equipment.errors.targetCustomerNotFound",
  targetCustomerDeleted: "equipment.errors.targetCustomerDeleted",
  targetSiteMismatch: "equipment.errors.targetSiteMismatch",
  crossCustomerChild: "equipment.errors.crossCustomerChild",
  contractBlocked: "equipment.errors.contractBlocked",
  workOrderCustomerMismatch: "equipment.errors.workOrderCustomerMismatch",
  workOrderNumberConflict: "equipment.errors.workOrderNumberConflict",
  documentCustomerMismatch: "equipment.errors.documentCustomerMismatch",
  targetDepartmentMissing: "equipment.errors.targetDepartmentMissing",
  subtreeTooLarge: "equipment.errors.subtreeTooLarge",
  stalePreview: "equipment.errors.stalePreview",
} as const satisfies Record<string, ErrorCode>;

export type EquipmentMoveCounts = {
  products: number;
  workOrders: number;
  visits: number;
  reports: number;
  reportRevisions: number;
  reportUnits: number;
  meterReadings: number;
  plans: number;
  planOccurrences: number;
  documents: number;
  documentVersions: number;
  uploads: number;
  qrCodes: number;
  comments: number;
};

export type EquipmentMoveBlocker = {
  /** Stabil kode, oversatt i UI. */
  code: string;
  count?: number;
};

export type EquipmentMoveWarning = {
  /** Stabil kode, oversatt i UI. */
  code: string;
};

export type EquipmentMoveSummary = {
  productId: string;
  sourceCustomerId: string;
  targetCustomerId: string | null;
  targetSiteId: string | null;
  counts: EquipmentMoveCounts;
  blockers: EquipmentMoveBlocker[];
  warnings: EquipmentMoveWarning[];
  /** True når enheten allerede står hos målkunden på målstedet. */
  noop: boolean;
  canMove: boolean;
  /** Bindes til bekreftelsen; endres hvis treff eller mål endres. */
  previewHash: string;
};

export type EquipmentMoveOptions = {
  /**
   * Hashen fra forhåndsvisningen. Når den er oppgitt, avvises flyttingen hvis
   * målkunde, målsted eller innholdet i undertreet er endret siden forhåndsvisningen.
   */
  previewHash?: string | null;
};

type ProductRow = {
  id: string;
  customerId: string;
  parentId: string | null;
  siteId: string | null;
  model: string;
};

type WorkOrderRow = {
  id: string;
  customerId: string | null;
  siteId: string | null;
  departmentId: string;
  contactId: string | null;
  contractId: string | null;
  orderNumberNormalized: string | null;
  contractCustomerId: string | null;
};

type MovePlan = {
  root: ProductRow;
  products: ProductRow[];
  productIds: string[];
  childIds: string[];
  workOrders: WorkOrderRow[];
  workOrderIds: string[];
  planIds: string[];
  documentIds: string[];
  uploadIds: string[];
  counts: EquipmentMoveCounts;
  blockers: EquipmentMoveBlocker[];
  warnings: EquipmentMoveWarning[];
  sourceCustomerId: string;
  targetCustomerId: string | null;
  targetSiteId: string | null;
  targetDepartmentId: string | null;
  noop: boolean;
  previewHash: string;
  oldContactIds: string[];
  oldContractWorkOrderIds: string[];
};

type TargetCustomer = {
  id: string;
  name: string;
  departmentId: string | null;
};

const EMPTY_COUNTS: EquipmentMoveCounts = {
  products: 0,
  workOrders: 0,
  visits: 0,
  reports: 0,
  reportRevisions: 0,
  reportUnits: 0,
  meterReadings: 0,
  plans: 0,
  planOccurrences: 0,
  documents: 0,
  documentVersions: 0,
  uploads: 0,
  qrCodes: 0,
  comments: 0,
};

function requireMovePermission(actor: ServiceActor): ServiceFailure | null {
  if (!actor?.isActive) return fail("forbidden");
  if (isAdminActor(actor)) return null;
  if (!can(actor, "equipment.manage") || !can(actor, "customers.manage")) {
    return fail("forbidden");
  }
  return null;
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function lockKey(productId: string): string {
  return `fsm.equipment.move:${productId}`;
}

/** Serialiserer flyttinger av samme enhet, også på tvers av appinstanser. */
async function lockProduct(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey(productId)}))
  `;
}

async function collectSubtree(
  client: Prisma.TransactionClient | typeof prisma,
  root: ProductRow,
): Promise<{
  products: ProductRow[];
  tooLarge: boolean;
}> {
  const products: ProductRow[] = [root];
  const seen = new Set([root.id]);
  let frontier = [root.id];

  while (frontier.length > 0) {
    const remaining = EQUIPMENT_MOVE_MAX_SUBTREE - products.length;
    if (remaining <= 0) return { products, tooLarge: true };

    const children = await client.product.findMany({
      where: { parentId: { in: frontier } },
      select: {
        id: true,
        customerId: true,
        parentId: true,
        siteId: true,
        model: true,
      },
      take: remaining + 1,
      orderBy: { id: "asc" },
    });
    if (children.length > remaining) {
      return { products: [...products, ...children.slice(0, remaining)], tooLarge: true };
    }

    const next: string[] = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      products.push(child);
      next.push(child.id);
    }
    frontier = next;
  }

  return { products, tooLarge: false };
}

async function resolveTargetDepartment(
  client: Prisma.TransactionClient | typeof prisma,
  target: TargetCustomer,
  actor: ServiceActor,
  needsDepartment: boolean,
): Promise<{
  departmentId: string | null;
  usedFallback: boolean;
}> {
  if (!needsDepartment) return { departmentId: null, usedFallback: false };

  if (target.departmentId) {
    const department = await client.department.findFirst({
      where: { id: target.departmentId, isActive: true },
      select: { id: true },
    });
    if (department) return { departmentId: department.id, usedFallback: false };
  }

  if (actor.departmentId) {
    const department = await client.department.findFirst({
      where: { id: actor.departmentId, isActive: true },
      select: { id: true },
    });
    if (department) {
      return { departmentId: department.id, usedFallback: true };
    }
  }

  const fallback = await client.department.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return { departmentId: fallback?.id ?? null, usedFallback: true };
}

function moveFingerprint(input: {
  productId: string;
  sourceCustomerId: string;
  targetCustomerId: string | null;
  targetSiteId: string | null;
  productIds: string[];
  workOrderIds: string[];
  planIds: string[];
  documentIds: string[];
  uploadIds: string[];
}): string {
  const payload = {
    productId: input.productId,
    sourceCustomerId: input.sourceCustomerId,
    targetCustomerId: input.targetCustomerId,
    targetSiteId: input.targetSiteId,
    productIds: [...input.productIds].sort(),
    workOrderIds: [...input.workOrderIds].sort(),
    planIds: [...input.planIds].sort(),
    documentIds: [...input.documentIds].sort(),
    uploadIds: [...input.uploadIds].sort(),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

async function buildMovePlan(
  client: Prisma.TransactionClient | typeof prisma,
  actor: ServiceActor,
  productId: string,
  targetCustomerId: string | null,
  targetSiteId: string | null,
): Promise<ServiceResult<MovePlan>> {
  const root = await client.product.findFirst({
    where: { id: productId, ...equipmentScopeFor(actor) },
    select: {
      id: true,
      customerId: true,
      parentId: true,
      siteId: true,
      model: true,
    },
  });
  if (!root) return fail("not_found");

  const subtree = await collectSubtree(client, root);
  const productIds = subtree.products.map((product) => product.id);
  const childIds = productIds.filter((id) => id !== root.id);

  const workOrders = await client.workOrder.findMany({
    where: { productId: { in: productIds } },
    select: {
      id: true,
      customerId: true,
      siteId: true,
      departmentId: true,
      contactId: true,
      contractId: true,
      orderNumberNormalized: true,
      contract: { select: { customerId: true } },
    },
    orderBy: { id: "asc" },
  });
  const normalizedWorkOrders: WorkOrderRow[] = workOrders.map((order) => ({
    id: order.id,
    customerId: order.customerId,
    siteId: order.siteId,
    departmentId: order.departmentId,
    contactId: order.contactId,
    contractId: order.contractId,
    orderNumberNormalized: order.orderNumberNormalized,
    contractCustomerId: order.contract?.customerId ?? null,
  }));
  const workOrderIds = normalizedWorkOrders.map((order) => order.id);

  const plans = await client.maintenancePlan.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, customerId: true, departmentId: true },
    orderBy: { id: "asc" },
  });
  const documents = await client.document.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, customerId: true },
    orderBy: { id: "asc" },
  });
  const planIds = plans.map((plan) => plan.id);
  const documentIds = documents.map((document) => document.id);

  const [reports, visits, meterReadings, occurrences, documentVersions, qrCodes, comments, uploads] =
    await Promise.all([
      client.report.findMany({
        where: { workOrderId: { in: workOrderIds } },
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      client.visit.count({ where: { workOrderId: { in: workOrderIds } } }),
      client.meterReading.count({ where: { productId: { in: productIds } } }),
      client.maintenancePlanOccurrence.count({
        where: { planId: { in: planIds } },
      }),
      client.documentVersion.count({
        where: { documentId: { in: documentIds } },
      }),
      client.equipmentQrCode.count({
        where: { productId: { in: productIds } },
      }),
      client.comment.count({ where: { workOrderId: { in: workOrderIds } } }),
      client.upload.findMany({
        where: {
          OR: [
            { ownerType: "WORK_ORDER", ownerId: { in: workOrderIds } },
            { ownerType: "EQUIPMENT", ownerId: { in: productIds } },
            { ownerType: "DOCUMENT", ownerId: { in: documentIds } },
          ],
        },
        select: { id: true },
        orderBy: { id: "asc" },
      }),
    ]);

  const reportIds = reports.map((report) => report.id);
  const [reportUnits, reportRevisions] = await Promise.all([
    client.reportUnit.count({ where: { reportId: { in: reportIds } } }),
    client.reportRevision.count({ where: { reportId: { in: reportIds } } }),
  ]);

  const counts: EquipmentMoveCounts = {
    ...EMPTY_COUNTS,
    products: productIds.length,
    workOrders: workOrderIds.length,
    visits,
    reports: reportIds.length,
    reportRevisions,
    reportUnits,
    meterReadings,
    plans: planIds.length,
    planOccurrences: occurrences,
    documents: documentIds.length,
    documentVersions,
    uploads: uploads.length,
    qrCodes,
    comments,
  };

  const blockers: EquipmentMoveBlocker[] = [];
  const warnings: EquipmentMoveWarning[] = [];
  if (subtree.tooLarge) {
    blockers.push({ code: "subtreeTooLarge" satisfies ErrorCode, count: productIds.length });
  }

  const foreignChildren = subtree.products.filter(
    (product) => product.customerId !== root.customerId,
  );
  if (foreignChildren.length > 0) {
    blockers.push({ code: "crossCustomerChild" satisfies ErrorCode, count: foreignChildren.length });
  }

  const foreignWorkOrders = normalizedWorkOrders.filter(
    (order) =>
      order.customerId !== null &&
      order.customerId !== root.customerId &&
      order.customerId !== targetCustomerId,
  );
  if (foreignWorkOrders.length > 0) {
    blockers.push({
      code: "workOrderCustomerMismatch" satisfies ErrorCode,
      count: foreignWorkOrders.length,
    });
  }

  const foreignDocuments = documents.filter(
    (document) =>
      document.customerId !== null &&
      document.customerId !== root.customerId &&
      document.customerId !== targetCustomerId,
  );
  if (foreignDocuments.length > 0) {
    blockers.push({
      code: "documentCustomerMismatch" satisfies ErrorCode,
      count: foreignDocuments.length,
    });
  }

  const contractLines = await client.contractLine.findMany({
    where: { productId: { in: productIds } },
    select: { contractId: true, contract: { select: { customerId: true } } },
    orderBy: { id: "asc" },
  });
  const foreignContractLines = contractLines.filter(
    (line) => line.contract.customerId !== targetCustomerId,
  );
  if (targetCustomerId && foreignContractLines.length > 0) {
    blockers.push({
      code: "contractBlocked" satisfies ErrorCode,
      count: foreignContractLines.length,
    });
  }

  let target: TargetCustomer | null = null;
  if (targetCustomerId) {
    const targetRow = await client.customer.findUnique({
      where: { id: targetCustomerId },
      select: {
        id: true,
        name: true,
        departmentId: true,
        deletedAt: true,
      },
    });
    if (!targetRow) {
      blockers.push({ code: "targetCustomerNotFound" satisfies ErrorCode });
    } else if (targetRow.deletedAt) {
      blockers.push({ code: "targetCustomerDeleted" satisfies ErrorCode });
    } else {
      target = {
        id: targetRow.id,
        name: targetRow.name,
        departmentId: targetRow.departmentId,
      };
    }
  }

  let resolvedTargetSiteId: string | null = null;
  if (target && targetSiteId) {
    const site = await client.customerSite.findFirst({
      where: { id: targetSiteId, customerId: target.id },
      select: { id: true },
    });
    if (!site) {
      blockers.push({ code: "targetSiteMismatch" satisfies ErrorCode });
    } else {
      resolvedTargetSiteId = site.id;
    }
  } else if (targetSiteId) {
    blockers.push({ code: "targetSiteMismatch" satisfies ErrorCode });
  }

  const needsDepartment =
    normalizedWorkOrders.length > 0 || plans.length > 0;
  let targetDepartmentId: string | null = null;
  if (target) {
    const department = await resolveTargetDepartment(
      client,
      target,
      actor,
      needsDepartment,
    );
    targetDepartmentId = department.departmentId;
    if (department.usedFallback) warnings.push({ code: "departmentFallback" satisfies ErrorCode });
    if (needsDepartment && !targetDepartmentId) {
      blockers.push({ code: "targetDepartmentMissing" satisfies ErrorCode });
    }
  }

  // Oppdragsnumre er unike per avdeling. Flytting til en annen avdeling kan
  // derfor kollidere med et nummer som allerede finnes der.
  if (targetDepartmentId) {
    const numbers = normalizedWorkOrders
      .map((order) => order.orderNumberNormalized)
      .filter((value): value is string => Boolean(value));
    if (numbers.length > 0) {
      const conflicts = await client.workOrder.count({
        where: {
          departmentId: targetDepartmentId,
          orderNumberNormalized: { in: numbers },
          id: { notIn: workOrderIds },
        },
      });
      if (conflicts > 0) {
        blockers.push({ code: "workOrderNumberConflict" satisfies ErrorCode, count: conflicts });
      }
    }
  }

  const oldContactIds = [
    ...new Set(
      normalizedWorkOrders
        .map((order) => order.contactId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].filter(Boolean);
  let contactsToClear: string[] = [];
  if (oldContactIds.length > 0) {
    const contacts = await client.contact.findMany({
      where: { id: { in: oldContactIds } },
      select: { id: true, customerId: true },
    });
    contactsToClear = contacts
      .filter((contact) => contact.customerId !== targetCustomerId)
      .map((contact) => contact.id);
  }

  const oldContractWorkOrderIds =
    targetCustomerId === null
      ? []
      : normalizedWorkOrders
          .filter(
            (order) =>
              order.contractId &&
              order.contractCustomerId !== null &&
              order.contractCustomerId !== targetCustomerId,
          )
          .map((order) => order.id);

  const noop = Boolean(
    target && root.customerId === target.id && root.siteId === resolvedTargetSiteId,
  );

  const previewHash = moveFingerprint({
    productId: root.id,
    sourceCustomerId: root.customerId,
    targetCustomerId: target?.id ?? null,
    targetSiteId: resolvedTargetSiteId,
    productIds,
    workOrderIds,
    planIds,
    documentIds,
    uploadIds: uploads.map((upload) => upload.id),
  });

  if (!noop) {
    if (!targetCustomerId) {
      warnings.push({ code: "noTargetSelected" satisfies ErrorCode });
    }
    if (oldContractWorkOrderIds.length > 0) {
      warnings.push({ code: "workOrderContractCleared" satisfies ErrorCode });
    }
    if (contactsToClear.length > 0) {
      warnings.push({ code: "oldContactCleared" satisfies ErrorCode });
    }
  }

  return ok({
    root,
    products: subtree.products,
    productIds,
    childIds,
    workOrders: normalizedWorkOrders,
    workOrderIds,
    planIds,
    documentIds,
    uploadIds: uploads.map((upload) => upload.id),
    counts,
    blockers,
    warnings,
    sourceCustomerId: root.customerId,
    targetCustomerId: target?.id ?? null,
    targetSiteId: resolvedTargetSiteId,
    targetDepartmentId,
    noop,
    previewHash,
    oldContactIds: contactsToClear,
    oldContractWorkOrderIds,
  });
}

function summaryFromPlan(
  plan: MovePlan,
  overrides: Partial<Pick<MovePlan, "noop" | "blockers">> = {},
): EquipmentMoveSummary {
  const noop = overrides.noop ?? plan.noop;
  const blockers = overrides.blockers ?? plan.blockers;
  return {
    productId: plan.root.id,
    sourceCustomerId: plan.sourceCustomerId,
    targetCustomerId: plan.targetCustomerId,
    targetSiteId: plan.targetSiteId,
    counts: plan.counts,
    blockers,
    warnings: plan.warnings,
    noop,
    canMove: Boolean(plan.targetCustomerId) && !noop && blockers.length === 0,
    previewHash: plan.previewHash,
  };
}

/**
 * Forhåndsvisning av en flytting. Når målkunde mangler, returneres bare
 * innholdet som vil følge med, slik at detaljsiden kan vise omfanget før brukeren
 * har valgt mottaker.
 */
export async function getEquipmentMovePreview(
  actor: ServiceActor,
  productId: string,
  targetCustomerId?: string | null,
  targetSiteId?: string | null,
): Promise<ServiceResult<EquipmentMoveSummary>> {
  const denied = requireMovePermission(actor);
  if (denied) return denied;

  const id = cleanId(productId);
  if (!id) {
    return fail("invalid", { code: EQUIPMENT_MOVE_ERROR_CODES.invalidInput });
  }
  const targetId = targetCustomerId ? cleanId(targetCustomerId) : null;
  const siteId = targetSiteId ? cleanId(targetSiteId) : null;

  const plan = await buildMovePlan(prisma, actor, id, targetId, siteId);
  if (!plan.ok) return plan;
  return ok(summaryFromPlan(plan.data));
}

/**
 * Flytter en enhet og hele undertreet dens til en annen kunde.
 *
 * Flyttingen er idempotent: et nytt identisk kall etter at enheten står hos
 * målkunden gir `noop: true` uten skrivinger. Alle valideringer gjøres før
 * første skriving, slik at en avvist flytting ikke etterlater halve endringer.
 */
export async function moveEquipmentToCustomer(
  actor: ServiceActor,
  productId: string,
  targetCustomerId: string,
  targetSiteId?: string | null,
  options: EquipmentMoveOptions = {},
): Promise<ServiceResult<EquipmentMoveSummary>> {
  const denied = requireMovePermission(actor);
  if (denied) return denied;

  const id = cleanId(productId);
  const targetId = cleanId(targetCustomerId);
  const siteId = targetSiteId ? cleanId(targetSiteId) : null;
  if (!id || !targetId) {
    return fail("invalid", { code: EQUIPMENT_MOVE_ERROR_CODES.invalidInput });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Låsen tas før lesing. Da ser et samtidig, identisk kall den første
      // flyttingen og returnerer et rent no-op i stedet for å flytte på nytt.
      await lockProduct(tx, id);

      const planResult = await buildMovePlan(
        tx,
        actor,
        id,
        targetId,
        siteId,
      );
      if (!planResult.ok) return planResult;
      const plan = planResult.data;

      // Idempotent før både hash- og blokkeringssjekk: en enhet som allerede
      // står riktig skal gi et tydelig no-op, ikke en ny feil fordi noe annet
      // ble endret etter forrige flytting.
      if (plan.noop) {
        return ok(
          summaryFromPlan(plan, {
            noop: true,
            blockers: [],
          }),
        );
      }

      if (
        options.previewHash &&
        options.previewHash !== plan.previewHash
      ) {
        return fail("conflict", {
          code: EQUIPMENT_MOVE_ERROR_CODES.stalePreview,
        });
      }

      if (plan.blockers.length > 0) {
        const first = plan.blockers[0];
        return fail("conflict", {
          code: `equipment.errors.${first.code}`,
          blockers: plan.blockers,
        });
      }
      if (!plan.targetCustomerId) {
        return fail("not_found", {
          code: EQUIPMENT_MOVE_ERROR_CODES.targetCustomerNotFound,
        });
      }

      // Produktene: roten får målstedet (eller tomt), barna mister stedet
      // fordi det gamle stedet tilhører den gamle kunden. Hierarkiet består.
      await tx.product.update({
        where: { id: plan.root.id },
        data: {
          customerId: plan.targetCustomerId,
          siteId: plan.targetSiteId,
          parentId: null,
        },
      });
      if (plan.childIds.length > 0) {
        await tx.product.updateMany({
          where: { id: { in: plan.childIds } },
          data: {
            customerId: plan.targetCustomerId,
            siteId: null,
          },
        });
      }

      if (plan.workOrderIds.length > 0) {
        await tx.workOrder.updateMany({
          where: { id: { in: plan.workOrderIds } },
          data: {
            customerId: plan.targetCustomerId,
            siteId: plan.targetSiteId,
            departmentId: plan.targetDepartmentId ?? undefined,
          },
        });

        if (plan.oldContactIds.length > 0) {
          await tx.workOrder.updateMany({
            where: {
              id: { in: plan.workOrderIds },
              contactId: { in: plan.oldContactIds },
            },
            data: { contactId: null },
          });
        }
        if (plan.oldContractWorkOrderIds.length > 0) {
          await tx.workOrder.updateMany({
            where: { id: { in: plan.oldContractWorkOrderIds } },
            data: { contractId: null },
          });
        }
      }

      if (plan.planIds.length > 0) {
        await tx.maintenancePlan.updateMany({
          where: { id: { in: plan.planIds } },
          data: {
            customerId: plan.targetCustomerId,
            departmentId: plan.targetDepartmentId ?? undefined,
          },
        });
      }

      if (plan.documentIds.length > 0) {
        await tx.document.updateMany({
          where: { id: { in: plan.documentIds } },
          data: { customerId: plan.targetCustomerId },
        });
      }

      if (plan.workOrderIds.length > 0) {
        await tx.comment.updateMany({
          where: { workOrderId: { in: plan.workOrderIds } },
          data: { customerId: plan.targetCustomerId },
        });
        if (plan.oldContactIds.length > 0) {
          await tx.comment.updateMany({
            where: {
              workOrderId: { in: plan.workOrderIds },
              contactId: { in: plan.oldContactIds },
            },
            data: { contactId: null },
          });
        }
      }

      if (plan.uploadIds.length > 0) {
        await tx.upload.updateMany({
          where: { id: { in: plan.uploadIds } },
          data: {
            customerId: plan.targetCustomerId,
            departmentId: plan.targetDepartmentId,
          },
        });
      }

      await audit(tx, {
        entityType: "Product",
        entityId: plan.root.id,
        action: "Flyttet utstyr til annen kunde",
        actor: toAuditActor(actor),
        metadata: {
          sourceCustomerId: plan.sourceCustomerId,
          targetCustomerId: plan.targetCustomerId,
          targetSiteId: plan.targetSiteId,
          counts: plan.counts,
          warningCodes: plan.warnings.map((warning) => warning.code),
        },
      });

      return ok(
        summaryFromPlan(plan, {
          noop: false,
          blockers: [],
        }),
      );
    });
  } catch (error) {
    await logServerError("Feil ved flytting av utstyr til annen kunde", error, {
      equipmentId: productId,
      targetCustomerId,
    });
    return fail("error");
  }
}

export type EquipmentMoveCustomerOption = {
  id: string;
  name: string;
  customerNumber: string | null;
  city: string | null;
};

/** Avgrenset, serversøk i kunderegisteret for målkundevelgeren. */
export async function searchMoveCustomers(
  actor: ServiceActor,
  query: string,
): Promise<ServiceResult<{ customers: EquipmentMoveCustomerOption[] }>> {
  const denied = requireMovePermission(actor);
  if (denied) return denied;

  const q = cleanText(query, { maxLength: LIMITS.short });
  if (q.length < 2) return ok({ customers: [] });

  const contains = { contains: q, mode: "insensitive" as const };
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: contains },
        { customerNumber: contains },
        { orgNumber: contains },
        { city: contains },
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 10,
    select: {
      id: true,
      name: true,
      customerNumber: true,
      city: true,
    },
  });
  return ok({ customers });
}

export type EquipmentMoveSiteOption = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  isPrimary: boolean;
};

/** Steder for valgt målkunde. Hardt avgrenset, aldri en full kundeliste. */
export async function listMoveTargetSites(
  actor: ServiceActor,
  customerId: string,
): Promise<ServiceResult<{ sites: EquipmentMoveSiteOption[] }>> {
  const denied = requireMovePermission(actor);
  if (denied) return denied;

  const id = cleanId(customerId);
  if (!id) {
    return fail("invalid", { code: EQUIPMENT_MOVE_ERROR_CODES.invalidInput });
  }
  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    return fail("not_found", {
      code: EQUIPMENT_MOVE_ERROR_CODES.targetCustomerNotFound,
    });
  }

  const sites = await prisma.customerSite.findMany({
    where: { customerId: id },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      isPrimary: true,
    },
  });
  return ok({ sites });
}
