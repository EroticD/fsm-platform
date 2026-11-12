"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { lookupCompanyAction } from "@/app/kunder/actions";
import type { CompanyLookupState } from "@/app/kunder/actions";
import type { CompanyRecord } from "@/lib/brreg";
import Icon from "@/components/icons";
import { buttonClassName } from "@/components/ui/Button";

type LookupFailure = Exclude<CompanyLookupState["status"], "found">;

/**
 * Feltene i skjemaet som fylles fra Enhetsregisteret. Rekkefølgen er også
 * rekkefølgen vi skriver i, slik at navnet alltid lander før adressen.
 */
const AUTOFILL_FIELDS = [
  "name",
  "address",
  "postalCode",
  "city",
  "phone",
] as const;

/** Teksten for hver feiltilstand. «found» har sin egen, rikere visning. */
const FAILURE_KEYS: Record<LookupFailure, string> = {
  not_found: "customers.lookup.notFound",
  removed: "customers.lookup.removed",
  unavailable: "customers.lookup.unavailable",
  invalid: "customers.lookup.invalid",
  forbidden: "customers.lookup.forbidden",
  rate_limited: "customers.lookup.rateLimited",
};

/**
 * Statuser der vi ikke fikk noe svar vi kan bruke. De får samme røde tone som
 * `ErrorBanner`, mens «ikke funnet» og «slettet» er ren informasjon.
 */
const ERROR_STATUSES = new Set<LookupFailure>([
  "unavailable",
  "invalid",
  "forbidden",
  "rate_limited",
]);

/**
 * Skriver en verdi til et inputfelt på en måte React oppdager.
 *
 * Feltene er ukontrollerte, men noen skjemaer leser verdien via React-state.
 * Den innebygde value-setteren (i stedet for `input.value = ...`) gjør at
 * Reacts egen sporingslogikk ser endringen, og `input`/`change` varsler
 * lytterne som måtte henge på feltet.
 */
function setFieldValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Fyller de valgfrie kundefeltene fra Enhetsregisteret. Tomme verdier i
 * responsen rører vi ikke, slik at et påbegynt skjema ikke tømmes.
 */
function fillForm(form: HTMLFormElement, company: CompanyRecord) {
  for (const field of AUTOFILL_FIELDS) {
    const value = company[field];
    if (!value) continue;
    const input = form.querySelector<HTMLInputElement>(
      `input[name="${field}"]`,
    );
    if (!input) continue;
    setFieldValue(input, value);
  }
}

/**
 * Slår opp organisasjonsnummeret i Enhetsregisteret og fyller kundeskjemaet.
 *
 * Knappen er `type="button"` med vilje: oppslaget skal aldri sende inn
 * skjemaet. Den leser org.nummeret fra feltet i samme `<form>`, slik at
 * komponenten kan gjenbrukes både ved oppretting og redigering.
 */
export default function CompanyLookup({
  orgNumberInputName = "orgNumber",
}: {
  orgNumberInputName?: string;
}) {
  const t = useTranslations("common");
  const [state, setState] = useState<CompanyLookupState | null>(null);
  const [pending, setPending] = useState(false);

  async function handleLookup(event: MouseEvent<HTMLButtonElement>) {
    // currentTarget blir null etter første await, så skjemaet fanges her.
    const form = event.currentTarget.closest("form");
    if (!form) return;

    const orgInput = form.querySelector<HTMLInputElement>(
      `input[name="${orgNumberInputName}"]`,
    );
    const orgNumber = orgInput?.value.trim() ?? "";

    // Tomt felt trenger ingen rundtur til serveren.
    if (!orgNumber) {
      setState({ status: "invalid" });
      return;
    }

    setPending(true);
    setState(null);
    try {
      const result = await lookupCompanyAction(orgNumber);
      setState(result);
      if (result.status === "found") fillForm(form, result.company);
    } catch {
      // Nettverksfeil eller avvist action: samme melding som utilgjengelig.
      setState({ status: "unavailable" });
    } finally {
      setPending(false);
    }
  }

  const found = state?.status === "found" ? state.company : null;
  const failure = state && state.status !== "found" ? state.status : null;
  const failureIsError = failure ? ERROR_STATUSES.has(failure) : false;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={handleLookup}
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          <Icon
            name={pending ? "sync" : "search"}
            className={`h-4 w-4 shrink-0 ${pending ? "animate-spin" : ""}`}
          />
          {pending
            ? t("customers.lookup.loading")
            : t("customers.lookup.button")}
        </button>
        {/* Krediteringen skal alltid være synlig, også før et oppslag. */}
        <span className="text-[11px] font-medium text-[var(--muted,#62685f)]">
          {t("customers.lookup.source")}
        </span>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true">
        {found && (
          <div className="space-y-1.5">
            <p className="flex items-start gap-1.5 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]">
              <Icon name="check" className="mt-px h-3.5 w-3.5 shrink-0" />
              {t("customers.lookup.found")}
            </p>
            {found.bankrupt && (
              <p className="flex items-start gap-1.5 text-xs font-bold text-[var(--warning-text,#7a4f0c)]">
                <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
                {t("customers.lookup.bankrupt")}
              </p>
            )}
            {found.underLiquidation && (
              <p className="flex items-start gap-1.5 text-xs font-bold text-[var(--warning-text,#7a4f0c)]">
                <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
                {t("customers.lookup.underLiquidation")}
              </p>
            )}
          </div>
        )}

        {failure && (
          <p
            className={`flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ${
              failureIsError
                ? "border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]"
                : "border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
            }`}
          >
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            {t(FAILURE_KEYS[failure])}
          </p>
        )}
      </div>
    </div>
  );
}
