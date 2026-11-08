// i18n-ignore-file: leverandørfeil er driftsdata, ikke UI-tekst.

/**
 * Betalingsleverandør (PSP) uten kortdata i applikasjonen.
 *
 * Applikasjonen oppretter bare en betalingslenke og leser status fra
 * leverandørens webhook. Kortnummer, CVC og tilsvarende ligger alltid hos
 * leverandøren. Alle beløp går over API-et i minste valutaenhet (øre).
 */

export const PAYMENT_PROVIDERS = ["stripe", "vipps"] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export type PaymentLinkRequest = {
  invoiceId: string;
  invoiceNumber: string | null;
  amount: string;
  currency: string;
  description: string;
  returnUrl: string;
  /** Stabil nøkkel per faktura/utestående, sendes til leverandøren. */
  idempotencyKey: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

export type PaymentLink = {
  provider: PaymentProviderName;
  providerId: string;
  url: string;
  status: "PENDING";
};

export type PaymentWebhookEvent = {
  provider: PaymentProviderName;
  /** Leverandørens hendelses-id. Brukes til revisjon, ikke som beløpsnøkkel. */
  eventId: string;
  /** Stabil id for selve betalingen. Gjentatt levering gir samme verdi. */
  providerPaymentId: string;
  outcome: "PAID" | "FAILED" | "EXPIRED" | "IGNORED";
  /** Fakturaen hendelsen gjelder, når leverandøren oppgir den. */
  invoiceId: string | null;
  /** Leverandørens referanse tilbake til fakturaen (for Vipps). */
  reference: string | null;
  amount: string;
  currency: string;
  paidAt: Date;
  /** Leverandørens hendelsestype, kun for revisjon. */
  eventType: string;
  /** Kort, trygg feilkode. Aldri rå payload eller persondata. */
  failureReason: string | null;
};

export type PaymentWebhookRequest = {
  rawBody: string;
  headers: Headers;
  url?: string;
};

export type PaymentStatusResult = {
  provider: PaymentProviderName;
  providerId: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED";
  amount: string | null;
  currency: string | null;
};

export type PaymentProvider = {
  name: PaymentProviderName;
  /** True bare når leverandøren er valgt og alle nødvendige nøkler finnes. */
  configured(): boolean;
  createPaymentLink(input: PaymentLinkRequest): Promise<PaymentLink>;
  verifyWebhook(request: PaymentWebhookRequest): boolean;
  parseWebhook(request: PaymentWebhookRequest): PaymentWebhookEvent | null;
  getStatus(providerPaymentId: string): Promise<PaymentStatusResult>;
};

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "provider_error"
      | "invalid_signature"
      | "invalid_payload"
      | "rate_limited",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** Konverterer et desimalbeløp til minste valutaenhet uten flyttall. */
export function toMinorUnits(amount: string | number): number {
  const text = String(amount).trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new PaymentProviderError("Invalid amount", "invalid_payload");
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = `${fraction}00`.slice(0, 2);
  const sign = whole.startsWith("-") ? -1 : 1;
  const normalizedWhole = whole.replace(/^-/, "");
  return sign * (Number(normalizedWhole) * 100 + Number(cents));
}

/** Formaterer minste valutaenhet tilbake til et desimalbeløp. */
export function fromMinorUnits(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0.00";
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(number));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function normalizeCurrency(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}
