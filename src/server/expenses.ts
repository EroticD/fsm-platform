// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger
// som historiske driftsdata, ikke UI-tekst.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import { cleanText, cleanUrl, LIMITS } from "@/lib/sanitize";
import { summarizeVisitTimes } from "@/lib/visit-time";
import { fieldAccess } from "@/lib/field-rbac";
import {
  DEFAULT_MILEAGE_RATE,
  DEFAULT_VAT_RATE,
  calculateMileageAmount,
  calculateVatFromGross,
  isValidVatAmount,
  payrollCsv,
  roundOre,
  type PayrollCsvRow,
} from "@/lib/expenses";
import {
  can,
  fail,
  isAdminActor,
  isOfficeActor,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "@/server/actor";
import { requireModule } from "@/server/modules";
import type { ErrorCode } from "@/lib/error-codes";

/**
 * Kjøreturer, utlegg og lønnsgrunnlag (FLD-01).
 *
 * Tjenestelaget eier all beregning: kilometer × sats og mva trekkes ut på
 * serveren, og klienten kan ikke sende ferdige beløp. Godkjenning og eksport er
 * kontorhandlinger. Selve tidsregistreringen gjenbrukes fra `Visit`; denne
 * modulen lager aldri en parallell timeføring.
 */

export const EXPENSE_ERROR_CODES = {
  invalidInput: "expenses.errors.invalidInput",
  invalidDate: "expenses.errors.invalidDate",
  invalidAmount: "expenses.errors.invalidAmount",
  invalidVat: "expenses.errors.invalidVat",
  invalidReceipt: "expenses.errors.invalidReceipt",
  invalidStatus: "expenses.errors.invalidStatus",
  reasonRequired: "expenses.errors.reasonRequired",
  periodOverlap: "expenses.errors.periodOverlap",
  invalidPeriod: "expenses.errors.invalidPeriod",
} as const satisfies Record<string, ErrorCode>;

const MAX_PERIOD_DAYS = 366;
const UPLOAD_STORED_NAME = /^[A-Za-z0-9._-]{1,200}$/;

function hasValue(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function parseDate(value: unknown): Date | null {
  const text = String(value ?? "").trim().slice(0, 10);
  const parsed = parseDateOnly(text);
  return parsed && toDateOnly(parsed) === text ? parsed : null;
}

function requireSubmit(actor: ServiceActor): ServiceFailure | null {
  if (!actor?.isActive || actor.role === "CUSTOMER") return fail("forbidden");
  const allowed =
    can(actor, "workorders.view") ||
    can(actor, "workorders.update") ||
    can(actor, "reports.write");
  return allowed ? null : fail("forbidden");
}

function requireApprove(actor: ServiceActor): ServiceFailure | null {
  if (!actor?.isActive || !isOfficeActor(actor)) return fail("forbidden");
  const allowed =
    can(actor, "workorders.edit") ||
    can(actor, "settings.manage") ||
    can(actor, "workorders.update");
  return allowed ? null : fail("forbidden");
}

function requireExport(actor: ServiceActor): ServiceFailure | null {
  if (!actor?.isActive || !isOfficeActor(actor)) return fail("forbidden");
  const allowed = can(actor, "settings.manage") || can(actor, "workorders.edit");
  return allowed ? null : fail("forbidden");
}

/** Lønnsbeløp er en egen feltgruppe; uten tilgang avvises hele eksporten. */
function requirePayrollAmounts(actor: ServiceActor): ServiceFailure | null {
  if (fieldAccess(actor, "payrollAmounts").masked) return fail("forbidden");
  return null;
}

function ownWhere(actor: ServiceActor): { userId: string } {
  return { userId: actor.id };
}

function departmentWhere(
  actor: ServiceActor,
): Prisma.MileageTripWhereInput & Prisma.ExpenseWhereInput {
  if (isAdminActor(actor)) return {};
  if (!actor.departmentId) return { userId: actor.id };
  return { departmentId: actor.departmentId };
}

function resolveDepartmentId(
  actor: ServiceActor,
  requested?: unknown,
): string | null {
  if (isAdminActor(actor) && hasValue(requested)) {
    return cleanText(requested, { maxLength: LIMITS.line });
  }
  return actor.departmentId ?? null;
}

async function verifyWorkOrder(
  actor: ServiceActor,
  workOrderId: unknown,
  visitId: unknown,
): Promise<ServiceResult<{ workOrderId: string | null; visitId: string | null }>> {
  const orderId = hasValue(workOrderId) ? cleanText(workOrderId, { maxLength: LIMITS.line }) : null;
  const sessionId = hasValue(visitId) ? cleanText(visitId, { maxLength: LIMITS.line }) : null;
  if (!orderId && !sessionId) return ok({ workOrderId: null, visitId: null });

  if (sessionId) {
    const visit = await prisma.visit.findFirst({
      where: {
        id: sessionId,
        workOrder: { ...workOrderScopeFor(actor), deletedAt: null },
      },
      select: { id: true, workOrderId: true },
    });
    if (!visit) return fail("not_found");
    if (orderId && visit.workOrderId !== orderId) {
      return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidInput });
    }
    return ok({ workOrderId: visit.workOrderId, visitId: visit.id });
  }

  const order = await prisma.workOrder.findFirst({
    where: { id: orderId!, ...workOrderScopeFor(actor) },
    select: { id: true },
  });
  if (!order) return fail("not_found");
  return ok({ workOrderId: order.id, visitId: null });
}

/**
 * Kvittering må komme fra den eksisterende opplastingsruten, eller være et
 * dokument brukeren har tilgang til. En vilkårlig ekstern URL avvises, slik at
 * lønnsgrunnlaget ikke kan peke på ukontrollert innhold.
 */
async function validateReceipt(
  actor: ServiceActor,
  input: { receiptUrl?: unknown; documentId?: unknown; workOrderId?: string | null },
): Promise<ServiceResult<{ receiptUrl: string | null; documentId: string | null }>> {
  const receiptUrlRaw = hasValue(input.receiptUrl) ? cleanUrl(input.receiptUrl) : "";
  const documentId = hasValue(input.documentId)
    ? cleanText(input.documentId, { maxLength: LIMITS.line })
    : null;

  let receiptUrl: string | null = null;
  if (receiptUrlRaw) {
    if (!receiptUrlRaw.startsWith("/uploads/")) {
      return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidReceipt });
    }
    const storedName = receiptUrlRaw.slice("/uploads/".length);
    if (!UPLOAD_STORED_NAME.test(storedName)) {
      return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidReceipt });
    }
    const upload = await prisma.upload.findFirst({
      where: {
        storedName,
        OR: [
          { uploadedById: actor.id },
          { ownerType: "USER", ownerId: actor.id },
          ...(input.workOrderId
            ? [{ ownerType: "WORK_ORDER", ownerId: input.workOrderId }]
            : []),
        ],
      },
      select: { id: true, storedName: true },
    });
    if (!upload) {
      return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidReceipt });
    }
    receiptUrl = `/uploads/${upload.storedName}`;
  }

  if (documentId) {
    if (!can(actor, "documents.view") && !can(actor, "documents.manage")) {
      return fail("forbidden");
    }
    const document = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: { id: true },
    });
    if (!document) {
      return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidReceipt });
    }
  }

  return ok({ receiptUrl, documentId });
}

export type MileageTripView = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  fromAddress: string;
  toAddress: string;
  km: number;
  rate: number;
  amount: number;
  purpose: string | null;
  status: string;
  workOrderId: string | null;
  visitId: string | null;
  rejectionReason: string | null;
  createdAt: Date;
};

export type ExpenseView = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  category: string;
  description: string | null;
  amount: number;
  vatAmount: number;
  status: string;
  workOrderId: string | null;
  receiptUrl: string | null;
  documentId: string | null;
  rejectionReason: string | null;
  createdAt: Date;
};

async function userNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, email: true },
  });
  return new Map(
    users.map((user) => [user.id, user.name || user.email || "Ukjent"]),
  );
}

export async function createMileageTrip(
  actor: ServiceActor,
  input: {
    date: unknown;
    fromAddress: unknown;
    toAddress: unknown;
    km: unknown;
    rate?: unknown;
    purpose?: unknown;
    workOrderId?: unknown;
    visitId?: unknown;
    submit?: unknown;
  },
): Promise<ServiceResult<{ id: string; amount: number }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;

  const date = parseDate(input.date);
  const fromAddress = cleanText(input.fromAddress, { maxLength: LIMITS.line });
  const toAddress = cleanText(input.toAddress, { maxLength: LIMITS.line });
  const km = Number(input.km);
  const rate = input.rate === undefined || input.rate === "" || input.rate === null
    ? DEFAULT_MILEAGE_RATE
    : Number(input.rate);
  const purpose = cleanText(input.purpose, { maxLength: LIMITS.text }) || null;

  if (!date) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidDate });
  }
  if (!fromAddress || !toAddress) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidInput });
  }
  if (!Number.isFinite(km) || km <= 0 || km > 100_000) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidAmount });
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1_000) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidAmount });
  }

  const target = await verifyWorkOrder(actor, input.workOrderId, input.visitId);
  if (!target.ok) return target;
  const amount = calculateMileageAmount(km, rate);
  const submitted = input.submit === false || input.submit === "false" ? false : true;

  return prisma.$transaction(async (tx) => {
    const trip = await tx.mileageTrip.create({
      data: {
        userId: actor.id,
        departmentId: actor.departmentId,
        workOrderId: target.data.workOrderId,
        visitId: target.data.visitId,
        date,
        fromAddress,
        toAddress,
        km: roundOre(km),
        rate,
        amount,
        purpose,
        status: submitted ? "PENDING" : "DRAFT",
        submittedAt: submitted ? new Date() : null,
      },
      select: { id: true },
    });
    await audit(tx, {
      entityType: "MileageTrip",
      entityId: trip.id,
      action: `Registrerte kjøretur ${fromAddress} → ${toAddress}`,
      actor: toAuditActor(actor),
      metadata: { km, rate, amount, workOrderId: target.data.workOrderId },
    });
    return ok({ id: trip.id, amount });
  });
}

export async function updateMileageTrip(
  actor: ServiceActor,
  input: {
    id: unknown;
    date?: unknown;
    fromAddress?: unknown;
    toAddress?: unknown;
    km?: unknown;
    rate?: unknown;
    purpose?: unknown;
    workOrderId?: unknown;
    visitId?: unknown;
  },
): Promise<ServiceResult<{ id: string; amount: number }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  const existing = await prisma.mileageTrip.findFirst({
    where: { id, ...ownWhere(actor) },
  });
  if (!existing) return fail("not_found");
  if (existing.status !== "DRAFT" && existing.status !== "PENDING") {
    return fail("conflict", { code: EXPENSE_ERROR_CODES.invalidStatus });
  }

  const date = input.date !== undefined ? parseDate(input.date) : existing.date;
  const fromAddress = input.fromAddress !== undefined
    ? cleanText(input.fromAddress, { maxLength: LIMITS.line })
    : existing.fromAddress;
  const toAddress = input.toAddress !== undefined
    ? cleanText(input.toAddress, { maxLength: LIMITS.line })
    : existing.toAddress;
  const km = input.km !== undefined ? Number(input.km) : Number(existing.km);
  const rate = input.rate !== undefined ? Number(input.rate) : Number(existing.rate);
  if (!date) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidDate });
  }
  if (!fromAddress || !toAddress) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidInput });
  }
  if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(rate) || rate < 0) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidAmount });
  }

  let target = {
    workOrderId: existing.workOrderId,
    visitId: existing.visitId,
  };
  if (input.workOrderId !== undefined || input.visitId !== undefined) {
    const verified = await verifyWorkOrder(actor, input.workOrderId, input.visitId);
    if (!verified.ok) return verified;
    target = verified.data;
  }

  const amount = calculateMileageAmount(km, rate);
  return prisma.$transaction(async (tx) => {
    await tx.mileageTrip.update({
      where: { id },
      data: {
        date,
        fromAddress,
        toAddress,
        km: roundOre(km),
        rate,
        amount,
        purpose: input.purpose !== undefined
          ? cleanText(input.purpose, { maxLength: LIMITS.text }) || null
          : existing.purpose,
        ...target,
      },
    });
    await audit(tx, {
      entityType: "MileageTrip",
      entityId: id,
      action: `Endret kjøretur ${fromAddress} → ${toAddress}`,
      actor: toAuditActor(actor),
      metadata: { km, rate, amount },
    });
    return ok({ id, amount });
  });
}

export async function submitMileageTrip(
  actor: ServiceActor,
  tripId: string,
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;
  const id = cleanText(tripId, { maxLength: LIMITS.line });

  return prisma.$transaction(async (tx) => {
    const trip = await tx.mileageTrip.findFirst({
      where: { id, ...ownWhere(actor) },
      select: { id: true, status: true },
    });
    if (!trip) return fail("not_found");
    if (trip.status === "PENDING") return ok({ id });
    if (trip.status !== "DRAFT") {
      return fail("conflict", { code: EXPENSE_ERROR_CODES.invalidStatus });
    }
    await tx.mileageTrip.update({
      where: { id },
      data: { status: "PENDING", submittedAt: new Date() },
    });
    await audit(tx, {
      entityType: "MileageTrip",
      entityId: id,
      action: "Sendte kjøretur til godkjenning",
      actor: toAuditActor(actor),
    });
    return ok({ id });
  });
}

export async function createExpense(
  actor: ServiceActor,
  input: {
    date: unknown;
    category: unknown;
    amount: unknown;
    vatRate?: unknown;
    vatAmount?: unknown;
    description?: unknown;
    receiptUrl?: unknown;
    documentId?: unknown;
    workOrderId?: unknown;
    visitId?: unknown;
    submit?: unknown;
  },
): Promise<ServiceResult<{ id: string; amount: number; vatAmount: number }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;

  const date = parseDate(input.date);
  const category = cleanText(input.category, { maxLength: LIMITS.short });
  const amount = Number(input.amount);
  const vatRate = input.vatRate === undefined || input.vatRate === "" || input.vatRate === null
    ? DEFAULT_VAT_RATE
    : Number(input.vatRate);
  if (!date) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidDate });
  }
  if (!category) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidInput });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidAmount });
  }
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidVat });
  }

  const vatAmount = input.vatAmount !== undefined && input.vatAmount !== ""
    ? Number(input.vatAmount)
    : calculateVatFromGross(amount, vatRate);
  if (!Number.isFinite(vatAmount) || !isValidVatAmount(amount, vatAmount)) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidVat });
  }

  const target = await verifyWorkOrder(actor, input.workOrderId, input.visitId);
  if (!target.ok) return target;
  const receipt = await validateReceipt(actor, {
    receiptUrl: input.receiptUrl,
    documentId: input.documentId,
    workOrderId: target.data.workOrderId,
  });
  if (!receipt.ok) return receipt;

  const submitted = input.submit === false || input.submit === "false" ? false : true;
  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        userId: actor.id,
        departmentId: actor.departmentId,
        workOrderId: target.data.workOrderId,
        date,
        category,
        description:
          cleanText(input.description, { maxLength: LIMITS.text }) || null,
        amount: roundOre(amount),
        vatAmount: roundOre(vatAmount),
        receiptUrl: receipt.data.receiptUrl,
        documentId: receipt.data.documentId,
        status: submitted ? "PENDING" : "DRAFT",
        submittedAt: submitted ? new Date() : null,
      },
      select: { id: true },
    });
    await audit(tx, {
      entityType: "Expense",
      entityId: expense.id,
      action: `Registrerte utlegg ${category}`,
      actor: toAuditActor(actor),
      metadata: {
        amount,
        vatAmount,
        category,
        workOrderId: target.data.workOrderId,
      },
    });
    return ok({
      id: expense.id,
      amount: roundOre(amount),
      vatAmount: roundOre(vatAmount),
    });
  });
}

export async function updateExpense(
  actor: ServiceActor,
  input: {
    id: unknown;
    date?: unknown;
    category?: unknown;
    amount?: unknown;
    vatRate?: unknown;
    vatAmount?: unknown;
    description?: unknown;
    receiptUrl?: unknown;
    documentId?: unknown;
  },
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  const existing = await prisma.expense.findFirst({
    where: { id, ...ownWhere(actor) },
  });
  if (!existing) return fail("not_found");
  if (existing.status !== "DRAFT" && existing.status !== "PENDING") {
    return fail("conflict", { code: EXPENSE_ERROR_CODES.invalidStatus });
  }

  const date = input.date !== undefined ? parseDate(input.date) : existing.date;
  const category = input.category !== undefined
    ? cleanText(input.category, { maxLength: LIMITS.short })
    : existing.category;
  const amount = input.amount !== undefined ? Number(input.amount) : Number(existing.amount);
  const vatRate = input.vatRate !== undefined ? Number(input.vatRate) : null;
  if (!date) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidDate });
  }
  if (!category) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidInput });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidAmount });
  }
  const vatAmount = input.vatAmount !== undefined
    ? Number(input.vatAmount)
    : vatRate !== null
      ? calculateVatFromGross(amount, vatRate)
      : Number(existing.vatAmount);
  if (!Number.isFinite(vatAmount) || !isValidVatAmount(amount, vatAmount)) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidVat });
  }

  const receiptChanged =
    input.receiptUrl !== undefined || input.documentId !== undefined;
  const receipt = receiptChanged
    ? await validateReceipt(actor, {
        receiptUrl: input.receiptUrl,
        documentId: input.documentId,
        workOrderId: existing.workOrderId,
      })
    : ok({
        receiptUrl: existing.receiptUrl,
        documentId: existing.documentId,
      });
  if (!receipt.ok) return receipt;

  return prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id },
      data: {
        date,
        category,
        amount: roundOre(amount),
        vatAmount: roundOre(vatAmount),
        description: input.description !== undefined
          ? cleanText(input.description, { maxLength: LIMITS.text }) || null
          : existing.description,
        receiptUrl: receipt.data.receiptUrl,
        documentId: receipt.data.documentId,
      },
    });
    await audit(tx, {
      entityType: "Expense",
      entityId: id,
      action: `Endret utlegg ${category}`,
      actor: toAuditActor(actor),
      metadata: { amount, vatAmount },
    });
    return ok({ id });
  });
}

export async function submitExpense(
  actor: ServiceActor,
  expenseId: string,
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;
  const id = cleanText(expenseId, { maxLength: LIMITS.line });

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({
      where: { id, ...ownWhere(actor) },
      select: { id: true, status: true },
    });
    if (!expense) return fail("not_found");
    if (expense.status === "PENDING") return ok({ id });
    if (expense.status !== "DRAFT") {
      return fail("conflict", { code: EXPENSE_ERROR_CODES.invalidStatus });
    }
    await tx.expense.update({
      where: { id },
      data: { status: "PENDING", submittedAt: new Date() },
    });
    await audit(tx, {
      entityType: "Expense",
      entityId: id,
      action: "Sendte utlegg til godkjenning",
      actor: toAuditActor(actor),
    });
    return ok({ id });
  });
}

async function setApproval(
  actor: ServiceActor,
  kind: "mileage" | "expense",
  id: string,
  approved: boolean,
  reason?: unknown,
): Promise<ServiceResult<{ id: string }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireApprove(actor);
  if (denied) return denied;

  const cleanReason = cleanText(reason, { maxLength: LIMITS.text });
  if (!approved && !cleanReason) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.reasonRequired });
  }

  return prisma.$transaction(async (tx) => {
    const where =
      kind === "mileage"
        ? { id, ...departmentWhere(actor) }
        : { id, ...departmentWhere(actor) };
    const row =
      kind === "mileage"
        ? await tx.mileageTrip.findFirst({ where })
        : await tx.expense.findFirst({ where });
    if (!row) return fail("not_found");
    if (row.status !== "PENDING") {
      return fail("conflict", { code: EXPENSE_ERROR_CODES.invalidStatus });
    }

    if (kind === "mileage") {
      await tx.mileageTrip.update({
        where: { id },
        data: {
          status: approved ? "APPROVED" : "REJECTED",
          approvedAt: approved ? new Date() : null,
          approvedById: actor.id,
          rejectionReason: approved ? null : cleanReason,
        },
      });
    } else {
      await tx.expense.update({
        where: { id },
        data: {
          status: approved ? "APPROVED" : "REJECTED",
          approvedAt: approved ? new Date() : null,
          approvedById: actor.id,
          rejectionReason: approved ? null : cleanReason,
        },
      });
    }
    await audit(tx, {
      entityType: kind === "mileage" ? "MileageTrip" : "Expense",
      entityId: id,
      action: approved
        ? `Godkjente ${kind === "mileage" ? "kjøretur" : "utlegg"}`
        : `Avviste ${kind === "mileage" ? "kjøretur" : "utlegg"}`,
      actor: toAuditActor(actor),
      metadata: { approved, reason: cleanReason || null },
    });
    return ok({ id });
  });
}

export function approveMileageTrip(actor: ServiceActor, id: string) {
  return setApproval(actor, "mileage", cleanText(id, { maxLength: LIMITS.line }), true);
}

export function rejectMileageTrip(actor: ServiceActor, id: string, reason: unknown) {
  return setApproval(actor, "mileage", cleanText(id, { maxLength: LIMITS.line }), false, reason);
}

export function approveExpense(actor: ServiceActor, id: string) {
  return setApproval(actor, "expense", cleanText(id, { maxLength: LIMITS.line }), true);
}

export function rejectExpense(actor: ServiceActor, id: string, reason: unknown) {
  return setApproval(actor, "expense", cleanText(id, { maxLength: LIMITS.line }), false, reason);
}

export type MyExpenses = {
  trips: MileageTripView[];
  expenses: ExpenseView[];
  totals: {
    pendingAmount: number;
    approvedAmount: number;
    tripKm: number;
  };
};

export async function listMyExpenses(
  actor: ServiceActor,
  params: { status?: string } = {},
): Promise<ServiceResult<MyExpenses>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireSubmit(actor);
  if (denied) return denied;
  const status = ["DRAFT", "PENDING", "APPROVED", "REJECTED"].includes(
    String(params.status ?? ""),
  )
    ? (String(params.status) as "DRAFT" | "PENDING" | "APPROVED" | "REJECTED")
    : undefined;

  const [trips, expenses] = await Promise.all([
    prisma.mileageTrip.findMany({
      where: { userId: actor.id, ...(status ? { status } : {}) },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.expense.findMany({
      where: { userId: actor.id, ...(status ? { status } : {}) },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
  ]);

  const names = await userNames([actor.id]);
  const userName = names.get(actor.id) ?? "Ukjent";
  return ok({
    trips: trips.map((trip) => ({
      id: trip.id,
      userId: trip.userId,
      userName,
      date: toDateOnly(trip.date),
      fromAddress: trip.fromAddress,
      toAddress: trip.toAddress,
      km: Number(trip.km),
      rate: Number(trip.rate),
      amount: Number(trip.amount),
      purpose: trip.purpose,
      status: trip.status,
      workOrderId: trip.workOrderId,
      visitId: trip.visitId,
      rejectionReason: trip.rejectionReason,
      createdAt: trip.createdAt,
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      userId: expense.userId,
      userName,
      date: toDateOnly(expense.date),
      category: expense.category,
      description: expense.description,
      amount: Number(expense.amount),
      vatAmount: Number(expense.vatAmount),
      status: expense.status,
      workOrderId: expense.workOrderId,
      receiptUrl: expense.receiptUrl,
      documentId: expense.documentId,
      rejectionReason: expense.rejectionReason,
      createdAt: expense.createdAt,
    })),
    totals: {
      pendingAmount: roundOre(
        trips
          .filter((trip) => trip.status === "PENDING")
          .reduce((sum, trip) => sum + Number(trip.amount), 0) +
          expenses
            .filter((expense) => expense.status === "PENDING")
            .reduce((sum, expense) => sum + Number(expense.amount), 0),
      ),
      approvedAmount: roundOre(
        trips
          .filter((trip) => trip.status === "APPROVED")
          .reduce((sum, trip) => sum + Number(trip.amount), 0) +
          expenses
            .filter((expense) => expense.status === "APPROVED")
            .reduce((sum, expense) => sum + Number(expense.amount), 0),
      ),
      tripKm: trips
        .filter((trip) => trip.status === "APPROVED")
        .reduce((sum, trip) => sum + Number(trip.km), 0),
    },
  });
}

export type ApprovalQueue = {
  trips: MileageTripView[];
  expenses: ExpenseView[];
  totals: { pendingAmount: number; pendingCount: number };
};

export async function listApprovalQueue(
  actor: ServiceActor,
  params: { status?: string } = {},
): Promise<ServiceResult<ApprovalQueue>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireApprove(actor) ?? requirePayrollAmounts(actor);
  if (denied) return denied;
  const allowed = ["DRAFT", "PENDING", "APPROVED", "REJECTED"];
  const status = allowed.includes(String(params.status ?? ""))
    ? (String(params.status) as "DRAFT" | "PENDING" | "APPROVED" | "REJECTED")
    : "PENDING";

  const where = { ...departmentWhere(actor), status };
  const [trips, expenses] = await Promise.all([
    prisma.mileageTrip.findMany({
      where,
      orderBy: [{ submittedAt: "asc" }, { date: "asc" }],
      take: 300,
    }),
    prisma.expense.findMany({
      where,
      orderBy: [{ submittedAt: "asc" }, { date: "asc" }],
      take: 300,
    }),
  ]);
  const names = await userNames([
    ...trips.map((trip) => trip.userId),
    ...expenses.map((expense) => expense.userId),
  ]);

  return ok({
    trips: trips.map((trip) => ({
      id: trip.id,
      userId: trip.userId,
      userName: names.get(trip.userId) ?? "Ukjent",
      date: toDateOnly(trip.date),
      fromAddress: trip.fromAddress,
      toAddress: trip.toAddress,
      km: Number(trip.km),
      rate: Number(trip.rate),
      amount: Number(trip.amount),
      purpose: trip.purpose,
      status: trip.status,
      workOrderId: trip.workOrderId,
      visitId: trip.visitId,
      rejectionReason: trip.rejectionReason,
      createdAt: trip.createdAt,
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      userId: expense.userId,
      userName: names.get(expense.userId) ?? "Ukjent",
      date: toDateOnly(expense.date),
      category: expense.category,
      description: expense.description,
      amount: Number(expense.amount),
      vatAmount: Number(expense.vatAmount),
      status: expense.status,
      workOrderId: expense.workOrderId,
      receiptUrl: expense.receiptUrl,
      documentId: expense.documentId,
      rejectionReason: expense.rejectionReason,
      createdAt: expense.createdAt,
    })),
    totals: {
      pendingAmount: roundOre(
        trips.reduce((sum, trip) => sum + Number(trip.amount), 0) +
          expenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
      ),
      pendingCount: trips.length + expenses.length,
    },
  });
}

function normalizePeriod(input: { start: unknown; end: unknown }): {
  startDate: Date;
  endDate: Date;
  start: string;
  end: string;
} | null {
  const start = parseDate(input.start);
  const end = parseDate(input.end);
  if (!start || !end || end < start) return null;
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_PERIOD_DAYS) return null;
  return { startDate: start, endDate: end, start: toDateOnly(start), end: toDateOnly(end) };
}

type PayrollLineData = {
  kind: "WORK" | "TRAVEL" | "MILEAGE" | "EXPENSE";
  refId: string;
  userId: string;
  userName: string;
  workOrderId: string | null;
  occurredOn: Date;
  description: string;
  quantity: number;
  unit: string;
  amount: number;
  vatAmount: number;
};

type TimeGroup = {
  userId: string;
  userName: string;
  date: string;
  workOrderId: string | null;
  visits: Array<{
    enRouteAt: Date | null;
    onSiteAt: Date | null;
    doneAt: Date | null;
    travelFromEndedAt: Date | null;
  }>;
};

async function buildPayrollLines(
  actor: ServiceActor,
  departmentId: string,
  period: { startDate: Date; endDate: Date; start: string; end: string },
): Promise<PayrollLineData[]> {
  const rangeStart = osloDayStart(period.start);
  const rangeEnd = osloDayStart(toDateOnly(addDaysUtc(period.endDate, 1)));

  const [trips, expenses, visits] = await Promise.all([
    prisma.mileageTrip.findMany({
      where: {
        departmentId,
        status: "APPROVED",
        exportedAt: null,
        date: { gte: period.startDate, lte: period.endDate },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.expense.findMany({
      where: {
        departmentId,
        status: "APPROVED",
        exportedAt: null,
        date: { gte: period.startDate, lte: period.endDate },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.visit.findMany({
      where: {
        startsAt: { gte: rangeStart, lt: rangeEnd },
        workOrder: { departmentId, deletedAt: null },
        technicians: { some: {} },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        enRouteAt: true,
        onSiteAt: true,
        doneAt: true,
        travelFromEndedAt: true,
        workOrderId: true,
        technicians: {
          select: { userId: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  ]);

  const names = await userNames([
    ...trips.map((trip) => trip.userId),
    ...expenses.map((expense) => expense.userId),
    ...visits.flatMap((visit) => visit.technicians.map((tech) => tech.userId)),
  ]);

  const lines: PayrollLineData[] = [];
  const groups = new Map<string, TimeGroup>();
  for (const visit of visits) {
    const date = dateOnlyInOslo(visit.startsAt);
    for (const technician of visit.technicians) {
      const key = `${technician.userId}|${date}`;
      const group = groups.get(key) ?? {
        userId: technician.userId,
        userName:
          technician.user.name ||
          technician.user.email ||
          names.get(technician.userId) ||
          "Ukjent",
        date,
        workOrderId: visit.workOrderId,
        visits: [],
      };
      group.visits.push({
        enRouteAt: visit.enRouteAt,
        onSiteAt: visit.onSiteAt,
        doneAt: visit.doneAt,
        travelFromEndedAt: visit.travelFromEndedAt,
      });
      groups.set(key, group);
    }
  }

  for (const group of [...groups.values()].sort((a, b) =>
    `${a.date}|${a.userName}`.localeCompare(`${b.date}|${b.userName}`),
  )) {
    const summary = summarizeVisitTimes(group.visits);
    if (summary.workMinutes > 0) {
      lines.push({
        kind: "WORK",
        refId: `${group.userId}:${group.date}:WORK`,
        userId: group.userId,
        userName: group.userName,
        workOrderId: group.workOrderId,
        occurredOn: parseDateOnly(group.date)!,
        description: "Arbeidstid fra visitt",
        quantity: roundOre(summary.workMinutes / 60),
        unit: "timer",
        amount: 0,
        vatAmount: 0,
      });
    }
    if (summary.travelMinutes > 0) {
      lines.push({
        kind: "TRAVEL",
        refId: `${group.userId}:${group.date}:TRAVEL`,
        userId: group.userId,
        userName: group.userName,
        workOrderId: group.workOrderId,
        occurredOn: parseDateOnly(group.date)!,
        description: "Reisetid fra visitt",
        quantity: roundOre(summary.travelMinutes / 60),
        unit: "timer",
        amount: 0,
        vatAmount: 0,
      });
    }
  }

  for (const trip of trips) {
    lines.push({
      kind: "MILEAGE",
      refId: trip.id,
      userId: trip.userId,
      userName: names.get(trip.userId) ?? "Ukjent",
      workOrderId: trip.workOrderId,
      occurredOn: trip.date,
      description: `${trip.fromAddress} → ${trip.toAddress}`,
      quantity: Number(trip.km),
      unit: "km",
      amount: Number(trip.amount),
      vatAmount: 0,
    });
  }

  for (const expense of expenses) {
    lines.push({
      kind: "EXPENSE",
      refId: expense.id,
      userId: expense.userId,
      userName: names.get(expense.userId) ?? "Ukjent",
      workOrderId: expense.workOrderId,
      occurredOn: expense.date,
      description:
        expense.description || expense.category,
      quantity: 1,
      unit: "stk",
      amount: Number(expense.amount),
      vatAmount: Number(expense.vatAmount),
    });
  }

  return lines;
}

function csvRowsFor(lines: PayrollLineData[]): PayrollCsvRow[] {
  return lines.map((line) => ({
    type: line.kind,
    userName: line.userName,
    date: toDateOnly(line.occurredOn),
    reference: line.workOrderId ?? line.refId,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    amount: line.amount,
    vatAmount: line.vatAmount,
  }));
}

export type PayrollPreview = {
  period: { start: string; end: string };
  departmentId: string;
  rows: PayrollCsvRow[];
  totals: {
    workHours: number;
    travelHours: number;
    mileageKm: number;
    mileageAmount: number;
    expenseAmount: number;
    expenseVat: number;
  };
};

export async function previewPayroll(
  actor: ServiceActor,
  input: { start: unknown; end: unknown; departmentId?: unknown },
): Promise<ServiceResult<PayrollPreview>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireExport(actor) ?? requirePayrollAmounts(actor);
  if (denied) return denied;
  const period = normalizePeriod(input);
  const departmentId = resolveDepartmentId(actor, input.departmentId);
  if (!period || !departmentId) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidPeriod });
  }

  const lines = await buildPayrollLines(actor, departmentId, period);
  const rows = csvRowsFor(lines);
  return ok({
    period: { start: period.start, end: period.end },
    departmentId,
    rows,
    totals: {
      workHours: roundOre(
        lines.filter((line) => line.kind === "WORK").reduce((sum, line) => sum + line.quantity, 0),
      ),
      travelHours: roundOre(
        lines.filter((line) => line.kind === "TRAVEL").reduce((sum, line) => sum + line.quantity, 0),
      ),
      mileageKm: roundOre(
        lines.filter((line) => line.kind === "MILEAGE").reduce((sum, line) => sum + line.quantity, 0),
      ),
      mileageAmount: roundOre(
        lines.filter((line) => line.kind === "MILEAGE").reduce((sum, line) => sum + line.amount, 0),
      ),
      expenseAmount: roundOre(
        lines.filter((line) => line.kind === "EXPENSE").reduce((sum, line) => sum + line.amount, 0),
      ),
      expenseVat: roundOre(
        lines.filter((line) => line.kind === "EXPENSE").reduce((sum, line) => sum + line.vatAmount, 0),
      ),
    },
  });
}

export type PayrollExportSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  rowCount: number;
  checksum: string;
  createdAt: Date;
};

export async function listPayrollExports(
  actor: ServiceActor,
): Promise<ServiceResult<{ exports: PayrollExportSummary[] }>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireExport(actor) ?? requirePayrollAmounts(actor);
  if (denied) return denied;
  const departmentId = resolveDepartmentId(actor);
  if (!departmentId) return fail("forbidden");

  const exports = await prisma.payrollExport.findMany({
    where: { departmentId },
    orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      rowCount: true,
      checksum: true,
      createdAt: true,
    },
  });
  return ok({
    exports: exports.map((row) => ({
      id: row.id,
      periodStart: toDateOnly(row.periodStart),
      periodEnd: toDateOnly(row.periodEnd),
      rowCount: row.rowCount,
      checksum: row.checksum,
      createdAt: row.createdAt,
    })),
  });
}

export type PayrollExportResult = {
  id: string;
  csv: string;
  checksum: string;
  rowCount: number;
  existing: boolean;
  period: { start: string; end: string };
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Låser lønnsperioden og lagrer CSV-en. Samme avdeling og periode gir samme
 * svar uten å lage nye rader. Overlappende perioder avvises, slik at verken
 * tid, kjøreturer eller utlegg kan eksporteres to ganger.
 */
export async function exportPayroll(
  actor: ServiceActor,
  input: { start: unknown; end: unknown; departmentId?: unknown },
): Promise<ServiceResult<PayrollExportResult>> {
  if (!(await requireModule("fieldExpenses"))) return fail("not_found");
  const denied = requireExport(actor) ?? requirePayrollAmounts(actor);
  if (denied) return denied;
  const period = normalizePeriod(input);
  const departmentId = resolveDepartmentId(actor, input.departmentId);
  if (!period || !departmentId) {
    return fail("invalid", { code: EXPENSE_ERROR_CODES.invalidPeriod });
  }

  const run = async (): Promise<ServiceResult<PayrollExportResult>> =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.payrollExport.findUnique({
        where: {
          departmentId_periodStart_periodEnd: {
            departmentId,
            periodStart: period.startDate,
            periodEnd: period.endDate,
          },
        },
      });
      if (existing) {
        return ok({
          id: existing.id,
          csv: existing.csvText,
          checksum: existing.checksum,
          rowCount: existing.rowCount,
          existing: true,
          period: { start: period.start, end: period.end },
        });
      }

      const overlap = await tx.payrollExport.findFirst({
        where: {
          departmentId,
          periodStart: { lte: period.endDate },
          periodEnd: { gte: period.startDate },
        },
        select: { id: true, periodStart: true, periodEnd: true },
      });
      if (overlap) {
        return fail("conflict", {
          code: EXPENSE_ERROR_CODES.periodOverlap,
          periodStart: toDateOnly(overlap.periodStart),
          periodEnd: toDateOnly(overlap.periodEnd),
        });
      }

      const rows = await buildPayrollLines(actor, departmentId, period);
      const csv = payrollCsv(csvRowsFor(rows));
      const checksum = createHash("sha256").update(csv).digest("hex");

      const created = await tx.payrollExport.create({
        data: {
          departmentId,
          periodStart: period.startDate,
          periodEnd: period.endDate,
          createdById: actor.id,
          checksum,
          rowCount: rows.length,
          csvText: csv,
          lines: {
            create: rows.map((line) => ({
              kind: line.kind,
              refId: line.refId,
              userId: line.userId,
              userName: line.userName,
              workOrderId: line.workOrderId,
              occurredOn: line.occurredOn,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              amount: line.amount,
              vatAmount: line.vatAmount,
            })),
          },
        },
        select: { id: true },
      });

      const mileageIds = rows
        .filter((line) => line.kind === "MILEAGE")
        .map((line) => line.refId);
      const expenseIds = rows
        .filter((line) => line.kind === "EXPENSE")
        .map((line) => line.refId);
      if (mileageIds.length > 0) {
        await tx.mileageTrip.updateMany({
          where: { id: { in: mileageIds } },
          data: { payrollExportId: created.id, exportedAt: new Date() },
        });
      }
      if (expenseIds.length > 0) {
        await tx.expense.updateMany({
          where: { id: { in: expenseIds } },
          data: { payrollExportId: created.id, exportedAt: new Date() },
        });
      }

      await audit(tx, {
        entityType: "PayrollExport",
        entityId: created.id,
        action: `Eksporterte lønnsgrunnlag ${period.start}–${period.end}`,
        actor: toAuditActor(actor),
        departmentId,
        metadata: {
          periodStart: period.start,
          periodEnd: period.end,
          rowCount: rows.length,
          checksum,
        },
      });

      return ok({
        id: created.id,
        csv,
        checksum,
        rowCount: rows.length,
        existing: false,
        period: { start: period.start, end: period.end },
      });
    });

  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // En samtidig eksport vant kappløpet. Returner den lagrede filen.
    const existing = await prisma.payrollExport.findUnique({
      where: {
        departmentId_periodStart_periodEnd: {
          departmentId,
          periodStart: period.startDate,
          periodEnd: period.endDate,
        },
      },
    });
    if (!existing) throw error;
    return ok({
      id: existing.id,
      csv: existing.csvText,
      checksum: existing.checksum,
      rowCount: existing.rowCount,
      existing: true,
      period: { start: period.start, end: period.end },
    });
  }
}
