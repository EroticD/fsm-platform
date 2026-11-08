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
  envValue,
  jsonOrNull,
} from "./http";

/**
 * PowerOffice Go API v2.
 *
 * API-et bruker OAuth2 (client credentials) eller et ferdig bearer-token.
 * Endepunktene er konfigurerbare fordi PowerOffice har endret ressursnavn
 * mellom versjoner; standardverdiene er dokumentert i docs/ACCOUNTING.md.
 * Betaling bokføres som en bankjournal, ikke som en direkte fakturaoperasjon.
 */

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function baseUrl(): string {
  return (envValue("POWEROFFICE_BASE_URL") || "https://goapi.poweroffice.net/v2").replace(/\/$/, "");
}

function staticToken(): string {
  return envValue("POWEROFFICE_TOKEN");
}

function configured(): boolean {
  return Boolean(
    staticToken() ||
      (envValue("POWEROFFICE_CLIENT_ID") && envValue("POWEROFFICE_CLIENT_SECRET")),
  );
}

async function accessToken(): Promise<string> {
  const fixed = staticToken();
  if (fixed) return fixed;
  if (!configured()) {
    throw new AccountingError("PowerOffice is not configured", "not_configured");
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;

  const tokenUrl =
    envValue("POWEROFFICE_TOKEN_URL") || "https://goapi.poweroffice.net/OAuth/Token";
  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(envValue("POWEROFFICE_SUBSCRIPTION_KEY")
          ? { "Ocp-Apim-Subscription-Key": envValue("POWEROFFICE_SUBSCRIPTION_KEY") }
          : {}),
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: envValue("POWEROFFICE_CLIENT_ID"),
        client_secret: envValue("POWEROFFICE_CLIENT_SECRET"),
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AccountingError("PowerOffice token request failed", "provider_error", true);
  }
  if (!response.ok) {
    throw new AccountingError(
      `PowerOffice token request returned HTTP ${response.status}`,
      "provider_error",
      response.status >= 500 || response.status === 429,
    );
  }
  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!body?.access_token) {
    throw new AccountingError("PowerOffice returned no token", "provider_error", true);
  }
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
  };
  return body.access_token;
}

async function headers(idempotencyKey?: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await accessToken()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "X-Request-Id": idempotencyKey } : {}),
  };
}

function path(name: "customers" | "invoices" | "payments"): string {
  const defaults = {
    customers: "/Customers",
    invoices: "/OutgoingInvoices",
    payments: "/BankJournalVouchers",
  };
  const key = {
    customers: "POWEROFFICE_CUSTOMERS_PATH",
    invoices: "POWEROFFICE_INVOICES_PATH",
    payments: "POWEROFFICE_PAYMENTS_PATH",
  }[name];
  return envValue(key) || defaults[name];
}

function idOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = row.Id ?? row.id ?? row.CustomerId ?? row.InvoiceId;
  return id === undefined || id === null ? null : String(id);
}

async function createCustomer(
  input: AccountingCustomerInput,
): Promise<AccountingSyncResult> {
  const response = await accountingRequest(
    "PowerOffice",
    `${baseUrl()}${path("customers")}`,
    {
      method: "POST",
      headers: await headers(`fsm-customer-${input.id}`),
      body: JSON.stringify({
        Name: input.name,
        OrganizationNumber: input.orgNumber ?? undefined,
        EmailAddress: input.email ?? undefined,
        PhoneNumber: input.phone ?? undefined,
        ...(input.address
          ? {
              MailAddress: {
                AddressLine1: input.address,
                PostalCode: input.postalCode ?? "",
                City: input.city ?? "",
                CountryCode: "NO",
              },
            }
          : {}),
      }),
    },
  );
  const body = await jsonOrNull<Record<string, unknown>>(response);
  const externalId = idOf(body);
  if (!externalId) {
    throw new AccountingError("PowerOffice returned no customer id", "provider_error", true);
  }
  return { externalId, externalNumber: null, mode: "api" };
}

async function createInvoice(
  input: AccountingInvoiceInput,
): Promise<AccountingSyncResult> {
  const vatCode = envValue("POWEROFFICE_VAT_CODE") || "25";
  const response = await accountingRequest(
    "PowerOffice",
    `${baseUrl()}${path("invoices")}`,
    {
      method: "POST",
      headers: await headers(`fsm-invoice-${input.id}`),
      body: JSON.stringify({
        CustomerId: input.externalCustomerId,
        InvoiceDate: input.issueDate,
        DueDate: input.dueDate,
        CurrencyCode: input.currency,
        Description: `Faktura ${input.invoiceNumber ?? input.id}`.slice(0, 200),
        OrderLines: input.lines.map((line) => ({
          Description: line.description.slice(0, 200),
          Quantity: Number(line.quantity),
          UnitPrice: decimalAmount(line.unitPrice),
          VatCode: vatCode,
        })),
      }),
    },
  );
  const body = await jsonOrNull<Record<string, unknown>>(response);
  const externalId = idOf(body);
  if (!externalId) {
    throw new AccountingError("PowerOffice returned no invoice id", "provider_error", true);
  }
  const externalNumber =
    body?.InvoiceNo === undefined || body.InvoiceNo === null
      ? input.invoiceNumber
      : String(body.InvoiceNo);
  return { externalId, externalNumber, mode: "api" };
}

export const powerOfficeProvider: AccountingProvider = {
  name: "poweroffice",
  mode: "api",

  configured,

  async testConnection(): Promise<AccountingConnectionResult> {
    if (!configured()) return { ok: false, message: "not_configured" };
    try {
      const response = await accountingRequest(
        "PowerOffice",
        `${baseUrl()}${path("customers")}?$top=1`,
        { method: "GET", headers: await headers() },
      );
      await response.text();
      return { ok: true, message: "connected", detail: null };
    } catch (error) {
      return {
        ok: false,
        message: "connection_failed",
        detail: error instanceof AccountingError ? error.code : "provider_error",
      };
    }
  },

  async syncCustomer(input: AccountingCustomerInput): Promise<AccountingSyncResult> {
    if (!configured()) {
      throw new AccountingError("PowerOffice is not configured", "not_configured");
    }
    return createCustomer(input);
  },

  async syncInvoice(input: AccountingInvoiceInput): Promise<AccountingSyncResult> {
    if (!configured()) {
      throw new AccountingError("PowerOffice is not configured", "not_configured");
    }
    return createInvoice(input);
  },

  async recordPayment(input: AccountingPaymentInput): Promise<AccountingSyncResult> {
    if (!configured()) {
      throw new AccountingError("PowerOffice is not configured", "not_configured");
    }
    const debitAccount = envValue("POWEROFFICE_PAYMENT_DEBIT_ACCOUNT_ID");
    const creditAccount = envValue("POWEROFFICE_PAYMENT_CREDIT_ACCOUNT_ID");
    if (!debitAccount || !creditAccount) {
      throw new AccountingError(
        "PowerOffice payment accounts are not configured",
        "not_configured",
      );
    }
    const amount = decimalAmount(input.amount);
    const response = await accountingRequest(
      "PowerOffice",
      `${baseUrl()}${path("payments")}`,
      {
        method: "POST",
        headers: await headers(`fsm-payment-${input.id}`),
        body: JSON.stringify({
          VoucherDate: input.paidAt,
          Description: `Betaling faktura ${input.invoiceNumber ?? input.invoiceId}`.slice(0, 200),
          Lines: [
            {
              AccountId: Number(debitAccount),
              Amount: amount,
              Description: `Betaling ${input.invoiceNumber ?? input.invoiceId}`.slice(0, 200),
            },
            {
              AccountId: Number(creditAccount),
              Amount: -amount,
              Description: `Betaling ${input.invoiceNumber ?? input.invoiceId}`.slice(0, 200),
              CustomMatchingReference: input.invoiceNumber ?? input.invoiceId,
            },
          ],
        }),
      },
    );
    const body = await jsonOrNull<Record<string, unknown>>(response);
    return {
      externalId: idOf(body) ?? `poweroffice-payment-${input.id}`,
      externalNumber: null,
      mode: "api",
    };
  },
};

/** Nullstiller token-cachen. Brukes av tester. */
export function resetPowerOfficeTokenCache(): void {
  tokenCache = null;
}
