// i18n-ignore-file: revisjonsloggen lagrer stabile, ferdig formaterte norske
// handlingsstrenger. De oversettes ved visning i `src/lib/audit-actions.ts`;
// tjenesten har ingen direkte UI-tekst.
/**
 * Serviceavtaler: CRUD, livssyklus, dekning og prislister.
 *
 * Avtalen er en planleggings- og dokumentasjonsenhet. `indexationPercent` og
 * prislister er referansedata til visning – tjenesten beregner, fakturerer
 * eller eksporterer aldri beløp.
 */

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { contractIntervalLabel, isContractInterval } from "@/lib/contracts";
import {
  addMonthsUtc,
  dateOnlyInOslo,
  firstOccurrenceOnOrAfter,
  parseDateOnly,
  todayUtc,
  toDateOnly,
} from "@/lib/dates";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  contractCreateSchema,
  contractLineCreateSchema,
  contractLineDeleteSchema,
  contractUpdateSchema,
  priceListCreateSchema,
  priceListItemCreateSchema,
  priceListItemDeleteSchema,
} from "@/lib/schemas/contract";
import { generateRecurringWorkOrderForContract, isUniqueViolation } from "@/lib/recurring";
import { getDefaultDepartmentId } from "@/lib/departments";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Avdelingssperren for avtaler. Administrator ser alt, kunden bare sitt. */
export function contractScopeFor(actor: ServiceActor): Prisma.ContractWhereInput {
  if (!actor.isActive) return { id: { in: [] } };
  if (actor.role === "ADMIN") return {};
  if (actor.role === "CUSTOMER") {
    return actor.customerId
      ? { customerId: actor.customerId }
      : { id: { in: [] } };
  }
  if (!can(actor, "contracts.view") && !can(actor, "contracts.manage")) {
    return { id: { in: [] } };
  }
  if (!actor.departmentId) return { id: { in: [] } };
  return {
    departmentId: actor.departmentId,
    department: { isActive: true },
  };
}

async function contractAccess(actor: ServiceActor, contractId: string) {
  const id = cleanText(contractId, { maxLength: LIMITS.line });
  if (!id) return null;
  return prisma.contract.findFirst({
    where: { id, AND: [contractScopeFor(actor)] },
    select: {
      id: true,
      customerId: true,
      departmentId: true,
      title: true,
      contractNumber: true,
      intervalMonths: true,
      startDate: true,
      endDate: true,
      status: true,
      renewalMode: true,
      noticeDays: true,
      indexationPercent: true,
      contactId: true,
      templateId: true,
      slaPolicyId: true,
      priceListId: true,
    },
  });
}

function optionalId(value: unknown): string | null {
  return cleanText(value, { maxLength: LIMITS.line }) || null;
}

function parseOptionalPercent(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseNoticeDays(value: unknown): number {
  if (value === undefined || value === null || value === "") return 30;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 30;
}

type DepartmentRow = { id: string; name: string };

async function resolveDepartment(
  actor: ServiceActor,
  requested: unknown,
): Promise<DepartmentRow | null> {
  if (isAdminActor(actor)) {
    const id = optionalId(requested);
    if (id) {
      return prisma.department.findFirst({
        where: { id, isActive: true },
        select: { id: true, name: true },
      });
    }
    const defaultId = await getDefaultDepartmentId();
    return defaultId
      ? prisma.department.findFirst({
          where: { id: defaultId, isActive: true },
          select: { id: true, name: true },
        })
      : null;
  }
  if (!actor.departmentId) return null;
  return prisma.department.findFirst({
    where: { id: actor.departmentId, isActive: true },
    select: { id: true, name: true },
  });
}

async function validSlaPolicyId(
  policyId: string | null,
  departmentId: string,
): Promise<string | null> {
  if (!policyId) return null;
  const policy = await prisma.slaPolicy.findFirst({
    where: {
      id: policyId,
      isActive: true,
      OR: [{ departmentId }, { departmentId: null }],
    },
    select: { id: true },
  });
  return policy?.id ?? null;
}

async function validPriceListId(priceListId: string | null): Promise<string | null> {
  if (!priceListId) return null;
  const list = await prisma.priceList.findFirst({
    where: { id: priceListId, isActive: true },
    select: { id: true },
  });
  return list?.id ?? null;
}

async function validContactId(
  contactId: string | null,
  customerId: string,
): Promise<string | null> {
  if (!contactId) return null;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, customerId },
    select: { id: true },
  });
  return contact?.id ?? null;
}

async function validTemplateId(templateId: string | null): Promise<string | null> {
  if (!templateId) return null;
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  return template?.id ?? null;
}

async function validLines(
  customerId: string,
  lines: unknown,
): Promise<
  | Array<{
      productId: string | null;
      scope: string;
      visitsPerYear: number | null;
      responseMinutes: number | null;
      resolutionMinutes: number | null;
    }>
  | null
> {
  if (lines === undefined) return [];
  if (!Array.isArray(lines)) return null;
  if (lines.length > 200) return null;

  const result = [];
  for (const raw of lines) {
    const parsed = contractLineCreateSchema.safeParse({
      contractId: "placeholder",
      ...(typeof raw === "object" && raw !== null ? raw : {}),
    });
    if (!parsed.success) return null;

    const productId = parsed.data.productId ?? null;
    if (productId) {
      const product = await prisma.product.findFirst({
        where: { id: productId, customerId },
        select: { id: true },
      });
      if (!product) return null;
    }
    result.push({
      productId,
      scope: cleanText(parsed.data.scope, { maxLength: LIMITS.text }),
      visitsPerYear: parsed.data.visitsPerYear ?? null,
      responseMinutes: parsed.data.responseMinutes ?? null,
      resolutionMinutes: parsed.data.resolutionMinutes ?? null,
    });
  }
  return result;
}

export type ContractCreateInput = {
  title?: unknown;
  contractNumber?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  intervalMonths?: unknown;
  departmentId?: unknown;
  contactId?: unknown;
  templateId?: unknown;
  slaPolicyId?: unknown;
  priceListId?: unknown;
  status?: unknown;
  renewalMode?: unknown;
  noticeDays?: unknown;
  indexationPercent?: unknown;
  lines?: unknown;
};

export async function createContract(
  actor: ServiceActor,
  customerId: string,
  input: ContractCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");

  const department = await resolveDepartment(actor, input.departmentId);
  if (!department) return fail("forbidden");

  const parsed = contractCreateSchema.safeParse({
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    contractNumber: cleanText(input.contractNumber, { maxLength: LIMITS.line }),
    startDate: cleanText(input.startDate, { maxLength: LIMITS.line }),
    endDate: cleanText(input.endDate, { maxLength: LIMITS.line }),
    intervalMonths: cleanText(input.intervalMonths, { maxLength: LIMITS.short }),
    departmentId: department.id,
    contactId: cleanText(input.contactId, { maxLength: LIMITS.line }),
    templateId: cleanText(input.templateId, { maxLength: LIMITS.line }),
    slaPolicyId: cleanText(input.slaPolicyId, { maxLength: LIMITS.line }),
    priceListId: cleanText(input.priceListId, { maxLength: LIMITS.line }),
    status: input.status,
    renewalMode: input.renewalMode,
    noticeDays: input.noticeDays,
    indexationPercent: input.indexationPercent,
  });
  if (!parsed.success) return fail("invalid");

  const {
    title,
    contractNumber,
    intervalMonths,
    status = "ACTIVE",
    renewalMode = "MANUAL",
  } = parsed.data;
  const startDate = parseDateOnly(parsed.data.startDate);
  const endDate = parseDateOnly(parsed.data.endDate);
  if (!startDate || !isContractInterval(intervalMonths)) return fail("invalid");
  if (endDate && endDate < startDate) return fail("invalid");

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) return fail("not_found");

  const [contactId, templateId, slaPolicyId, priceListId, lines] =
    await Promise.all([
      validContactId(optionalId(parsed.data.contactId), customerId),
      validTemplateId(optionalId(parsed.data.templateId)),
      validSlaPolicyId(optionalId(parsed.data.slaPolicyId), department.id),
      validPriceListId(optionalId(parsed.data.priceListId)),
      validLines(customerId, input.lines),
    ]);
  if (!lines) return fail("invalid");

  const nextServiceDate = firstOccurrenceOnOrAfter(
    startDate,
    intervalMonths,
    todayUtc(),
  );
  const isActive = status === "ACTIVE";

  let contractId: string;
  try {
    contractId = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          title,
          contractNumber: contractNumber || null,
          startDate,
          endDate,
          intervalMonths,
          nextServiceDate,
          status,
          isActive,
          renewalMode,
          noticeDays: parseNoticeDays(parsed.data.noticeDays),
          indexationPercent: parseOptionalPercent(
            parsed.data.indexationPercent,
          ),
          customerId,
          departmentId: department.id,
          contactId,
          templateId,
          slaPolicyId,
          priceListId,
          lines: {
            create: lines,
          },
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Opprettet serviceavtale: ${title} (${contractIntervalLabel(intervalMonths)})`,
        actor: toAuditActor(actor),
        metadata: {
          contractId: created.id,
          contractNumber: contractNumber || null,
          status,
        },
      });
      return created.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict");
    throw error;
  }

  if (isActive && nextServiceDate <= new Date()) {
    try {
      await generateRecurringWorkOrderForContract(contractId);
    } catch (error) {
      console.error("Kunne ikke opprette første serviceavtale-oppdrag:", error);
    }
  }

  return ok({ id: contractId });
}

export async function updateContract(
  actor: ServiceActor,
  contractId: string,
  input: ContractCreateInput,
): Promise<ServiceResult> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const current = await contractAccess(actor, contractId);
  if (!current) return fail("not_found");

  const department =
    isAdminActor(actor) && input.departmentId !== undefined
      ? await resolveDepartment(actor, input.departmentId)
      : { id: current.departmentId, name: "" };
  if (!department) return fail("forbidden");

  // PATCH kan sende bare noen felter. Utelatte verdier beholder dagens verdi;
  // en tom streng er en bevisst nullstilling.
  const pick = <T,>(value: T | undefined, fallback: T): T =>
    value === undefined ? fallback : value;

  const parsed = contractUpdateSchema.safeParse({
    id: current.id,
    title: cleanText(pick(input.title, current.title), {
      maxLength: LIMITS.title,
    }),
    contractNumber: cleanText(
      pick(input.contractNumber, current.contractNumber ?? ""),
      { maxLength: LIMITS.line },
    ),
    startDate: cleanText(
      pick(input.startDate, toDateOnly(current.startDate)),
      { maxLength: LIMITS.line },
    ),
    endDate: cleanText(
      pick(input.endDate, current.endDate ? toDateOnly(current.endDate) : ""),
      { maxLength: LIMITS.line },
    ),
    intervalMonths: cleanText(
      pick(input.intervalMonths, current.intervalMonths),
      { maxLength: LIMITS.short },
    ),
    departmentId: department.id,
    contactId: cleanText(
      pick(input.contactId, current.contactId ?? ""),
      { maxLength: LIMITS.line },
    ),
    templateId: cleanText(
      pick(input.templateId, current.templateId ?? ""),
      { maxLength: LIMITS.line },
    ),
    slaPolicyId: cleanText(
      pick(input.slaPolicyId, current.slaPolicyId ?? ""),
      { maxLength: LIMITS.line },
    ),
    priceListId: cleanText(
      pick(input.priceListId, current.priceListId ?? ""),
      { maxLength: LIMITS.line },
    ),
    status: input.status,
    renewalMode: pick(input.renewalMode, current.renewalMode),
    noticeDays: pick(input.noticeDays, current.noticeDays),
    indexationPercent: pick(
      input.indexationPercent,
      current.indexationPercent ? Number(current.indexationPercent) : undefined,
    ),
  });
  if (!parsed.success) return fail("invalid");

  const { title, contractNumber, intervalMonths } = parsed.data;
  const startDate = parseDateOnly(parsed.data.startDate);
  const endDate = parseDateOnly(parsed.data.endDate);
  if (!startDate || !isContractInterval(intervalMonths)) return fail("invalid");
  if (endDate && endDate < startDate) return fail("invalid");

  const [contactId, templateId, slaPolicyId, priceListId] = await Promise.all([
    validContactId(optionalId(parsed.data.contactId), current.customerId),
    validTemplateId(optionalId(parsed.data.templateId)),
    validSlaPolicyId(optionalId(parsed.data.slaPolicyId), department.id),
    validPriceListId(optionalId(parsed.data.priceListId)),
  ]);

  const status = parsed.data.status ?? current.status;
  const nextServiceDate =
    startDate.getTime() !== current.startDate.getTime() ||
    intervalMonths !== current.intervalMonths
      ? firstOccurrenceOnOrAfter(startDate, intervalMonths, todayUtc())
      : undefined;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: current.id },
        data: {
          title,
          contractNumber: contractNumber || null,
          startDate,
          endDate,
          intervalMonths,
          ...(nextServiceDate ? { nextServiceDate } : {}),
          status,
          isActive: status === "ACTIVE",
          renewalMode: parsed.data.renewalMode ?? "MANUAL",
          noticeDays: parseNoticeDays(parsed.data.noticeDays),
          indexationPercent: parseOptionalPercent(
            parsed.data.indexationPercent,
          ),
          departmentId: department.id,
          contactId,
          templateId,
          slaPolicyId,
          priceListId,
        },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: current.customerId,
        action: `Oppdaterte serviceavtale: ${title}`,
        actor: toAuditActor(actor),
        metadata: { contractId: current.id, status },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict");
    throw error;
  }

  return ok(undefined);
}

async function setStatus(
  actor: ServiceActor,
  contractId: string,
  status: "ACTIVE" | "PAUSED" | "TERMINATED" | "DRAFT",
  action: string,
): Promise<ServiceResult> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const contract = await contractAccess(actor, contractId);
  if (!contract) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contract.id },
      data: { status, isActive: status === "ACTIVE" },
    });
    await audit(tx, {
      entityType: "Customer",
      entityId: contract.customerId,
      action: `${action}: ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: { contractId: contract.id, from: contract.status, to: status },
    });
  });

  if (status === "ACTIVE") {
    try {
      await generateRecurringWorkOrderForContract(contract.id);
    } catch (error) {
      console.error("Kunne ikke gjenoppta serviceavtale:", error);
    }
  }
  return ok(undefined);
}

export function pauseContract(actor: ServiceActor, contractId: string) {
  return setStatus(actor, contractId, "PAUSED", "Pauset serviceavtale");
}

export function resumeContract(actor: ServiceActor, contractId: string) {
  return setStatus(actor, contractId, "ACTIVE", "Aktiverte serviceavtale");
}

export function terminateContract(actor: ServiceActor, contractId: string) {
  return setStatus(
    actor,
    contractId,
    "TERMINATED",
    "Avsluttet serviceavtale",
  );
}

/**
 * Fornyer avtalen med ett intervall fra siste sluttdato (eller i dag).
 * Automatisk fornyelse bruker samme funksjon via schedulerens låste løp.
 */
export async function renewContract(
  actor: ServiceActor,
  contractId: string,
  options: { now?: Date } = {},
): Promise<ServiceResult<{ endDate: string }>> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const contract = await contractAccess(actor, contractId);
  if (!contract) return fail("not_found");
  if (contract.status === "TERMINATED") return fail("conflict");

  const now = options.now ?? new Date();
  const today = todayUtc(now);
  const base =
    contract.endDate && contract.endDate > today
      ? contract.endDate
      : today;
  const endDate = addMonthsUtc(base, contract.intervalMonths);

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        endDate,
        status: "ACTIVE",
        isActive: true,
        nextServiceDate: firstOccurrenceOnOrAfter(
          contract.startDate,
          contract.intervalMonths,
          today,
        ),
      },
    });
    await audit(tx, {
      entityType: "Customer",
      entityId: contract.customerId,
      action: `Fornyet serviceavtale: ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: {
        contractId: contract.id,
        previousEndDate: contract.endDate ? toDateOnly(contract.endDate) : null,
        endDate: toDateOnly(endDate),
      },
    });
  });

  // Fornyelsen kan ha gjort en forfalt service aktuell. Generatoren er
  // idempotent og låser avtalen, så et samtidig scheduler-løp lager ikke to.
  if (toDateOnly(firstOccurrenceOnOrAfter(contract.startDate, contract.intervalMonths, today)) <= toDateOnly(now)) {
    try {
      await generateRecurringWorkOrderForContract(contract.id, now);
    } catch (error) {
      console.error("Kunne ikke lage oppdrag etter fornyelse:", error);
    }
  }

  return ok({ endDate: toDateOnly(endDate) });
}

export async function toggleContract(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown; active?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");
  const contract = await prisma.contract.findFirst({
    where: { id, customerId },
    select: { id: true },
  });
  if (!contract) return fail("not_found");
  return input.active === true || input.active === "true"
    ? resumeContract(actor, id)
    : pauseContract(actor, id);
}

export async function deleteContract(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown },
): Promise<ServiceResult> {
  // Sletting er alltid forbeholdt administrator.
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const contract = await prisma.contract.findFirst({
    where: { id, customerId },
    select: { id: true, title: true },
  });
  if (!contract) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.contract.delete({ where: { id } });
    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `Slettet serviceavtale: ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: { contractId: id },
    });
  });
  return ok(undefined);
}

export type ContractListFilters = {
  status?: string | null;
  customerId?: string | null;
  expiringDays?: number | null;
  query?: string | null;
  page?: number;
  pageSize?: number;
};

const CONTRACT_STATUS_VALUES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "EXPIRED",
  "TERMINATED",
] as const;

export type ContractStatusValue = (typeof CONTRACT_STATUS_VALUES)[number];

export function isContractStatus(value: string): value is ContractStatusValue {
  return (CONTRACT_STATUS_VALUES as readonly string[]).includes(value);
}

/** Avdelingssikret, paginert avtaleliste for /avtaler og API-et. */
export async function listContracts(
  actor: ServiceActor,
  filters: ContractListFilters = {},
) {
  if (!can(actor, "contracts.view") && !can(actor, "contracts.manage")) {
    return fail("forbidden");
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const query = cleanText(filters.query, { maxLength: LIMITS.title });
  const customerId = optionalId(filters.customerId);
  const status =
    filters.status && isContractStatus(filters.status)
      ? filters.status
      : null;
  if (filters.status && !status) return fail("invalid");

  const today = todayUtc();
  const expiringUntil =
    filters.expiringDays && filters.expiringDays > 0
      ? new Date(today.getTime() + filters.expiringDays * 86_400_000)
      : null;

  const filtersWhere: Prisma.ContractWhereInput = {
    ...(customerId ? { customerId } : {}),
    ...(status ? { status } : {}),
    ...(expiringUntil
      ? {
          endDate: { not: null, gte: today, lte: expiringUntil },
          status: "ACTIVE" as const,
        }
      : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            {
              contractNumber: {
                contains: query,
                mode: "insensitive" as const,
              },
            },
            {
              customer: {
                name: { contains: query, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {}),
  };

  const where: Prisma.ContractWhereInput = {
    AND: [contractScopeFor(actor), filtersWhere],
  };

  const [total, contracts] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      orderBy: [
        { endDate: { sort: "asc", nulls: "last" } },
        { startDate: "desc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        slaPolicy: { select: { id: true, name: true } },
        priceList: { select: { id: true, name: true } },
        _count: { select: { lines: true, workOrders: true } },
      },
    }),
  ]);

  return ok({ contracts, total, page, pageSize });
}

/** Ett avtaledetalj med linjer, prisliste og siste oppdrag. */
export async function getContract(actor: ServiceActor, contractId: string) {
  if (!can(actor, "contracts.view") && !can(actor, "contracts.manage")) {
    return fail("forbidden");
  }
  const id = cleanText(contractId, { maxLength: LIMITS.line });
  if (!id) return fail("not_found");

  const contract = await prisma.contract.findFirst({
    where: { id, AND: [contractScopeFor(actor)] },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          customerNumber: true,
          orgNumber: true,
          address: true,
          postalCode: true,
          city: true,
          phone: true,
          email: true,
        },
      },
      department: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true, email: true, phone: true } },
      template: { select: { id: true, title: true } },
      slaPolicy: {
        select: {
          id: true,
          name: true,
          responseMinutes: true,
          resolutionMinutes: true,
          businessHoursOnly: true,
        },
      },
      priceList: {
        select: {
          id: true,
          name: true,
          items: {
            orderBy: { code: "asc" },
            take: 200,
            select: {
              id: true,
              code: true,
              label: true,
              unit: true,
              amount: true,
            },
          },
        },
      },
      lines: {
        orderBy: { createdAt: "asc" },
        take: 200,
        include: {
          product: {
            select: { id: true, model: true, serialNumber: true, location: true },
          },
        },
      },
      workOrders: {
        orderBy: { scheduledFor: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          status: true,
          scheduledFor: true,
        },
      },
    },
  });
  if (!contract) return fail("not_found");
  return ok({ contract });
}

export type ContractDetailResult = Awaited<ReturnType<typeof getContract>>;
export type ContractDetail = Extract<
  ContractDetailResult,
  { ok: true }
>["data"]["contract"];

// ---------------------------------------------------------------------------
// Dekning
// ---------------------------------------------------------------------------

export type CoverageMatch = {
  contractId: string;
  contractNumber: string | null;
  title: string;
  startDate: string;
  endDate: string | null;
  lineId: string | null;
  scope: string;
  visitsPerYear: number | null;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
};

/**
 * Dekningen for et produkt på et tidspunkt. En avtale uten linjer dekker alt
 * utstyr; en linje uten produkt dekker alt utstyr, ellers må produktet matche.
 */
export async function coverageFor(
  customerId: string,
  productId: string | null = null,
  at: Date = new Date(),
): Promise<{
  covered: boolean;
  at: string;
  matches: CoverageMatch[];
}> {
  const atDate = parseDateOnly(dateOnlyInOslo(at)) ?? todayUtc();
  const contracts = await prisma.contract.findMany({
    where: {
      customerId,
      status: "ACTIVE",
      startDate: { lte: atDate },
      OR: [{ endDate: null }, { endDate: { gte: atDate } }],
    },
    orderBy: { startDate: "desc" },
    take: 100,
    select: {
      id: true,
      contractNumber: true,
      title: true,
      startDate: true,
      endDate: true,
      lines: {
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          productId: true,
          scope: true,
          visitsPerYear: true,
          responseMinutes: true,
          resolutionMinutes: true,
        },
      },
    },
  });

  const matches: CoverageMatch[] = [];
  for (const contract of contracts) {
    const lines =
      contract.lines.length === 0
        ? [null]
        : contract.lines.filter(
            (line) => line.productId === null || line.productId === productId,
          );
    for (const line of lines) {
      matches.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        title: contract.title,
        startDate: toDateOnly(contract.startDate),
        endDate: contract.endDate ? toDateOnly(contract.endDate) : null,
        lineId: line?.id ?? null,
        scope: line?.scope ?? "",
        visitsPerYear: line?.visitsPerYear ?? null,
        responseMinutes: line?.responseMinutes ?? null,
        resolutionMinutes: line?.resolutionMinutes ?? null,
      });
    }
  }

  return {
    covered: matches.length > 0,
    at: toDateOnly(atDate),
    matches,
  };
}

// ---------------------------------------------------------------------------
// Avtalelinjer
// ---------------------------------------------------------------------------

export async function addContractLine(
  actor: ServiceActor,
  input: {
    contractId?: unknown;
    productId?: unknown;
    scope?: unknown;
    visitsPerYear?: unknown;
    responseMinutes?: unknown;
    resolutionMinutes?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");

  const contractId = cleanText(input.contractId, { maxLength: LIMITS.line });
  const contract = contractId
    ? await contractAccess(actor, contractId)
    : null;
  if (!contract) return fail("not_found");

  const parsed = contractLineCreateSchema.safeParse({
    contractId: contract.id,
    productId: cleanText(input.productId, { maxLength: LIMITS.line }),
    scope: cleanText(input.scope, { maxLength: LIMITS.text }),
    visitsPerYear: input.visitsPerYear,
    responseMinutes: input.responseMinutes,
    resolutionMinutes: input.resolutionMinutes,
  });
  if (!parsed.success) return fail("invalid");

  const productId = parsed.data.productId ?? null;
  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, customerId: contract.customerId },
      select: { id: true },
    });
    if (!product) return fail("invalid");
  }

  const line = await prisma.$transaction(async (tx) => {
    const created = await tx.contractLine.create({
      data: {
        contractId: contract.id,
        productId,
        scope: parsed.data.scope ?? "",
        visitsPerYear: parsed.data.visitsPerYear ?? null,
        responseMinutes: parsed.data.responseMinutes ?? null,
        resolutionMinutes: parsed.data.resolutionMinutes ?? null,
      },
      select: { id: true },
    });
    await audit(tx, {
      entityType: "Customer",
      entityId: contract.customerId,
      action: `La til avtalelinje på ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: { contractId: contract.id, lineId: created.id, productId },
    });
    return created;
  });

  return ok({ id: line.id });
}

export async function deleteContractLine(
  actor: ServiceActor,
  input: { id?: unknown; contractId?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");

  const parsed = contractLineDeleteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    contractId: cleanText(input.contractId, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const contract = await contractAccess(actor, parsed.data.contractId);
  if (!contract) return fail("not_found");

  const line = await prisma.contractLine.findFirst({
    where: { id: parsed.data.id, contractId: contract.id },
    select: { id: true },
  });
  if (!line) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.contractLine.delete({ where: { id: line.id } });
    await audit(tx, {
      entityType: "Customer",
      entityId: contract.customerId,
      action: `Fjernet avtalelinje fra ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: { contractId: contract.id, lineId: line.id },
    });
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Prislister (referansedata, ingen fakturering)
// ---------------------------------------------------------------------------

export async function listPriceLists(actor: ServiceActor) {
  if (!can(actor, "contracts.view") && !can(actor, "contracts.manage")) {
    return fail("forbidden");
  }
  const priceLists = await prisma.priceList.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 100,
    include: {
      items: { orderBy: { code: "asc" }, take: 200 },
      _count: { select: { contracts: true } },
    },
  });
  return ok({ priceLists });
}

export async function createPriceList(
  actor: ServiceActor,
  input: { name?: unknown; isActive?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const parsed = priceListCreateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.title }),
    isActive: input.isActive,
  });
  if (!parsed.success) return fail("invalid");

  const priceList = await prisma.$transaction(async (tx) => {
    const created = await tx.priceList.create({
      data: {
        name: parsed.data.name,
        isActive: parsed.data.isActive !== "false",
      },
      select: { id: true },
    });
    await audit(tx, {
      entityType: "PriceList",
      entityId: created.id,
      action: `Opprettet prisliste: ${parsed.data.name}`,
      actor: toAuditActor(actor),
    });
    return created;
  });
  return ok({ id: priceList.id });
}

export async function addPriceListItem(
  actor: ServiceActor,
  input: {
    priceListId?: unknown;
    code?: unknown;
    label?: unknown;
    unit?: unknown;
    amount?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const parsed = priceListItemCreateSchema.safeParse({
    priceListId: cleanText(input.priceListId, { maxLength: LIMITS.line }),
    code: cleanText(input.code, { maxLength: LIMITS.short }),
    label: cleanText(input.label, { maxLength: LIMITS.title }),
    unit: cleanText(input.unit, { maxLength: LIMITS.short }),
    amount: input.amount,
  });
  if (!parsed.success) return fail("invalid");

  const list = await prisma.priceList.findUnique({
    where: { id: parsed.data.priceListId },
    select: { id: true, name: true },
  });
  if (!list) return fail("not_found");

  try {
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.priceListItem.create({
        data: {
          priceListId: list.id,
          code: parsed.data.code,
          label: parsed.data.label,
          unit: parsed.data.unit,
          amount: parsed.data.amount,
        },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "PriceList",
        entityId: list.id,
        action: `La til prislistelinje ${parsed.data.code} i ${list.name}`,
        actor: toAuditActor(actor),
        metadata: { itemId: created.id, amount: parsed.data.amount },
      });
      return created;
    });
    return ok({ id: item.id });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict");
    throw error;
  }
}

export async function deletePriceListItem(
  actor: ServiceActor,
  input: { id?: unknown; priceListId?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "contracts.manage")) return fail("forbidden");
  const parsed = priceListItemDeleteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    priceListId: cleanText(input.priceListId, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");

  const item = await prisma.priceListItem.findFirst({
    where: { id: parsed.data.id, priceListId: parsed.data.priceListId },
    select: { id: true, code: true },
  });
  if (!item) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.priceListItem.delete({ where: { id: item.id } });
    await audit(tx, {
      entityType: "PriceList",
      entityId: parsed.data.priceListId,
      action: `Fjernet prislistelinje ${item.code}`,
      actor: toAuditActor(actor),
      metadata: { itemId: item.id },
    });
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Planlagte livssyklusjobber
// ---------------------------------------------------------------------------

export type ContractLifecycleResult = {
  renewed: number;
  expired: number;
  generated: number;
};

/**
 * Fornyer automatiske avtaler og utløper manuelle avtaler. Hver avtale
 * oppdateres med en betinget `updateMany` på forrige sluttdato, slik at to
 * samtidige scheduler-kjøringer bare fornyer én gang.
 */
export async function runContractLifecycle(
  now = new Date(),
): Promise<ContractLifecycleResult> {
  const today = todayUtc(now);
  const result: ContractLifecycleResult = {
    renewed: 0,
    expired: 0,
    generated: 0,
  };

  const auto = await prisma.contract.findMany({
    where: {
      status: "ACTIVE",
      renewalMode: "AUTO",
      endDate: { lt: today },
      customer: { deletedAt: null },
    },
    orderBy: { endDate: "asc" },
    take: 100,
    select: {
      id: true,
      customerId: true,
      title: true,
      startDate: true,
      endDate: true,
      intervalMonths: true,
      nextServiceDate: true,
    },
  });

  for (const contract of auto) {
    const base = contract.endDate && contract.endDate > today
      ? contract.endDate
      : today;
    const newEndDate = addMonthsUtc(base, contract.intervalMonths);
    const nextServiceDate = firstOccurrenceOnOrAfter(
      contract.startDate,
      contract.intervalMonths,
      today,
    );

    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.contract.updateMany({
        where: {
          id: contract.id,
          status: "ACTIVE",
          renewalMode: "AUTO",
          endDate: contract.endDate,
        },
        data: { endDate: newEndDate, nextServiceDate },
      });
      if (updated.count !== 1) return false;

      await audit(tx, {
        entityType: "Customer",
        entityId: contract.customerId,
        action: `Fornyet serviceavtale automatisk: ${contract.title}`,
        actor: { id: "", name: "Serviceavtale", email: null },
        metadata: {
          contractId: contract.id,
          previousEndDate: contract.endDate
            ? toDateOnly(contract.endDate)
            : null,
          endDate: toDateOnly(newEndDate),
        },
      });
      return true;
    });
    if (!changed) continue;
    result.renewed += 1;

    try {
      const generated = await generateRecurringWorkOrderForContract(
        contract.id,
        now,
      );
      if (generated.workOrderId) result.generated += 1;
    } catch (error) {
      console.error("Kunne ikke lage oppdrag etter automatisk fornyelse:", error);
    }
  }

  const expiring = await prisma.contract.findMany({
    where: {
      status: { in: ["ACTIVE", "PAUSED"] },
      renewalMode: "MANUAL",
      endDate: { lt: today },
    },
    orderBy: { endDate: "asc" },
    take: 200,
    select: {
      id: true,
      customerId: true,
      title: true,
      endDate: true,
    },
  });

  for (const contract of expiring) {
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.contract.updateMany({
        where: {
          id: contract.id,
          status: { in: ["ACTIVE", "PAUSED"] },
          renewalMode: "MANUAL",
          endDate: contract.endDate,
        },
        data: { status: "EXPIRED", isActive: false },
      });
      if (updated.count !== 1) return false;
      await audit(tx, {
        entityType: "Customer",
        entityId: contract.customerId,
        action: `Serviceavtalen utløp: ${contract.title}`,
        actor: { id: "", name: "Serviceavtale", email: null },
        metadata: {
          contractId: contract.id,
          endDate: contract.endDate ? toDateOnly(contract.endDate) : null,
        },
      });
      return true;
    });
    if (changed) result.expired += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Rendrer avtale-PDF-en. Etikettene er lokalisert i `contract-pdf-labels`. */
export async function getContractPdf(
  actor: ServiceActor,
  contractId: string,
  locale = "nb",
): Promise<
  | { ok: true; buffer: Buffer; fileName: string }
  | { ok: false; status: 403 | 404; message: string }
> {
  const result = await getContract(actor, contractId);
  if (!result.ok) {
    return result.reason === "forbidden"
      ? { ok: false, status: 403, message: "Ingen tilgang" }
      : { ok: false, status: 404, message: "Fant ikke avtalen" };
  }

  const { renderContractPdf } = await import("@/lib/contract-pdf");
  const buffer = await renderContractPdf(result.data.contract, locale);
  const number = result.data.contract.contractNumber || result.data.contract.id;
  return {
    ok: true,
    buffer,
    fileName: `Avtale-${number}.pdf`.replace(/[\\/:*?"<>|]/g, "-"),
  };
}
