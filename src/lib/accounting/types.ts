// i18n-ignore-file: leverandørfeil er driftsdata, ikke UI-tekst.

/**
 * Regnskapsintegrasjon uten leverandør-SDK.
 *
 * Alle konnektorer bruker REST over `fetch`. En konnektor skal aldri late som
 * et eksternt kall lyktes: feiler HTTP-kallet, kastes en `AccountingError`, og
 * synkraden blir `FAILED` med en retrybar tilstand.
 */

export const ACCOUNTING_PROVIDERS = [
  "fiken",
  "tripletex",
  "poweroffice",
  "csv",
] as const;

export type AccountingProviderName = (typeof ACCOUNTING_PROVIDERS)[number];

export type AccountingMode = "api" | "export";

export type AccountingCustomerInput = {
  id: string;
  name: string;
  orgNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
};

export type AccountingInvoiceLine = {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  lineTotal: string;
  lineVat: string;
};

export type AccountingInvoiceInput = {
  id: string;
  invoiceNumber: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  /** Kundenes id hos regnskapsleverandøren, fra AccountingCustomer. */
  externalCustomerId: string;
  customer: AccountingCustomerInput;
  lines: AccountingInvoiceLine[];
  subtotal: string;
  vatTotal: string;
  total: string;
  notes: string | null;
};

export type AccountingPaymentInput = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  externalInvoiceId: string;
  amount: string;
  currency: string;
  paidAt: string;
  reference: string | null;
  method: string;
};

export type AccountingSyncResult = {
  /** Ekstern id, eller en deterministisk eksportreferanse for CSV. */
  externalId: string | null;
  externalNumber: string | null;
  mode: AccountingMode;
  /** Settes bare av CSV-fallbacken. */
  csv?: string;
};

export type AccountingConnectionResult = {
  ok: boolean;
  /** Kort, trygg melding uten hemmeligheter eller persondata. */
  message: string;
  detail?: string | null;
};

export type AccountingProvider = {
  name: AccountingProviderName;
  mode: AccountingMode;
  configured(): boolean;
  testConnection(): Promise<AccountingConnectionResult>;
  syncCustomer(input: AccountingCustomerInput): Promise<AccountingSyncResult>;
  syncInvoice(input: AccountingInvoiceInput): Promise<AccountingSyncResult>;
  recordPayment(input: AccountingPaymentInput): Promise<AccountingSyncResult>;
};

export class AccountingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "provider_error"
      | "invalid_payload"
      | "unsupported"
      | "rate_limited",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AccountingError";
  }
}

/** Minste valutaenhet uten flyttall (Fiken og Vipps bruker øre). */
export function minorUnits(amount: string | number): number {
  const text = String(amount).trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new AccountingError("Invalid amount", "invalid_payload");
  }
  const [whole, fraction = ""] = text.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  return sign * (Number(whole.replace(/^-/, "")) * 100 + Number(`${fraction}00`.slice(0, 2)));
}

/** Avrundet desimaltall uten valutaformat, for API-er som vil ha kroner. */
export function decimalAmount(amount: string | number): number {
  return minorUnits(amount) / 100;
}
