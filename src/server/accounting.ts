// i18n-ignore-file: revisjonshandlinger og driftsstatus er lagrede data, ikke UI-tekst.
import { Prisma, type AccountingSyncStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { toDateOnly, todayUtc } from "@/lib/dates";
import {
  accountingProviderInfo,
  getAccountingProvider,
  resolveAccountingProviderName,
} from "@/lib/accounting/provider";
import {
  AccountingError,
  type AccountingProviderName,
  type AccountingSyncResult,
} from "@/lib/accounting/types";
import { assertModule } from "./modules";
import { invoiceScopeFor } from "./invoices";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import type { ErrorCode } from "@/lib/error-codes";

/**
 * Regnskapssynk mot Fiken, Tripletex, PowerOffice Go eller CSV.
 *
 * Hver faktura har én `AccountingSync`-rad per leverandør med en stabil
 * idempotensnøkkel. En vellykket synk gjenbrukes; en feilet synk kan kjøres
 * igjen og øker `attemptCount`. Ekstern id lagres først etter at HTTP-kallet
 * faktisk har lyktes.
 *
 * Tjenesten later aldri som et eksternt kall lyktes. CSV markerer status
 * `EXPORTED`, aldri `SYNCED`.
 */

export async function getAccountingSettings() {
  const existing = await prisma.accountingSettings.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.accountingSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", provider: resolveAccountingProviderName(), enabled: false },
  });
}

export type AccountingSettingsInput = { enabled?: unknown };

function parseEnabled(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(text)) return true;
    if (["false", "0", "off", "no"].includes(text)) return false;
  }
  return fallback;
}

export async function updateAccountingSettings(
  actor: ServiceActor,
  input: AccountingSettingsInput,
): Promise<ServiceResult<{ enabled: boolean; provider: AccountingProviderName }>> {
  await assertModule("invoicing");
  if (!isAdminActor(actor) || !can(actor, "settings.manage")) return fail("forbidden");
  const provider = resolveAccountingProviderName();
  const current = await getAccountingSettings();
  const enabled = parseEnabled(input.enabled, current.enabled);

  await prisma.$transaction(async (tx) => {
    await tx.accountingSettings.upsert({
      where: { id: "default" },
      update: { enabled, provider, updatedById: actor.id },
      create: { id: "default", enabled, provider, updatedById: actor.id },
    });
    await audit(tx, {
      entityType: "AccountingSettings",
      entityId: "default",
      action: enabled ? "Slå på regnskapssynk" : "Slå av regnskapssynk",
      actor: toAuditActor(actor),
      metadata: { enabled, provider },
    });
  });
  return ok({ enabled, provider });
}

export type AccountingAdminView = {
  settings: {
    provider: string;
    enabled: boolean;
    lastTestedAt: Date | null;
    lastTestOk: boolean | null;
    lastTestError: string | null;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
  };
  info: ReturnType<typeof accountingProviderInfo>;
  recent: Array<{
    id: string;
    status: AccountingSyncStatus;
    provider: string;
    attemptCount: number;
    lastAttemptAt: Date | null;
    lastError: string | null;
    externalInvoiceId: string | null;
    externalInvoiceNumber: string | null;
    invoice: { id: string; invoiceNumber: string | null; customerName: string };
  }>;
  failedCount: number;
};

/** Leser administratorpanelets status. Krever full innstillingsrett. */
export async function getAccountingAdminView(
  actor: ServiceActor,
): Promise<ServiceResult<AccountingAdminView>> {
  await assertModule("invoicing");
  if (!isAdminActor(actor) || !can(actor, "settings.manage")) return fail("forbidden");
  const settings = await getAccountingSettings();
  const [recent, failedCount] = await Promise.all([
    prisma.accountingSync.findMany({
      orderBy: [{ lastAttemptAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        status: true,
        provider: true,
        attemptCount: true,
        lastAttemptAt: true,
        lastError: true,
        externalInvoiceId: true,
        externalInvoiceNumber: true,
        invoice: {
          select: { id: true, invoiceNumber: true, customer: { select: { name: true } } },
        },
      },
    }),
    prisma.accountingSync.count({ where: { status: "FAILED" } }),
  ]);
  return ok({
    settings: {
      provider: settings.provider,
      enabled: settings.enabled,
      lastTestedAt: settings.lastTestedAt,
      lastTestOk: settings.lastTestOk,
      lastTestError: settings.lastTestError,
      lastSyncAt: settings.lastSyncAt,
      lastSyncError: settings.lastSyncError,
    },
    info: accountingProviderInfo(),
    recent: recent.map((row) => ({
      ...row,
      invoice: {
        id: row.invoice.id,
        invoiceNumber: row.invoice.invoiceNumber,
        customerName: row.invoice.customer.name,
      },
    })),
    failedCount,
  });
}

/** Tester forbindelsen uten å skrive fakturaer. Hemmeligheter logges ikke. */
export async function testAccountingConnection(
  actor: ServiceActor,
): Promise<ServiceResult<{ ok: boolean; message: string; detail: string | null }>> {
  await assertModule("invoicing");
  if (!isAdminActor(actor) || !can(actor, "settings.manage")) return fail("forbidden");
  const provider = getAccountingProvider();
  const now = new Date();
  if (!provider.configured()) {
    await prisma.$transaction(async (tx) => {
      await tx.accountingSettings.upsert({
        where: { id: "default" },
        update: {
          provider: provider.name,
          lastTestedAt: now,
          lastTestOk: false,
          lastTestError: "not_configured",
          updatedById: actor.id,
        },
        create: {
          id: "default",
          provider: provider.name,
          enabled: false,
          lastTestedAt: now,
          lastTestOk: false,
          lastTestError: "not_configured",
          updatedById: actor.id,
        },
      });
      await audit(tx, {
        entityType: "AccountingSettings",
        entityId: "default",
        action: `Testet regnskapsforbindelsen (${provider.name})`,
        actor: toAuditActor(actor),
        metadata: { provider: provider.name, ok: false, reason: "not_configured" },
      });
    });
    return fail("conflict", { code: "accounting.notConfigured" satisfies ErrorCode });
  }

  let result: Awaited<ReturnType<typeof provider.testConnection>>;
  try {
    result = await provider.testConnection();
  } catch (error) {
    result = {
      ok: false,
      message: "connection_failed",
      detail: error instanceof AccountingError ? error.code : "provider_error",
    };
  }
  const errorText = result.ok ? null : (result.detail ?? result.message).slice(0, 200);
  await prisma.$transaction(async (tx) => {
    await tx.accountingSettings.upsert({
      where: { id: "default" },
      update: {
        provider: provider.name,
        lastTestedAt: now,
        lastTestOk: result.ok,
        lastTestError: errorText,
        updatedById: actor.id,
      },
      create: {
        id: "default",
        provider: provider.name,
        enabled: false,
        lastTestedAt: now,
        lastTestOk: result.ok,
        lastTestError: errorText,
        updatedById: actor.id,
      },
    });
    await audit(tx, {
      entityType: "AccountingSettings",
      entityId: "default",
      action: `Testet regnskapsforbindelsen (${provider.name})`,
      actor: toAuditActor(actor),
      metadata: { provider: provider.name, ok: result.ok, ...(errorText ? { detail: errorText } : {}) },
    });
  });
  return ok({ ok: result.ok, message: result.message, detail: errorText });
}

export type SyncInvoiceResult = {
  provider: AccountingProviderName;
  status: AccountingSyncStatus;
  externalInvoiceId: string | null;
  externalInvoiceNumber: string | null;
  alreadySynced: boolean;
  paymentsSynced: number;
  paymentFailures: number;
};

type SyncInvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  currency: string;
  notes: string | null;
  subtotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  customer: {
    id: string;
    name: string;
    orgNumber: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
  };
  lines: Array<{
    description: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitPrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    lineVat: Prisma.Decimal;
  }>;
  payments: Array<{
    id: string;
    amount: Prisma.Decimal;
    paidAt: Date;
    method: string;
    reference: string | null;
  }>;
};

async function loadInvoiceForSync(
  actor: ServiceActor,
  invoiceId: string,
): Promise<SyncInvoiceRow | null> {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, AND: [invoiceScopeFor(actor)] },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      currency: true,
      notes: true,
      subtotal: true,
      vatTotal: true,
      total: true,
      customer: {
        select: {
          id: true,
          name: true,
          orgNumber: true,
          email: true,
          phone: true,
          address: true,
          postalCode: true,
          city: true,
        },
      },
      lines: {
        orderBy: { sortOrder: "asc" },
        select: {
          description: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          vatRate: true,
          lineTotal: true,
          lineVat: true,
        },
      },
      payments: {
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        select: { id: true, amount: true, paidAt: true, method: true, reference: true },
      },
    },
  });
}

async function ensureCustomerMapping(
  providerName: AccountingProviderName,
  customer: SyncInvoiceRow["customer"],
): Promise<string> {
  const existing = await prisma.accountingCustomer.findUnique({
    where: { customerId_provider: { customerId: customer.id, provider: providerName } },
    select: { externalId: true },
  });
  if (existing) return existing.externalId;

  const provider = getAccountingProvider(providerName);
  const result = await provider.syncCustomer({
    id: customer.id,
    name: customer.name,
    orgNumber: customer.orgNumber,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    postalCode: customer.postalCode,
    city: customer.city,
  });
  if (!result.externalId) {
    throw new AccountingError("Provider returned no customer id", "provider_error", true);
  }
  await prisma.accountingCustomer.create({
    data: {
      customerId: customer.id,
      provider: providerName,
      externalId: result.externalId,
    },
  });
  return result.externalId;
}

function invoiceInput(invoice: SyncInvoiceRow, externalCustomerId: string) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: toDateOnly(invoice.issueDate ?? todayUtc()) ?? toDateOnly(todayUtc())!,
    dueDate: toDateOnly(invoice.dueDate ?? invoice.issueDate ?? todayUtc()) ??
      toDateOnly(todayUtc())!,
    currency: invoice.currency,
    externalCustomerId,
    customer: invoice.customer,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity.toFixed(2),
      unit: line.unit,
      unitPrice: line.unitPrice.toFixed(2),
      vatRate: line.vatRate.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
      lineVat: line.lineVat.toFixed(2),
    })),
    subtotal: invoice.subtotal.toFixed(2),
    vatTotal: invoice.vatTotal.toFixed(2),
    total: invoice.total.toFixed(2),
    notes: invoice.notes,
  };
}

async function recordSyncFailure(
  actor: ServiceActor,
  syncId: string,
  invoiceId: string,
  providerName: AccountingProviderName,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.accountingSync.update({
      where: { id: syncId },
      data: { status: "FAILED", lastError: reason.slice(0, 200), lastAttemptAt: new Date() },
    });
    await tx.accountingSettings.update({
      where: { id: "default" },
      data: { lastSyncAt: new Date(), lastSyncError: reason.slice(0, 200) },
    });
    await audit(tx, {
      entityType: "Invoice",
      entityId: invoiceId,
      action: `Regnskapssynk feilet (${providerName})`,
      actor: toAuditActor(actor),
      metadata: { provider: providerName, reason: reason.slice(0, 200), retryable: true },
    });
  });
}

/**
 * Synkroniserer kunde + faktura + betalinger. Idempotent: en fullført synk
 * returneres uendret, og gjentatte forsøk etter feil øker `attemptCount`.
 */
export async function syncInvoiceToAccounting(
  actor: ServiceActor,
  invoiceId: string,
): Promise<ServiceResult<SyncInvoiceResult>> {
  await assertModule("invoicing");
  if (!(actor.isActive && (isAdminActor(actor) || can(actor, "customers.manage")))) {
    return fail("forbidden");
  }
  const settings = await getAccountingSettings();
  if (!settings.enabled) return fail("conflict", { code: "accounting.disabled" satisfies ErrorCode });

  const providerName = resolveAccountingProviderName();
  const provider = getAccountingProvider(providerName);
  if (!provider.configured()) return fail("conflict", { code: "accounting.notConfigured" satisfies ErrorCode });

  const cleanId = String(invoiceId ?? "").trim();
  if (!cleanId) return fail("not_found");
  const invoice = await loadInvoiceForSync(actor, cleanId);
  if (!invoice) return fail("not_found");
  if (!invoice.invoiceNumber) return fail("conflict", { code: "invoice.notDraft" satisfies ErrorCode });

  const key = `accounting:${providerName}:${invoice.id}`;
  const existing = await prisma.accountingSync.findUnique({
    where: { invoiceId_provider: { invoiceId: invoice.id, provider: providerName } },
  });
  if (existing?.status === "SYNCED" || existing?.status === "EXPORTED") {
    return ok({
      provider: providerName,
      status: existing.status,
      externalInvoiceId: existing.externalInvoiceId,
      externalInvoiceNumber: existing.externalInvoiceNumber,
      alreadySynced: true,
      paymentsSynced: 0,
      paymentFailures: 0,
    });
  }

  let sync = existing;
  if (sync) {
    sync = await prisma.accountingSync.update({
      where: { id: sync.id },
      data: {
        status: "PENDING",
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: null,
      },
    });
  } else {
    try {
      sync = await prisma.accountingSync.create({
        data: {
          invoiceId: invoice.id,
          provider: providerName,
          status: "PENDING",
          idempotencyKey: key,
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "P2002"
      ) {
        return fail("conflict", { code: "accounting.concurrent" satisfies ErrorCode });
      }
      throw error;
    }
  }

  if (!sync) return fail("error", { code: "accounting.syncFailed" satisfies ErrorCode, retryable: true });

  let customerExternalId: string;
  let invoiceResult: AccountingSyncResult;
  try {
    customerExternalId = await ensureCustomerMapping(providerName, invoice.customer);
    invoiceResult = await provider.syncInvoice(
      invoiceInput(invoice, customerExternalId),
    );
  } catch (error) {
    const reason =
      error instanceof AccountingError ? error.code : "provider_error";
    await recordSyncFailure(actor, sync.id, invoice.id, providerName, reason);
    if (error instanceof AccountingError && error.code === "not_configured") {
      return fail("conflict", { code: "accounting.notConfigured" satisfies ErrorCode });
    }
    return fail("error", {
      code: "accounting.syncFailed" satisfies ErrorCode,
      retryable: error instanceof AccountingError ? error.retryable : true,
      provider: providerName,
    });
  }

  const status: AccountingSyncStatus =
    invoiceResult.mode === "export" ? "EXPORTED" : "SYNCED";
  const updated = await prisma.accountingSync.update({
    where: { id: sync.id },
    data: {
      status,
      externalCustomerId: customerExternalId,
      externalInvoiceId: invoiceResult.externalId,
      externalInvoiceNumber: invoiceResult.externalNumber,
      lastError: null,
      lastAttemptAt: new Date(),
    },
  });

  let paymentsSynced = 0;
  let paymentFailures = 0;
  for (const payment of invoice.payments) {
    const existingPayment = await prisma.accountingPayment.findUnique({
      where: { syncId_paymentId: { syncId: sync.id, paymentId: payment.id } },
      select: { id: true, status: true },
    });
    if (existingPayment?.status === "SYNCED" || existingPayment?.status === "EXPORTED") {
      continue;
    }
    const paymentRow = existingPayment
      ? await prisma.accountingPayment.update({
          where: { id: existingPayment.id },
          data: {
            status: "PENDING",
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
            lastError: null,
          },
        })
      : await prisma.accountingPayment.create({
          data: {
            syncId: sync.id,
            paymentId: payment.id,
            provider: providerName,
            status: "PENDING",
            idempotencyKey: `accounting-payment:${providerName}:${payment.id}`,
            attemptCount: 1,
            lastAttemptAt: new Date(),
          },
        });
    try {
      const paymentResult = await provider.recordPayment({
        id: payment.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        externalInvoiceId: invoiceResult.externalId ?? "",
        amount: payment.amount.toFixed(2),
        currency: invoice.currency,
        paidAt: toDateOnly(payment.paidAt) ?? toDateOnly(todayUtc())!,
        reference: payment.reference,
        method: payment.method,
      });
      await prisma.accountingPayment.update({
        where: { id: paymentRow.id },
        data: {
          status: paymentResult.mode === "export" ? "EXPORTED" : "SYNCED",
          externalId: paymentResult.externalId,
          lastError: null,
          lastAttemptAt: new Date(),
        },
      });
      paymentsSynced += 1;
    } catch (error) {
      paymentFailures += 1;
      await prisma.accountingPayment.update({
        where: { id: paymentRow.id },
        data: {
          status: "FAILED",
          lastError: (error instanceof AccountingError ? error.code : "provider_error").slice(0, 200),
          lastAttemptAt: new Date(),
        },
      });
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.accountingSettings.update({
      where: { id: "default" },
      data: {
        lastSyncAt: now,
        lastSyncError: paymentFailures > 0 ? "payment_sync_failed" : null,
      },
    });
    await audit(tx, {
      entityType: "Invoice",
      entityId: invoice.id,
      action: `Synkroniserte faktura til ${providerName}`.slice(0, 200),
      actor: toAuditActor(actor),
      metadata: {
        provider: providerName,
        syncId: updated.id,
        status,
        ...(invoiceResult.externalId ? { externalInvoiceId: invoiceResult.externalId } : {}),
        paymentsSynced,
        paymentFailures,
      },
    });
  });

  return ok({
    provider: providerName,
    status,
    externalInvoiceId: invoiceResult.externalId,
    externalInvoiceNumber: invoiceResult.externalNumber,
    alreadySynced: false,
    paymentsSynced,
    paymentFailures,
  });
}

/** Markerer en synk som klar for nytt forsøk uten å slette revisjonssporet. */
export async function resetAccountingSync(
  actor: ServiceActor,
  invoiceId: string,
): Promise<ServiceResult<{ reset: true }>> {
  await assertModule("invoicing");
  if (!isAdminActor(actor) || !can(actor, "settings.manage")) return fail("forbidden");
  const providerName = resolveAccountingProviderName();
  const sync = await prisma.accountingSync.findUnique({
    where: { invoiceId_provider: { invoiceId, provider: providerName } },
    select: { id: true },
  });
  if (!sync) return fail("not_found");
  await prisma.$transaction(async (tx) => {
    await tx.accountingSync.update({
      where: { id: sync.id },
      data: { status: "PENDING", lastError: null },
    });
    await audit(tx, {
      entityType: "Invoice",
      entityId: invoiceId,
      action: `Nullstilte regnskapssynk (${providerName})`,
      actor: toAuditActor(actor),
      metadata: { provider: providerName, syncId: sync.id },
    });
  });
  return ok({ reset: true });
}
