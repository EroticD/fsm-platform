// i18n-ignore-file: leverandørfeil er driftsdata, ikke UI-tekst.
import {
  AccountingError,
  decimalAmount,
  type AccountingConnectionResult,
  type AccountingCustomerInput,
  type AccountingInvoiceInput,
  type AccountingPaymentInput,
  type AccountingProvider,
  type AccountingSyncResult,
} from "./types";
import {
  accountingRequest,
  basicAuth,
  envValue,
  jsonOrNull,
} from "./http";

/**
 * Tripletex API v2 (https://tripletex.no/v2).
 *
 * Autentisering er API-token som HTTP Basic med brukernavn `0` (eller
 * `TRIPLETEX_API_USER`). Fakturaen opprettes som ordre + faktura. Betaling
 * krever en betalingstype-id fra Tripletex; uten den feiler betalingssynken
 * eksplisitt.
 */

type TripletexValue<T> = { value?: T };

function baseUrl(): string {
  return (envValue("TRIPLETEX_BASE_URL") || "https://tripletex.no/v2").replace(/\/$/, "");
}

function token(): string {
  return envValue("TRIPLETEX_TOKEN");
}

function configured(): boolean {
  return Boolean(token());
}

function headers(idempotencyKey?: string): Record<string, string> {
  return {
    Authorization: basicAuth(envValue("TRIPLETEX_API_USER") || "0", token()),
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "X-Request-Id": idempotencyKey } : {}),
  };
}

async function createCustomer(
  input: AccountingCustomerInput,
): Promise<AccountingSyncResult> {
  const response = await accountingRequest("Tripletex", `${baseUrl()}/customer`, {
    method: "POST",
    headers: headers(`fsm-customer-${input.id}`),
    body: JSON.stringify({
      name: input.name,
      organizationNumber: input.orgNumber ?? undefined,
      email: input.email ?? undefined,
      phoneNumber: input.phone ?? undefined,
      isCustomer: true,
      ...(input.address
        ? {
            postalAddress: {
              addressLine1: input.address,
              postalCode: input.postalCode ?? "",
              city: input.city ?? "",
            },
          }
        : {}),
    }),
  });
  const body = await jsonOrNull<TripletexValue<{ id?: number | string }>>(response);
  const externalId = body?.value?.id?.toString() ?? null;
  if (!externalId) {
    throw new AccountingError("Tripletex returned no customer id", "provider_error", true);
  }
  return { externalId, externalNumber: null, mode: "api" };
}

async function createInvoice(
  input: AccountingInvoiceInput,
): Promise<AccountingSyncResult> {
  const vatTypeId = Number(envValue("TRIPLETEX_VAT_TYPE_ID") || "3");
  const customerId = Number(input.externalCustomerId);
  if (!Number.isFinite(customerId)) {
    throw new AccountingError("Tripletex customer id is missing", "invalid_payload");
  }
  const orderResponse = await accountingRequest("Tripletex", `${baseUrl()}/order`, {
    method: "POST",
    headers: headers(`fsm-order-${input.id}`),
    body: JSON.stringify({
      customer: { id: customerId },
      orderDate: input.issueDate,
      deliveryDate: input.issueDate,
      reference: input.invoiceNumber ?? input.id,
      orderLines: input.lines.map((line) => ({
        description: line.description.slice(0, 200),
        count: Number(line.quantity),
        unitPriceExcludingVatCurrency: decimalAmount(line.unitPrice),
        vatType: { id: vatTypeId },
      })),
    }),
  });
  const order = await jsonOrNull<TripletexValue<{ id?: number | string }>>(orderResponse);
  const orderId = order?.value?.id;
  if (orderId === undefined || orderId === null) {
    throw new AccountingError("Tripletex returned no order id", "provider_error", true);
  }

  const invoiceResponse = await accountingRequest("Tripletex", `${baseUrl()}/invoice`, {
    method: "POST",
    headers: headers(`fsm-invoice-${input.id}`),
    body: JSON.stringify({
      invoiceDate: input.issueDate,
      dueDate: input.dueDate,
      orders: [{ id: Number(orderId) }],
      invoiceComment: (input.notes ?? "").slice(0, 500) || undefined,
    }),
  });
  const invoice = await jsonOrNull<
    TripletexValue<{ id?: number | string; invoiceNumber?: number | string }>
  >(invoiceResponse);
  const externalId = invoice?.value?.id?.toString() ?? null;
  if (!externalId) {
    throw new AccountingError("Tripletex returned no invoice id", "provider_error", true);
  }
  return {
    externalId,
    externalNumber: invoice?.value?.invoiceNumber?.toString() ?? input.invoiceNumber,
    mode: "api",
  };
}

export const tripletexProvider: AccountingProvider = {
  name: "tripletex",
  mode: "api",

  configured,

  async testConnection(): Promise<AccountingConnectionResult> {
    if (!configured()) return { ok: false, message: "not_configured" };
    try {
      const response = await accountingRequest(
        "Tripletex",
        `${baseUrl()}/token/session/%3EwhoAmI`,
        { method: "GET", headers: headers() },
      );
      const body = await jsonOrNull<TripletexValue<{ employeeId?: number }>>(response);
      return {
        ok: true,
        message: "connected",
        detail: body?.value?.employeeId ? "whoAmI" : null,
      };
    } catch (error) {
      return {
        ok: false,
        message: "connection_failed",
        detail: error instanceof AccountingError ? error.code : "provider_error",
      };
    }
  },

  async syncCustomer(input: AccountingCustomerInput): Promise<AccountingSyncResult> {
    if (!configured()) throw new AccountingError("Tripletex is not configured", "not_configured");
    return createCustomer(input);
  },

  async syncInvoice(input: AccountingInvoiceInput): Promise<AccountingSyncResult> {
    if (!configured()) throw new AccountingError("Tripletex is not configured", "not_configured");
    return createInvoice(input);
  },

  async recordPayment(input: AccountingPaymentInput): Promise<AccountingSyncResult> {
    if (!configured()) throw new AccountingError("Tripletex is not configured", "not_configured");
    const paymentTypeId = envValue("TRIPLETEX_PAYMENT_TYPE_ID");
    if (!paymentTypeId) {
      throw new AccountingError(
        "TRIPLETEX_PAYMENT_TYPE_ID is required to record payments",
        "not_configured",
      );
    }
    const params = new URLSearchParams({
      paymentDate: input.paidAt,
      paymentTypeId,
      amount: decimalAmount(input.amount).toFixed(2),
    });
    const response = await accountingRequest(
      "Tripletex",
      `${baseUrl()}/invoice/${encodeURIComponent(input.externalInvoiceId)}/:payment?${params.toString()}`,
      { method: "PUT", headers: headers(`fsm-payment-${input.id}`) },
    );
    const body = await jsonOrNull<TripletexValue<{ id?: number | string }>>(response);
    return {
      externalId: body?.value?.id?.toString() ?? `tripletex-payment-${input.id}`,
      externalNumber: null,
      mode: "api",
    };
  },
};
