// i18n-ignore-file: leverandørfeil er driftsdata, ikke UI-tekst.
import {
  AccountingError,
  minorUnits,
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
  idFromLocation,
  jsonOrNull,
} from "./http";

/**
 * Fiken API v2 (https://api.fiken.no/api/v2).
 *
 * Fiken har ikke et eget betalingsendepunkt for fakturaer. En innbetaling
 * bokføres derfor som en fri journalpost med debet bank og kredit
 * kundefordringsreskontro. Kontokodene må konfigureres; uten dem feiler
 * betalingssynken ærlig i stedet for å late som den lyktes.
 */

function baseUrl(): string {
  return (envValue("FIKEN_BASE_URL") || "https://api.fiken.no/api/v2").replace(/\/$/, "");
}

function token(): string {
  return envValue("FIKEN_TOKEN");
}

function companySlug(): string {
  return envValue("FIKEN_COMPANY_SLUG");
}

function companyUrl(): string {
  return `${baseUrl()}/companies/${encodeURIComponent(companySlug())}`;
}

function headers(idempotencyKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Fiken-Request-Id": idempotencyKey } : {}),
  };
}

function configured(): boolean {
  return Boolean(token() && companySlug());
}

async function createContact(
  input: AccountingCustomerInput,
): Promise<AccountingSyncResult> {
  const address =
    input.address && input.city
      ? {
          streetAddress: input.address.slice(0, 200),
          postCode: (input.postalCode ?? "").slice(0, 20),
          city: input.city.slice(0, 100),
          country: "Norge",
        }
      : undefined;
  const response = await accountingRequest("Fiken", `${companyUrl()}/contacts`, {
    method: "POST",
    headers: headers(`fsm-customer-${input.id}`),
    body: JSON.stringify({
      name: input.name,
      organizationNumber: input.orgNumber ?? undefined,
      email: input.email ?? undefined,
      phoneNumber: input.phone ?? undefined,
      customer: true,
      ...(address ? { address } : {}),
    }),
  });
  const body = await jsonOrNull<{ contactId?: number | string }>(response);
  const externalId = idFromLocation(response) ?? body?.contactId?.toString() ?? null;
  if (!externalId) {
    throw new AccountingError("Fiken returned no contact id", "provider_error", true);
  }
  return { externalId, externalNumber: null, mode: "api" };
}

async function createInvoice(
  input: AccountingInvoiceInput,
  externalCustomerId: string,
): Promise<AccountingSyncResult> {
  const bankAccountCode = envValue("FIKEN_BANK_ACCOUNT");
  if (!bankAccountCode) {
    throw new AccountingError(
      "FIKEN_BANK_ACCOUNT is required to create invoices",
      "not_configured",
    );
  }
  const response = await accountingRequest("Fiken", `${companyUrl()}/invoices`, {
    method: "POST",
    headers: headers(`fsm-invoice-${input.id}`),
    body: JSON.stringify({
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      customerId: Number(externalCustomerId),
      currency: input.currency,
      cash: false,
      bankAccountCode,
      invoiceText: (input.notes ?? `Faktura ${input.invoiceNumber ?? input.id}`).slice(0, 500),
      lines: input.lines.map((line) => ({
        description: line.description.slice(0, 200),
        quantity: Number(line.quantity),
        unitPrice: minorUnits(line.unitPrice),
        vatInPercent: Number(line.vatRate),
        vatType: Number(line.vatRate) > 0 ? "HIGH" : "NONE",
      })),
    }),
  });
  const body = await jsonOrNull<{ invoiceId?: number | string; invoiceNumber?: number | string }>(
    response,
  );
  const externalId = idFromLocation(response) ?? body?.invoiceId?.toString() ?? null;
  if (!externalId) {
    throw new AccountingError("Fiken returned no invoice id", "provider_error", true);
  }
  return {
    externalId,
    externalNumber: body?.invoiceNumber?.toString() ?? input.invoiceNumber,
    mode: "api",
  };
}

export const fikenProvider: AccountingProvider = {
  name: "fiken",
  mode: "api",

  configured,

  async testConnection(): Promise<AccountingConnectionResult> {
    if (!configured()) {
      return { ok: false, message: "not_configured" };
    }
    try {
      const response = await accountingRequest("Fiken", companyUrl(), {
        method: "GET",
        headers: headers(),
      });
      const body = await jsonOrNull<{ name?: string }>(response);
      return {
        ok: true,
        message: "connected",
        detail: body?.name ? body.name.slice(0, 120) : null,
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
    if (!configured()) throw new AccountingError("Fiken is not configured", "not_configured");
    return createContact(input);
  },

  async syncInvoice(input: AccountingInvoiceInput): Promise<AccountingSyncResult> {
    if (!configured()) throw new AccountingError("Fiken is not configured", "not_configured");
    if (!/^\d+$/.test(input.externalCustomerId)) {
      throw new AccountingError("Fiken customer id is missing", "invalid_payload");
    }
    return createInvoice(input, input.externalCustomerId);
  },

  async recordPayment(input: AccountingPaymentInput): Promise<AccountingSyncResult> {
    if (!configured()) throw new AccountingError("Fiken is not configured", "not_configured");
    const debitAccount = envValue("FIKEN_PAYMENT_DEBIT_ACCOUNT");
    const creditAccount = envValue("FIKEN_PAYMENT_CREDIT_ACCOUNT");
    if (!debitAccount || !creditAccount) {
      throw new AccountingError(
        "Fiken payment accounts are not configured",
        "not_configured",
      );
    }
    const amount = minorUnits(input.amount);
    const response = await accountingRequest(
      "Fiken",
      `${companyUrl()}/generalJournalEntries`,
      {
        method: "POST",
        headers: headers(`fsm-payment-${input.id}`),
        body: JSON.stringify({
          description: `Betaling faktura ${input.invoiceNumber ?? input.invoiceId}`.slice(0, 200),
          journalEntries: [
            {
              description: `Betaling faktura ${input.invoiceNumber ?? input.invoiceId}`.slice(0, 200),
              date: input.paidAt,
              lines: [
                { amount, debitAccount },
                { amount, creditAccount },
              ],
            },
          ],
        }),
      },
    );
    return {
      externalId: idFromLocation(response) ?? `fiken-payment-${input.id}`,
      externalNumber: null,
      mode: "api",
    };
  },
};
