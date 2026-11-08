// i18n-ignore-file: konfigurasjonsstatus er driftsdata, ikke UI-tekst.
import { csvProvider } from "./csv";
import { fikenProvider } from "./fiken";
import { powerOfficeProvider } from "./poweroffice";
import { tripletexProvider } from "./tripletex";
import {
  ACCOUNTING_PROVIDERS,
  type AccountingMode,
  type AccountingProvider,
  type AccountingProviderName,
} from "./types";

/**
 * Velger regnskapsleverandør fra `ACCOUNTING_PROVIDER`.
 *
 * Ukjent eller tom verdi faller tilbake til CSV, som aldri gjør et eksternt
 * kall. Om integrasjonen faktisk er slått på styres av `AccountingSettings`.
 */
export function resolveAccountingProviderName(
  value: string | undefined = process.env.ACCOUNTING_PROVIDER,
): AccountingProviderName {
  const candidate = (value ?? "").trim().toLowerCase();
  if (candidate === "poweroffice-go" || candidate === "powerofficego") {
    return "poweroffice";
  }
  return (ACCOUNTING_PROVIDERS as readonly string[]).includes(candidate)
    ? (candidate as AccountingProviderName)
    : "csv";
}

const PROVIDERS: Record<AccountingProviderName, AccountingProvider> = {
  fiken: fikenProvider,
  tripletex: tripletexProvider,
  poweroffice: powerOfficeProvider,
  csv: csvProvider,
};

export function getAccountingProvider(
  name: AccountingProviderName = resolveAccountingProviderName(),
): AccountingProvider {
  return PROVIDERS[name];
}

export type AccountingProviderInfo = {
  provider: AccountingProviderName;
  mode: AccountingMode;
  configured: boolean;
  /** Sanne nøkler er konfigurert, uten å avsløre verdiene. */
  settings: {
    baseUrl: boolean;
    company: boolean;
    paymentAccounts: boolean;
  };
};

/** Trygg status for administratorpanelet. */
export function accountingProviderInfo(
  name: AccountingProviderName = resolveAccountingProviderName(),
): AccountingProviderInfo {
  const provider = PROVIDERS[name];
  return {
    provider: name,
    mode: provider.mode,
    configured: provider.configured(),
    settings: {
      baseUrl: Boolean(process.env.ACCOUNTING_BASE_URL || provider.name === "csv"),
      company:
        name === "fiken"
          ? Boolean(process.env.FIKEN_COMPANY_SLUG)
          : name === "tripletex"
            ? Boolean(process.env.TRIPLETEX_TOKEN)
            : name === "poweroffice"
              ? Boolean(process.env.POWEROFFICE_CLIENT_ID || process.env.POWEROFFICE_TOKEN)
              : true,
      paymentAccounts:
        name === "fiken"
          ? Boolean(process.env.FIKEN_PAYMENT_DEBIT_ACCOUNT)
          : name === "tripletex"
            ? Boolean(process.env.TRIPLETEX_PAYMENT_TYPE_ID)
            : name === "poweroffice"
              ? Boolean(process.env.POWEROFFICE_PAYMENT_DEBIT_ACCOUNT_ID)
              : true,
    },
  };
}
