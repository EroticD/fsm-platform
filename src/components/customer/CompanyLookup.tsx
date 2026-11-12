"use client";

import { useState } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { lookupCompanyAction } from "@/app/kunder/actions";
import type { CompanyLookupState } from "@/app/kunder/actions";
import { searchCompanyByNameAction } from "@/app/kunder/lookup-actions";
import type { CompanySearch, CompanySummary } from "@/lib/brreg";
import {
  isValidOrgNumber,
  normalizeOrgNumber,
  type CompanyRecord,
} from "@/lib/brreg";
import Icon from "@/components/icons";
import { buttonClassName } from "@/components/ui/Button";
import { CUSTOMER_CONTROL } from "./customerStyles";

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
 * Under denne lengden er navnesøket for bredt til å gi nyttige treff, og vi
 * bruker ikke et serverkall på det. Samme grense som `searchCompaniesByName`.
 */
const SEARCH_MIN_LENGTH = 2;

/**
 * Navnesøket har én ekstra tilstand før kallet: «for kort». Den kan ikke
 * uttrykkes med `CompanySearch`, så den holdes utenfor unionen.
 */
type NameSearchState = CompanySearch | { status: "tooShort" };

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
 *
 * Over knappen ligger et navnesøk mot samme register. Et treff derfra skriver
 * org.nummeret inn i feltet og kjører nøyaktig samme oppslag som knappen, slik
 * at begge veier fyller skjemaet likt.
 */
export default function CompanyLookup({
  orgNumberInputName = "orgNumber",
}: {
  orgNumberInputName?: string;
}) {
  const t = useTranslations("common");
  const [state, setState] = useState<CompanyLookupState | null>(null);
  const [pending, setPending] = useState(false);

  const [nameQuery, setNameQuery] = useState("");
  const [searchState, setSearchState] = useState<NameSearchState | null>(null);
  const [searchPending, setSearchPending] = useState(false);

  function orgInputIn(form: HTMLFormElement) {
    return form.querySelector<HTMLInputElement>(
      `input[name="${orgNumberInputName}"]`,
    );
  }

  /**
   * Felles oppslagsvei for knappen og «Bruk» i navnesøket.
   *
   * Nummeret normaliseres og mod11-valideres før kallet, så et tastetrykk-feil
   * ikke koster en runde til Brønnøysund. Den normaliserte formen skrives
   * tilbake til feltet, slik at skjemaet lagres med rene ni sifre.
   */
  async function runLookup(form: HTMLFormElement, rawValue: string) {
    const digits = normalizeOrgNumber(rawValue);
    if (!digits || !isValidOrgNumber(digits)) {
      setState({ status: "invalid" });
      return;
    }

    const orgInput = orgInputIn(form);
    if (orgInput && orgInput.value.trim() !== digits) {
      setFieldValue(orgInput, digits);
    }

    setPending(true);
    setState(null);
    try {
      const result = await lookupCompanyAction(digits);
      setState(result);
      if (result.status === "found") fillForm(form, result.company);
    } catch {
      // Nettverksfeil eller avvist action: samme melding som utilgjengelig.
      setState({ status: "unavailable" });
    } finally {
      setPending(false);
    }
  }

  async function handleLookup(event: MouseEvent<HTMLButtonElement>) {
    // currentTarget blir null etter første await, så skjemaet fanges her.
    const form = event.currentTarget.closest("form");
    if (!form) return;

    await runLookup(form, orgInputIn(form)?.value ?? "");
  }

  async function handleSearch(form: HTMLFormElement | null) {
    if (!form) return;
    const query = nameQuery.trim();

    // For kort søk gir ingen treff uansett; vis hjelpeteksten uten kall.
    if (query.length < SEARCH_MIN_LENGTH) {
      setSearchState({ status: "tooShort" });
      return;
    }

    setSearchPending(true);
    setSearchState(null);
    try {
      setSearchState(await searchCompanyByNameAction(query));
    } catch {
      setSearchState({ status: "unavailable" });
    } finally {
      setSearchPending(false);
    }
  }

  async function handlePick(
    event: MouseEvent<HTMLButtonElement>,
    company: CompanySummary,
  ) {
    const form = event.currentTarget.closest("form");
    if (!form) return;

    const orgInput = orgInputIn(form);
    if (orgInput) setFieldValue(orgInput, company.orgNumber);

    await runLookup(form, company.orgNumber);
  }

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setNameQuery(value);
    const trimmed = value.trim();
    setSearchState((previous) => {
      if (trimmed.length === 0) return null;
      // Under grensen: vis hjelpeteksten med en gang, uten serverkall.
      if (trimmed.length < SEARCH_MIN_LENGTH) return { status: "tooShort" };
      // Treffene gjaldt forrige søk; de skal ikke kunne velges etter en endring.
      return previous && previous.status !== "tooShort" ? null : previous;
    });
  }

  function handleQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter skal søke på navn, ikke sende inn kundeskjemaet.
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleSearch(event.currentTarget.form);
  }

  const found = state?.status === "found" ? state.company : null;
  const failure = state && state.status !== "found" ? state.status : null;
  const failureIsError = failure ? ERROR_STATUSES.has(failure) : false;

  const searchEmpty =
    searchState?.status === "ok" && searchState.companies.length === 0;
  const searchHits =
    searchState?.status === "ok" && searchState.companies.length > 0
      ? searchState.companies
      : null;

  return (
    <div className="space-y-2">
      {/* Navnesøk: finn firmaet først, og la «Bruk» fylle org.nummeret. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[11rem] flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted,#62685f)]"
            />
            <input
              type="search"
              value={nameQuery}
              onChange={handleQueryChange}
              onKeyDown={handleQueryKeyDown}
              aria-label={t("customers.lookup.searchPlaceholder")}
              placeholder={t("customers.lookup.searchPlaceholder")}
              className={`${CUSTOMER_CONTROL} py-1.5 pl-9 text-sm`}
            />
          </div>
          <button
            type="button"
            onClick={(event) =>
              void handleSearch(event.currentTarget.closest("form"))
            }
            disabled={searchPending}
            aria-busy={searchPending || undefined}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon
              name={searchPending ? "sync" : "search"}
              className={`h-4 w-4 shrink-0 ${searchPending ? "animate-spin" : ""}`}
            />
            {t("customers.lookup.searchButton")}
          </button>
        </div>

        <div role="status" aria-live="polite" aria-atomic="true">
          {searchState?.status === "tooShort" && (
            <p className="text-xs font-bold text-[var(--muted,#62685f)]">
              {t("customers.lookup.searchTooShort")}
            </p>
          )}

          {searchState?.status === "unavailable" && (
            <p className="flex items-start gap-1.5 rounded-xl border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
              <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
              {t("customers.lookup.searchUnavailable")}
            </p>
          )}

          {searchEmpty && (
            <p className="flex items-start gap-1.5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
              <Icon name="search" className="mt-px h-3.5 w-3.5 shrink-0" />
              {t("customers.lookup.searchEmpty")}
            </p>
          )}

          {searchHits && (
            <ul className="space-y-1.5">
              {searchHits.map((company) => (
                <li
                  key={company.orgNumber}
                  className="flex items-start justify-between gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-bold text-[var(--ink,#101310)]">
                      {company.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--muted,#62685f)]">
                      {[
                        company.orgNumber,
                        company.organisationForm,
                        company.city,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {(company.bankrupt || company.underLiquidation) && (
                      <span className="mt-0.5 flex items-start gap-1 text-[11px] font-bold text-[var(--warning-text,#7a4f0c)]">
                        <Icon name="alert" className="mt-px h-3 w-3 shrink-0" />
                        {company.bankrupt
                          ? t("customers.lookup.bankrupt")
                          : t("customers.lookup.underLiquidation")}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => void handlePick(event, company)}
                    disabled={pending}
                    className={`${buttonClassName({
                      variant: "secondary",
                      size: "sm",
                    })} shrink-0`}
                  >
                    {t("customers.lookup.pick")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

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
