// i18n-ignore-file: konfigurasjonsstatus er driftsdata, ikke UI-tekst.
import { stripeProvider } from "./stripe";
import { vippsProvider } from "./vipps";
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type PaymentProviderName,
} from "./types";

/**
 * Velger betalingsleverandør fra miljøet.
 *
 * `PAYMENTS_PROVIDER` er eneste kilde til valg. Ukjent eller tom verdi gir
 * «ingen leverandør», og da er alle betalingshandlinger en stille no-op:
 * ingen nettverkskall, ingen databasemutasjon og ingen hemmeligheter i UI.
 */
export function resolvePaymentProviderName(
  value: string | undefined = process.env.PAYMENTS_PROVIDER,
): PaymentProviderName | null {
  const candidate = (value ?? "").trim().toLowerCase();
  if (candidate === "" || candidate === "none" || candidate === "disabled") {
    return null;
  }
  return (PAYMENT_PROVIDERS as readonly string[]).includes(candidate)
    ? (candidate as PaymentProviderName)
    : null;
}

const PROVIDERS: Record<PaymentProviderName, PaymentProvider> = {
  stripe: stripeProvider,
  vipps: vippsProvider,
};

/** Returnerer valgt leverandør, eller null når betaling er slått av. */
export function getPaymentProvider(): PaymentProvider | null {
  const name = resolvePaymentProviderName();
  if (!name) return null;
  return PROVIDERS[name];
}

/** Leverandøren navngitt i URL-en, bare når den er valgt i miljøet. */
export function getPaymentProviderForWebhook(
  name: string,
): PaymentProvider | null {
  const resolved = resolvePaymentProviderName();
  if (!resolved || resolved !== name) return null;
  return PROVIDERS[resolved];
}

export type PaymentProviderInfo = {
  provider: PaymentProviderName | null;
  configured: boolean;
  webhookConfigured: boolean;
  /** Hvilke valutaer leverandøren kan bruke i denne versjonen. */
  currencies: string[];
};

/**
 * Trygg status for innstillinger og portalen. Returnerer aldri nøkler,
 * hemmeligheter eller leverandørens rå konfigurasjon.
 */
export function paymentProviderInfo(
  name: PaymentProviderName | null = resolvePaymentProviderName(),
): PaymentProviderInfo {
  if (!name) {
    return { provider: null, configured: false, webhookConfigured: false, currencies: [] };
  }
  const provider = PROVIDERS[name];
  return {
    provider: name,
    configured: provider.configured(),
    webhookConfigured: provider.configured(),
    currencies: ["NOK"],
  };
}
