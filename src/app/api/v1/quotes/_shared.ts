import { apiError } from "@/lib/api-response";
import { toDateOnly } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import type { ServiceActor } from "@/server/actor";
import type { QuoteDetail, QuoteListItem } from "@/server/quotes";

/** Lesetilgang følger samme regel som `quoteScopeFor` i tjenestelaget. */
export function canReadQuotes(actor: ServiceActor): boolean {
  return (
    actor.role === "CUSTOMER" ||
    hasPermission(actor, "customers.view") ||
    hasPermission(actor, "customers.manage") ||
    hasPermission(actor, "workorders.view")
  );
}

export function canManageQuotes(actor: ServiceActor): boolean {
  return actor.role === "ADMIN" || hasPermission(actor, "customers.manage");
}

function decimal(value: { toString(): string } | string | number | null): string {
  if (value === null) return "0.00";
  return String(value);
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? toDateOnly(value) || null : null;
}

export function serializeQuoteList(
  quote: QuoteListItem,
) {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    status: quote.status,
    version: quote.version,
    total: decimal(quote.total),
    validUntil: dateOnly(quote.validUntil),
    customer: quote.customer,
    updatedAt: quote.updatedAt.toISOString(),
  };
}

/**
 * Serialiserer et tilbud. Alle beløp kommer fra de lagrede, serverberegnede
 * feltene – aldri fra klienten – og sendes som desimalstrenger for å unngå
 * flyttallstap i integrasjonen.
 */
export function serializeQuoteDetail(quote: QuoteDetail) {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    status: quote.status,
    version: quote.version,
    currency: quote.currency,
    subtotal: decimal(quote.subtotal),
    vatTotal: decimal(quote.vatTotal),
    total: decimal(quote.total),
    vatRate: decimal(quote.vatRate),
    validUntil: dateOnly(quote.validUntil),
    notes: quote.notes,
    customer: quote.customer ?? null,
    customerName: quote.customerName,
    contact: quote.contact ?? null,
    workOrder: quote.workOrder ?? null,
    contract: quote.contract ?? null,
    product: quote.product ?? null,
    department: quote.department,
    lines: quote.lines.map((line) => ({
      id: line.id,
      sortOrder: line.sortOrder,
      description: line.description,
      quantity: decimal(line.quantity),
      unit: line.unit,
      unitPrice: decimal(line.unitPrice),
      vatRate: decimal(line.vatRate),
      lineTotal: decimal(line.lineTotal),
      lineVat: decimal(line.lineVat),
    })),
    versions: quote.versions.map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      total: decimal(version.total),
      createdAt: version.createdAt.toISOString(),
    })),
    invoices: quote.invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      total: decimal(invoice.total),
    })),
    sentAt: quote.sentAt?.toISOString() ?? null,
    acceptedAt: quote.acceptedAt?.toISOString() ?? null,
    rejectedAt: quote.rejectedAt?.toISOString() ?? null,
    convertedWorkOrderId: quote.convertedWorkOrderId,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
  };
}

export function quoteError(
  error: string,
  keys: { forbidden: string; notFound: string; conflict: string; validation: string },
) {
  switch (error) {
    case "forbidden":
      return apiError("forbidden", 403, { messageKey: keys.forbidden });
    case "not_found":
      return apiError("not_found", 404, { messageKey: keys.notFound });
    case "conflict":
      return apiError("conflict", 409, { messageKey: keys.conflict });
    case "invalid":
    case "missing_fields":
      return apiError("validation_error", 422, { messageKey: keys.validation });
    default:
      return apiError("server_error", 500, {
        messageKey: "errors.api.quotes.serverError",
      });
  }
}
