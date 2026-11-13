// i18n-ignore-file: revisjonshandlinger er lagrede driftsdata, ikke UI-tekst.
import crypto from "node:crypto";
import { Prisma, type InvoiceStatus, type PaymentLinkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { toDateOnly, todayUtc } from "@/lib/dates";
import {
  parseMoney,
  payableAmount,
} from "@/lib/billing";
import { paymentProviderInfo, getPaymentProvider } from "@/lib/payments/provider";
import {
  PaymentProviderError,
  type PaymentProviderName,
  type PaymentWebhookEvent,
} from "@/lib/payments/types";
import { assertModule } from "./modules";
import { invoiceScopeFor, registerPayment } from "./invoices";
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
 * Betalingsflyt mot PSP.
 *
 * Tjenesten oppretter betalingslenker og anvender signerte webhooker. Selve
 * betalingsraden skrives alltid gjennom `registerPayment`, slik at delbetaling,
 * idempotens, statusavledning og revisjon følger de samme reglene som en
 * manuell betaling. Ingen kortdata eller hemmeligheter lagres.
 */

export const PAYMENT_WEBHOOK_ACTOR: ServiceActor = {
  id: "system:payments",
  name: "Betalingswebhook",
  email: null,
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissionsCustomized: true,
  permissions: ["customers.manage"],
  roleDefinition: null,
};

function canManagePayments(actor: ServiceActor): boolean {
  return actor.isActive && (isAdminActor(actor) || can(actor, "customers.manage"));
}

/** Stabil idempotensnøkkel. Kappes trygt, men aldri til en tom verdi. */
function idempotencyKey(prefix: string, value: string): string {
  const raw = `${prefix}:${value}`;
  if (raw.length <= 100) return raw;
  return `${prefix}:${crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 60)}`;
}

export type PaymentLinkResult = {
  provider: PaymentProviderName;
  url: string;
  status: PaymentLinkStatus;
};

export async function createInvoicePaymentLink(
  actor: ServiceActor,
  invoiceId: string,
): Promise<ServiceResult<PaymentLinkResult>> {
  await assertModule("invoicing");
  if (!canManagePayments(actor)) return fail("forbidden");
  const provider = getPaymentProvider();
  if (!provider || !provider.configured()) {
    // Stille no-op: ingen nettverkskall, ingen mutasjon, ingen hemmeligheter.
    return fail("conflict", { code: "payments.disabled" satisfies ErrorCode });
  }

  const id = String(invoiceId ?? "").trim();
  if (!id) return fail("not_found");
  const invoice = await prisma.invoice.findFirst({
    where: { id, AND: [invoiceScopeFor(actor)] },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      total: true,
      paidTotal: true,
      creditedTotal: true,
      dueDate: true,
      issueDate: true,
      paymentLinkId: true,
      customer: { select: { email: true, phone: true } },
    },
  });
  if (!invoice) return fail("not_found");
  if (!["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status)) {
    return fail("conflict", { code: "invoice.notPayable" satisfies ErrorCode });
  }
  const outstanding = payableAmount(invoice);
  if (outstanding.lte(0)) return fail("conflict", { code: "invoice.notPayable" satisfies ErrorCode });

  const currency = invoice.currency.toUpperCase();
  if (currency !== "NOK") {
    return fail("conflict", { code: "payments.unsupportedCurrency" satisfies ErrorCode });
  }

  let link;
  try {
    link = await provider.createPaymentLink({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: payableAmount(invoice).toFixed(2),
      currency,
      description: `Faktura ${invoice.invoiceNumber ?? invoice.id}`,
      returnUrl: `${appUrl()}/kundeportal/faktura/${invoice.id}`,
      // Stabil nøkkel per faktura, utestående og forrige lenke. En gjentatt
      // forespørsel før lagring gjenbruker samme lenke; en bevisst «lag ny»
      // etter en lagret lenke får en ny nøkkel. Kort nok for Vipps (maks 50).
      idempotencyKey: `pay-link-${provider.name}:${crypto
        .createHash("sha256")
        .update(
          `${invoice.id}:${outstanding.toFixed(2)}:${invoice.paymentLinkId ?? "new"}`,
          "utf8",
        )
        .digest("hex")
        .slice(0, 32)}`,
      customerEmail: invoice.customer.email,
      customerPhone: invoice.customer.phone,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      const code =
        error.code === "not_configured"
          ? "payments.disabled"
          : error.code === "rate_limited"
            ? "payments.rateLimited"
            : "payments.providerError";
      return fail(error.code === "not_configured" ? "conflict" : "error", {
        code,
        retryable: error.retryable,
      });
    }
    return fail("error", { code: "payments.providerError" satisfies ErrorCode, retryable: true });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentProvider: provider.name,
        paymentLinkId: link.providerId,
        paymentLinkUrl: link.url,
        paymentStatus: "PENDING",
        paymentLinkCreatedAt: now,
        paymentLinkUpdatedAt: now,
      },
    });
    await audit(tx, {
      entityType: "Invoice",
      entityId: invoice.id,
      action: `Opprettet betalingslenke via ${provider.name}`,
      actor: toAuditActor(actor),
      metadata: {
        provider: provider.name,
        paymentLinkId: link.providerId,
        status: "PENDING",
        amount: outstanding.toFixed(2),
      },
    });
  });

  return ok({ provider: provider.name, url: link.url, status: "PENDING" });
}

/**
 * Ren validering av en bekreftet PSP-hendelse mot fakturaen. Trukket ut slik
 * at valuta- og beløpsreglene kan testes uten database.
 */
export type PaymentValidation =
  | "ok"
  | "currency_mismatch"
  | "invalid_amount"
  | "amount_too_high"
  | "not_payable";

export function validateProviderPayment(input: {
  amount: string;
  currency: string;
  invoice: {
    status: string;
    total: Prisma.Decimal | string;
    paidTotal: Prisma.Decimal | string;
    creditedTotal: Prisma.Decimal | string;
    currency: string;
    dueDate: Date | null;
    issueDate: Date | null;
  };
}): PaymentValidation {
  if (input.currency.toUpperCase() !== input.invoice.currency.toUpperCase()) {
    return "currency_mismatch";
  }
  const amount = parseMoney(input.amount);
  if (!amount || amount.lte(0)) return "invalid_amount";
  const outstanding = payableAmount(input.invoice);
  if (amount.gt(outstanding)) return "amount_too_high";
  if (!["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(input.invoice.status)) {
    return "not_payable";
  }
  return "ok";
}

export type AppliedPaymentEvent = {
  outcome: "payment" | "duplicate" | "ignored" | "failed";
  invoiceId: string | null;
  paymentId: string | null;
  reason: string | null;
};

function paymentLinkStatusFor(status: InvoiceStatus): PaymentLinkStatus {
  if (status === "PAID") return "PAID";
  if (status === "PARTIALLY_PAID") return "PARTIALLY_PAID";
  if (status === "CREDITED") return "PAID";
  return "PENDING";
}

async function recordIgnoredEvent(
  event: PaymentWebhookEvent,
  invoiceId: string | null,
  reason: string,
  paymentStatus: PaymentLinkStatus | null,
): Promise<void> {
  if (!invoiceId) return;
  await prisma.$transaction(async (tx) => {
    if (paymentStatus) {
      await tx.invoice.updateMany({
        where: {
          id: invoiceId,
          status: { notIn: ["PAID", "CREDITED", "DRAFT"] },
        },
        data: { paymentStatus, paymentLinkUpdatedAt: new Date() },
      });
    }
    await audit(tx, {
      entityType: "Invoice",
      entityId: invoiceId,
      action: `Avviste betalingshendelse fra ${event.provider}`.slice(0, 200),
      actor: toAuditActor(PAYMENT_WEBHOOK_ACTOR),
      metadata: {
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.eventType,
        outcome: event.outcome,
        reason,
        ...(event.providerPaymentId ? { providerReference: event.providerPaymentId } : {}),
      },
    });
  });
}

/**
 * Anvender en allerede signaturverifisert webhook. Funksjonen er idempotent:
 * samme leverandørbetalings-id gir samme `Payment`-rad, også når hendelsen
 * leveres flere ganger eller via to ulike hendelsestyper.
 */
export async function applyPaymentEvent(
  providerName: PaymentProviderName,
  event: PaymentWebhookEvent,
): Promise<AppliedPaymentEvent> {
  if (!event.invoiceId) {
    return {
      outcome: "ignored",
      invoiceId: null,
      paymentId: null,
      reason: "unknown_invoice",
    };
  }
  const invoice = await prisma.invoice.findUnique({
    where: { id: event.invoiceId },
    select: {
      id: true,
      status: true,
      currency: true,
      total: true,
      paidTotal: true,
      creditedTotal: true,
      dueDate: true,
      issueDate: true,
      paymentProvider: true,
    },
  });
  if (!invoice) {
    return {
      outcome: "ignored",
      invoiceId: null,
      paymentId: null,
      reason: "unknown_invoice",
    };
  }

  if (event.outcome !== "PAID") {
    if (event.outcome === "IGNORED") {
      await recordIgnoredEvent(event, invoice.id, event.failureReason ?? "ignored", null);
      return {
        outcome: "ignored",
        invoiceId: invoice.id,
        paymentId: null,
        reason: event.failureReason ?? "ignored",
      };
    }
    const linkStatus = event.outcome === "EXPIRED" ? "EXPIRED" : "FAILED";
    await recordIgnoredEvent(
      event,
      invoice.id,
      event.failureReason ?? event.outcome.toLowerCase(),
      linkStatus,
    );
    return {
      outcome: event.outcome === "EXPIRED" ? "ignored" : "failed",
      invoiceId: invoice.id,
      paymentId: null,
      reason: event.failureReason ?? event.outcome.toLowerCase(),
    };
  }

  const validation = validateProviderPayment({
    amount: event.amount,
    currency: event.currency,
    invoice,
  });
  const key = idempotencyKey(providerName, event.providerPaymentId);

  // Sjekk idempotensen før beløpsreglene. En duplikatlevering som kommer etter
  // at fakturaen er fullt betalt, skal fortsatt svarer «duplicate» – ikke
  // «beløp over utestående».
  const existingPayment = await prisma.payment.findFirst({
    where: { invoiceId: invoice.id, idempotencyKey: key },
    select: { id: true },
  });
  if (existingPayment) {
    await prisma.invoice.updateMany({
      where: { id: invoice.id },
      data: {
        paymentStatus: paymentLinkStatusFor(invoice.status),
        paymentLinkUpdatedAt: new Date(),
      },
    });
    return {
      outcome: "duplicate",
      invoiceId: invoice.id,
      paymentId: existingPayment.id,
      reason: null,
    };
  }

  if (validation !== "ok") {
    const linkStatus =
      validation === "amount_too_high" || validation === "invalid_amount"
        ? "FAILED"
        : null;
    await recordIgnoredEvent(event, invoice.id, validation, linkStatus);
    return {
      outcome: "ignored",
      invoiceId: invoice.id,
      paymentId: null,
      reason: validation,
    };
  }

  const paidAt = toDateOnly(event.paidAt) ?? toDateOnly(todayUtc());
  if (!paidAt) {
    await recordIgnoredEvent(event, invoice.id, "invalid_paid_at", null);
    return {
      outcome: "ignored",
      invoiceId: invoice.id,
      paymentId: null,
      reason: "invalid_paid_at",
    };
  }

  const result = await registerPayment(PAYMENT_WEBHOOK_ACTOR, invoice.id, {
    amount: event.amount,
    paidAt,
    method: "ONLINE",
    reference: `${providerName}:${event.providerPaymentId}`.slice(0, 500),
    idempotencyKey: key,
    provider: providerName,
    providerEventId: event.eventId,
    providerReference: event.providerPaymentId,
  });

  if (!result.ok) {
    const code =
      (result.details as { code?: string } | undefined)?.code ?? result.reason;
    await recordIgnoredEvent(event, invoice.id, code, "FAILED");
    return {
      outcome: "failed",
      invoiceId: invoice.id,
      paymentId: null,
      reason: code,
    };
  }

  const linkStatus = paymentLinkStatusFor(result.data.status as InvoiceStatus);
  await prisma.invoice.updateMany({
    where: { id: invoice.id },
    data: {
      paymentStatus: linkStatus,
      paymentLinkUpdatedAt: new Date(),
      ...(linkStatus === "PAID"
        ? { paymentProvider: providerName, paymentLinkId: event.providerPaymentId }
        : {}),
    },
  });

  return {
    outcome: result.data.duplicate ? "duplicate" : "payment",
    invoiceId: invoice.id,
    paymentId: result.data.paymentId,
    reason: null,
  };
}

/** Trygg status for UI. Returnerer aldri URL-en som hemmelighet. */
export function invoicePaymentView(invoice: {
  paymentProvider: string | null;
  paymentLinkUrl: string | null;
  paymentStatus: PaymentLinkStatus;
}): {
  provider: string | null;
  configured: boolean;
  hasLink: boolean;
  status: PaymentLinkStatus;
} {
  const info = paymentProviderInfo();
  return {
    provider: invoice.paymentProvider,
    configured: info.configured,
    hasLink: Boolean(invoice.paymentLinkUrl),
    status: invoice.paymentStatus,
  };
}

function appUrl(): string {
  return (
    (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
      .trim()
      .replace(/\/$/, "") || "http://localhost:3000"
  );
}
