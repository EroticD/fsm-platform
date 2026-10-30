// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger
// som vises via `src/lib/audit-actions.ts`. De er historiske data, ikke UI-tekst.
import type { Prisma } from "@prisma/client";
import { MaintenanceTrigger, Prisma as PrismaRuntime } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  addDaysUtc,
  addMonthsUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayUtc,
} from "@/lib/dates";
import { getDefaultDepartmentId } from "@/lib/departments";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  maintenancePlanCreateSchema,
  maintenancePlanUpdateSchema,
} from "@/lib/schemas/equipment";
import { createDefaultVisit } from "@/server/visits";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "./actor";

/** Fast nøkkel for den globale vedlikeholdskjøringen. Per-plan-låsen under er
 * den som gir idempotens når to kjøringer treffer samme plan. */
export const MAINTENANCE_ADVISORY_LOCK_ID = 918274;

export const MAINTENANCE_PAGE_SIZE = 50;

export const MAINTENANCE_ERROR_CODES = {
  invalidInput: "maintenance.errors.invalidInput",
  invalidTrigger: "maintenance.errors.invalidTrigger",
  invalidInterval: "maintenance.errors.invalidInterval",
  invalidMeterInterval: "maintenance.errors.invalidMeterInterval",
  invalidDueDate: "maintenance.errors.invalidDueDate",
  productRequired: "maintenance.errors.productRequired",
  customerMismatch: "maintenance.errors.customerMismatch",
  invalidCustomer: "maintenance.errors.invalidCustomer",
  invalidDepartment: "maintenance.errors.invalidDepartment",
  invalidTemplate: "maintenance.errors.invalidTemplate",
  planInUse: "maintenance.errors.planInUse",
  alreadyGenerated: "maintenance.errors.alreadyGenerated",
} as const;

export type MaintenanceGenerationResult = {
  planId: string;
  workOrderId?: string;
  occurrenceId?: string;
  skipped?:
    | "not-found"
    | "inactive"
    | "not-calendar"
    | "not-due"
    | "customer-deleted"
    | "already-generated"
    | "locked"
    | "error";
  error?: string;
};

function requirePermission(
  actor: ServiceActor,
  permission: "equipment.view" | "equipment.manage",
): ServiceFailure | null {
  if (!actor?.isActive || !can(actor, permission)) return fail("forbidden");
  return null;
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function decimal(value: number): PrismaRuntime.Decimal {
  return new PrismaRuntime.Decimal(value);
}

function isTrigger(value: unknown): value is MaintenanceTrigger {
  return (Object.values(MaintenanceTrigger) as string[]).includes(
    String(value),
  );
}

/** Tar en transaksjonsscoped lås per plan. Låsen slippes ved commit/rollback. */
async function lockPlan(
  tx: Prisma.TransactionClient,
  planId: string,
): Promise<void> {
  // `pg_advisory_xact_lock` returnerer void. Prisma kan ikke deserialisere
  // void-kolonnen fra `$queryRaw`, så vi bruker `$executeRaw` som bare trenger
  // at kommandoen lykkes.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${planId}))
  `;
}

export type MaintenancePlanListParams = {
  productId?: string;
  customerId?: string;
  trigger?: string;
  active?: boolean;
  page?: number;
  limit?: number;
};

export async function listMaintenancePlans(
  actor: ServiceActor,
  params: MaintenancePlanListParams = {},
) {
  const denied = requirePermission(actor, "equipment.view");
  if (denied) return denied;

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? MAINTENANCE_PAGE_SIZE)));
  const productId = cleanId(params.productId);
  const customerId = cleanId(params.customerId);

  const where: Prisma.MaintenancePlanWhereInput = {};
  if (productId) where.productId = productId;
  if (customerId) where.customerId = customerId;
  if (params.trigger) {
    if (!isTrigger(params.trigger)) {
      return fail("invalid", {
        code: MAINTENANCE_ERROR_CODES.invalidTrigger,
      });
    }
    where.trigger = params.trigger;
  }
  if (params.active !== undefined) where.isActive = params.active;

  const [total, items] = await Promise.all([
    prisma.maintenancePlan.count({ where }),
    prisma.maintenancePlan.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        product: { select: { id: true, model: true, serialNumber: true } },
        customer: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        template: { select: { id: true, title: true } },
        occurrences: {
          orderBy: { dueDate: "desc" },
          take: 3,
          select: {
            id: true,
            dueDate: true,
            status: true,
            workOrderId: true,
            meterValue: true,
          },
        },
      },
    }),
  ]);

  return ok({
    items,
    total,
    page,
    pageSize: limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  });
}

export type MaintenancePlanCreateInput = {
  title?: unknown;
  trigger?: unknown;
  productId?: unknown;
  customerId?: unknown;
  departmentId?: unknown;
  templateId?: unknown;
  intervalMonths?: unknown;
  meterInterval?: unknown;
  leadDays?: unknown;
  nextDueDate?: unknown;
};

export async function createMaintenancePlan(
  actor: ServiceActor,
  input: MaintenancePlanCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const parsed = maintenancePlanCreateSchema.safeParse({
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    trigger: cleanText(input.trigger, { maxLength: 20 }).toUpperCase(),
    productId: cleanId(input.productId),
    customerId: cleanId(input.customerId),
    departmentId: cleanId(input.departmentId),
    templateId: cleanId(input.templateId),
    intervalMonths: input.intervalMonths,
    meterInterval: input.meterInterval,
    leadDays: input.leadDays ?? 14,
    nextDueDate: cleanText(input.nextDueDate, { maxLength: 10 }),
  });
  if (!parsed.success) {
    return fail("invalid", {
      code: MAINTENANCE_ERROR_CODES.invalidInput,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  const data = parsed.data;

  if (data.trigger === "CALENDAR") {
    if (!data.intervalMonths) {
      return fail("invalid", {
        code: MAINTENANCE_ERROR_CODES.invalidInterval,
      });
    }
    if (!data.nextDueDate) {
      return fail("invalid", {
        code: MAINTENANCE_ERROR_CODES.invalidDueDate,
      });
    }
  }
  if (data.trigger === "METER") {
    if (!data.productId) {
      return fail("invalid", {
        code: MAINTENANCE_ERROR_CODES.productRequired,
      });
    }
    if (!data.meterInterval) {
      return fail("invalid", {
        code: MAINTENANCE_ERROR_CODES.invalidMeterInterval,
      });
    }
  }

  const nextDueDate = data.nextDueDate ? parseDateOnly(data.nextDueDate) : null;
  if (data.nextDueDate && !nextDueDate) {
    return fail("invalid", {
      code: MAINTENANCE_ERROR_CODES.invalidDueDate,
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      let customerId = data.customerId ?? null;
      let departmentId = data.departmentId ?? actor.departmentId ?? null;
      let lastMeterValue: PrismaRuntime.Decimal | null = null;

      if (data.productId) {
        const product = await tx.product.findFirst({
          where: {
            id: data.productId,
            customer: { deletedAt: null },
          },
          select: {
            id: true,
            customerId: true,
            customer: { select: { departmentId: true } },
          },
        });
        if (!product) {
          return fail("invalid", {
            code: MAINTENANCE_ERROR_CODES.invalidInput,
          });
        }
        if (customerId && customerId !== product.customerId) {
          return fail("conflict", {
            code: MAINTENANCE_ERROR_CODES.customerMismatch,
          });
        }
        customerId = product.customerId;
        departmentId = departmentId ?? product.customer.departmentId ?? null;

        const latest = await tx.meterReading.findFirst({
          where: { productId: product.id },
          orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
          select: { value: true },
        });
        lastMeterValue = latest?.value ?? null;
      }

      if (!customerId) {
        return fail("invalid", {
          code: MAINTENANCE_ERROR_CODES.invalidCustomer,
        });
      }
      const customer = await tx.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, departmentId: true },
      });
      if (!customer) {
        return fail("invalid", {
          code: MAINTENANCE_ERROR_CODES.invalidCustomer,
        });
      }
      departmentId = departmentId ?? customer.departmentId ?? null;
      departmentId = departmentId ?? (await getDefaultDepartmentId());
      if (!departmentId) {
        return fail("invalid", {
          code: MAINTENANCE_ERROR_CODES.invalidDepartment,
        });
      }
      const department = await tx.department.findFirst({
        where: { id: departmentId, isActive: true },
        select: { id: true },
      });
      if (!department) {
        return fail("invalid", {
          code: MAINTENANCE_ERROR_CODES.invalidDepartment,
        });
      }

      if (data.templateId) {
        const template = await tx.template.findUnique({
          where: { id: data.templateId },
          select: { id: true },
        });
        if (!template) {
          return fail("invalid", {
            code: MAINTENANCE_ERROR_CODES.invalidTemplate,
          });
        }
      }

      const plan = await tx.maintenancePlan.create({
        data: {
          title: data.title,
          trigger: data.trigger,
          intervalMonths:
            data.trigger === "CALENDAR" ? data.intervalMonths ?? null : null,
          meterInterval:
            data.trigger === "METER" && data.meterInterval
              ? decimal(data.meterInterval)
              : null,
          leadDays: data.leadDays,
          nextDueDate,
          lastMeterValue,
          productId: data.productId ?? null,
          customerId,
          departmentId,
          templateId: data.templateId ?? null,
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "MaintenancePlan",
        entityId: plan.id,
        action: `Opprettet vedlikeholdsplan: ${data.title}`,
        actor: toAuditActor(actor),
        metadata: {
          trigger: data.trigger,
          productId: data.productId ?? null,
          customerId,
        },
      });

      return ok({ id: plan.id });
    });
  } catch (error) {
    console.error("Feil ved opprettelse av vedlikeholdsplan:", error);
    return fail("error");
  }
}

export type MaintenancePlanUpdateInput = {
  id?: unknown;
  title?: unknown;
  isActive?: unknown;
  intervalMonths?: unknown;
  meterInterval?: unknown;
  leadDays?: unknown;
  nextDueDate?: unknown;
  templateId?: unknown;
};

export async function updateMaintenancePlan(
  actor: ServiceActor,
  input: MaintenancePlanUpdateInput,
): Promise<ServiceResult<{ id: string }>> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const parsed = maintenancePlanUpdateSchema.safeParse({
    id: cleanId(input.id),
    title: hasOwn(input, "title")
      ? cleanText(input.title, { maxLength: LIMITS.title })
      : undefined,
    isActive: hasOwn(input, "isActive") ? input.isActive : undefined,
    intervalMonths: hasOwn(input, "intervalMonths")
      ? input.intervalMonths
      : undefined,
    meterInterval: hasOwn(input, "meterInterval")
      ? input.meterInterval
      : undefined,
    leadDays: hasOwn(input, "leadDays") ? input.leadDays : undefined,
    nextDueDate: hasOwn(input, "nextDueDate")
      ? cleanText(input.nextDueDate, { maxLength: 10 })
      : undefined,
    templateId: hasOwn(input, "templateId")
      ? cleanId(input.templateId)
      : undefined,
  });
  if (!parsed.success) {
    return fail("invalid", {
      code: MAINTENANCE_ERROR_CODES.invalidInput,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  const data = parsed.data;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.maintenancePlan.findUnique({
        where: { id: data.id },
        select: {
          id: true,
          title: true,
          trigger: true,
          intervalMonths: true,
          meterInterval: true,
          nextDueDate: true,
        },
      });
      if (!current) return fail("not_found");

      const update: Prisma.MaintenancePlanUpdateInput = {};
      if (data.title !== undefined) update.title = data.title;
      if (data.isActive !== undefined) update.isActive = data.isActive;
      if (data.leadDays !== undefined) update.leadDays = data.leadDays;
      if (data.intervalMonths !== undefined) {
        update.intervalMonths = data.intervalMonths;
      }
      if (data.meterInterval !== undefined) {
        update.meterInterval =
          data.meterInterval === null ? null : decimal(data.meterInterval);
      }
      if (data.nextDueDate !== undefined) {
        update.nextDueDate = data.nextDueDate
          ? parseDateOnly(data.nextDueDate)
          : null;
        if (data.nextDueDate && !update.nextDueDate) {
          return fail("invalid", {
            code: MAINTENANCE_ERROR_CODES.invalidDueDate,
          });
        }
      }
      if (data.templateId !== undefined) {
        if (data.templateId) {
          const template = await tx.template.findUnique({
            where: { id: data.templateId },
            select: { id: true },
          });
          if (!template) {
            return fail("invalid", {
              code: MAINTENANCE_ERROR_CODES.invalidTemplate,
            });
          }
        }
        update.template = data.templateId
          ? { connect: { id: data.templateId } }
          : { disconnect: true };
      }

      await tx.maintenancePlan.update({
        where: { id: current.id },
        data: update,
      });
      await audit(tx, {
        entityType: "MaintenancePlan",
        entityId: current.id,
        action: `Oppdaterte vedlikeholdsplan: ${data.title ?? current.title}`,
        actor: toAuditActor(actor),
        metadata: { fields: Object.keys(data).filter((key) => key !== "id") },
      });
      return ok({ id: current.id });
    });
  } catch (error) {
    console.error("Feil ved oppdatering av vedlikeholdsplan:", error);
    return fail("error");
  }
}

export async function deleteMaintenancePlan(
  actor: ServiceActor,
  planId: string,
): Promise<ServiceResult> {
  const denied = requirePermission(actor, "equipment.manage");
  if (denied) return denied;

  const id = cleanId(planId);
  if (!id) {
    return fail("invalid", { code: MAINTENANCE_ERROR_CODES.invalidInput });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const plan = await tx.maintenancePlan.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          _count: { select: { occurrences: true } },
        },
      });
      if (!plan) return fail("not_found");
      if (plan._count.occurrences > 0) {
        return fail("in_use", {
          code: MAINTENANCE_ERROR_CODES.planInUse,
          occurrences: plan._count.occurrences,
        });
      }
      await tx.maintenancePlan.delete({ where: { id } });
      await audit(tx, {
        entityType: "MaintenancePlan",
        entityId: id,
        action: `Slettet vedlikeholdsplan: ${plan.title}`,
        actor: toAuditActor(actor),
      });
      return ok(undefined);
    });
  } catch (error) {
    console.error("Feil ved sletting av vedlikeholdsplan:", error);
    return fail("error");
  }
}

/**
 * Oppretter neste forekomst for én kalenderplan.
 *
 * Hele operasjonen ligger i én transaksjon med en per-plan advisory lock.
 * Oppdraget, visitten, forekomsten og flyttingen av `nextDueDate` committes
 * sammen, slik at en krasj aldri kan etterlate en forekomst uten oppdrag.
 */
export async function generateMaintenanceOccurrence(
  planId: string,
  now = new Date(),
): Promise<MaintenanceGenerationResult> {
  const id = cleanId(planId);
  if (!id) return { planId: id, skipped: "not-found" };

  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockPlan(tx, id);

        const plan = await tx.maintenancePlan.findUnique({
          where: { id },
          include: {
            customer: { select: { id: true, name: true, deletedAt: true } },
          },
        });
        if (!plan) return { planId: id, skipped: "not-found" as const };
        if (!plan.isActive) {
          return { planId: id, skipped: "inactive" as const };
        }
        if (plan.trigger !== "CALENDAR") {
          return { planId: id, skipped: "not-calendar" as const };
        }
        if (plan.customer.deletedAt) {
          return { planId: id, skipped: "customer-deleted" as const };
        }
        if (!plan.nextDueDate || !plan.intervalMonths) {
          return { planId: id, skipped: "inactive" as const };
        }

        const today = todayUtc(now);
        const dueDate = plan.nextDueDate;
        if (dueDate > addDaysUtc(today, plan.leadDays)) {
          return { planId: id, skipped: "not-due" as const };
        }

        const existing = await tx.maintenancePlanOccurrence.findUnique({
          where: {
            planId_dueDate: { planId: id, dueDate },
          },
          select: { id: true, workOrderId: true },
        });
        if (existing) {
          return {
            planId: id,
            occurrenceId: existing.id,
            workOrderId: existing.workOrderId ?? undefined,
            skipped: "already-generated" as const,
          };
        }

        const workOrder = await tx.workOrder.create({
          data: {
            title: plan.title,
            description: `Forebyggende vedlikehold fra vedlikeholdsplanen «${plan.title}».`,
            departmentId: plan.departmentId,
            customerId: plan.customerId,
            productId: plan.productId,
            scheduledFor: dueDate,
            status: "PLANNED",
            creatorName: "Vedlikeholdsplan",
            templates: plan.templateId
              ? { connect: { id: plan.templateId } }
              : undefined,
          },
          select: { id: true },
        });

        await createDefaultVisit(tx, {
          workOrderId: workOrder.id,
          startsAt: osloDayStart(toDateOnly(dueDate)),
          endsAt: osloDayStart(toDateOnly(addDaysUtc(dueDate, 1))),
          allDay: true,
        });

        const occurrence = await tx.maintenancePlanOccurrence.create({
          data: {
            planId: id,
            dueDate,
            status: "GENERATED",
            workOrderId: workOrder.id,
          },
          select: { id: true },
        });

        await tx.maintenancePlan.update({
          where: { id },
          data: {
            nextDueDate: addMonthsUtc(dueDate, plan.intervalMonths),
          },
        });

        await audit(tx, {
          entityType: "MaintenancePlan",
          entityId: id,
          action: `Genererte forebyggende oppdrag: ${plan.title}`,
          actor: {
            id: "system",
            name: "Vedlikeholdsplan",
            email: null,
          },
          metadata: {
            occurrenceId: occurrence.id,
            workOrderId: workOrder.id,
            dueDate: toDateOnly(dueDate),
          },
        });

        return {
          planId: id,
          workOrderId: workOrder.id,
          occurrenceId: occurrence.id,
        };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { planId: id, skipped: "already-generated" };
    }
    return {
      planId: id,
      skipped: "error",
      error: error instanceof Error ? error.message : "Ukjent feil",
    };
  }
}

/**
 * Kjører alle kalenderplaner som er innenfor ledetiden. Hver plan har sin egen
 * transaksjon og lås, så to samtidige kjøringer gir nøyaktig én forekomst.
 */
export async function generateDueMaintenanceWorkOrders(
  now = new Date(),
): Promise<MaintenanceGenerationResult[]> {
  const today = todayUtc(now);
  const plans = await prisma.maintenancePlan.findMany({
    where: {
      isActive: true,
      trigger: "CALENDAR",
      nextDueDate: { not: null, lte: addDaysUtc(today, 365) },
      customer: { deletedAt: null },
    },
    orderBy: { nextDueDate: "asc" },
    take: 200,
    select: { id: true, nextDueDate: true, leadDays: true },
  });

  const results: MaintenanceGenerationResult[] = [];
  for (const plan of plans) {
    if (
      plan.nextDueDate &&
      plan.nextDueDate > addDaysUtc(today, plan.leadDays)
    ) {
      continue;
    }
    results.push(await generateMaintenanceOccurrence(plan.id, now));
  }
  return results;
}

export type MeterMaintenanceInput = {
  productId: string;
  value: number;
  readAt: Date;
  actor: ServiceActor;
};

/**
 * Kontrollerer alle aktive målerplaner for en enhet etter at en måling er
 * lagret. Kalles inne i målingens transaksjon.
 *
 * `lastMeterValue` er utgangspunktet. En ny måling som passerer terskelen lager
 * nøyaktig ett oppdrag, og flytter utgangspunktet til målt verdi. To samtidige
 * målinger serialiseres av per-plan-låsen, så bare den første kan passere.
 */
export async function evaluateMeterMaintenance(
  tx: Prisma.TransactionClient,
  input: MeterMaintenanceInput,
): Promise<ServiceResult<{ workOrderIds: string[] }>> {
  const plans = await tx.maintenancePlan.findMany({
    where: {
      productId: input.productId,
      trigger: "METER",
      isActive: true,
      meterInterval: { not: null },
    },
    orderBy: { id: "asc" },
    take: 100,
    select: { id: true },
  });

  const workOrderIds: string[] = [];

  for (const candidate of plans) {
    await lockPlan(tx, candidate.id);

    const plan = await tx.maintenancePlan.findUnique({
      where: { id: candidate.id },
      include: {
        customer: { select: { deletedAt: true } },
        product: {
          select: {
            id: true,
            model: true,
            meterUnit: true,
            customer: { select: { deletedAt: true } },
          },
        },
      },
    });
    if (!plan || !plan.isActive || plan.customer.deletedAt) continue;
    if (!plan.meterInterval) continue;
    if (plan.product?.customer.deletedAt) continue;

    const interval = Number(plan.meterInterval);
    if (!Number.isFinite(interval) || interval <= 0) continue;

    const previous = plan.lastMeterValue
      ? Number(plan.lastMeterValue)
      : null;
    if (previous === null) {
      // Første måling etter at planen ble opprettet er utgangspunktet, ikke et
      // brudd. Da unngår vi et oppdrag bare fordi det fantes historikk.
      await tx.maintenancePlan.update({
        where: { id: plan.id },
        data: { lastMeterValue: decimal(input.value) },
      });
      continue;
    }

    if (input.value - previous < interval) continue;

    const dueDate = new Date(
      Date.UTC(
        input.readAt.getUTCFullYear(),
        input.readAt.getUTCMonth(),
        input.readAt.getUTCDate(),
      ),
    );
    const existing = await tx.maintenancePlanOccurrence.findUnique({
      where: { planId_dueDate: { planId: plan.id, dueDate } },
      select: { id: true, workOrderId: true },
    });
    if (existing) {
      await tx.maintenancePlan.update({
        where: { id: plan.id },
        data: { lastMeterValue: decimal(input.value) },
      });
      continue;
    }

    const unit = plan.product?.meterUnit ?? plan.product?.model ?? "";
    const workOrder = await tx.workOrder.create({
      data: {
        title: plan.title,
        description:
          `Forebyggende vedlikehold utløst av måler: ${input.value}` +
          `${unit ? ` ${unit}` : ""} (terskel ${interval}).`,
        departmentId: plan.departmentId,
        customerId: plan.customerId,
        productId: plan.productId,
        scheduledFor: dueDate,
        status: "PLANNED",
        creatorName: "Vedlikeholdsplan",
        templates: plan.templateId
          ? { connect: { id: plan.templateId } }
          : undefined,
      },
      select: { id: true },
    });

    await createDefaultVisit(tx, {
      workOrderId: workOrder.id,
      startsAt: osloDayStart(toDateOnly(dueDate)),
      endsAt: osloDayStart(toDateOnly(addDaysUtc(dueDate, 1))),
      allDay: true,
    });

    await tx.maintenancePlanOccurrence.create({
      data: {
        planId: plan.id,
        dueDate,
        status: "GENERATED",
        workOrderId: workOrder.id,
        meterValue: decimal(input.value),
      },
    });

    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: { lastMeterValue: decimal(input.value) },
    });

    await audit(tx, {
      entityType: "MaintenancePlan",
      entityId: plan.id,
      action: `Genererte målerbasert vedlikehold: ${plan.title}`,
      actor: toAuditActor(input.actor),
      metadata: {
        productId: input.productId,
        workOrderId: workOrder.id,
        value: input.value,
        dueDate: toDateOnly(dueDate),
      },
    });

    workOrderIds.push(workOrder.id);
  }

  return ok({ workOrderIds });
}
