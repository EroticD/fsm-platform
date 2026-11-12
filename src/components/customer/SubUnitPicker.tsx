"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { listSubUnitsAction } from "@/app/kunder/lookup-actions";
import type { SubUnit, SubUnitList } from "@/lib/brreg";
import Icon from "@/components/icons";
import { buttonClassName } from "@/components/ui/Button";

/**
 * Feltene i steds-skjemaet som fylles fra en underenhet. Rekkefølgen er også
 * rekkefølgen vi skriver i, slik at navnet alltid lander før adressen.
 */
const AUTOFILL_FIELDS = ["name", "address", "postalCode", "city"] as const;

/**
 * Skriver en verdi til et inputfelt på en måte React oppdager.
 *
 * Samme fremgangsmåte som `CompanyLookup`: den innebygde value-setteren gjør at
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
 * Fyller stedsfeltene fra en underenhet. Tomme verdier i registeret rører vi
 * ikke, slik at et påbegynt skjema ikke tømmes.
 */
function fillSiteForm(form: HTMLFormElement, unit: SubUnit) {
  for (const field of AUTOFILL_FIELDS) {
    const value = unit[field];
    if (!value) continue;
    const input = form.querySelector<HTMLInputElement>(
      `input[name="${field}"]`,
    );
    if (!input) continue;
    setFieldValue(input, value);
  }
}

/**
 * Lister underenhetene til kundens hovedenhet og lar brukeren bruke adressen
 * deres i «nytt sted»-skjemaet.
 *
 * Oppslaget er et AJAX-kall mot Enhetsregisteret, ikke en skjemainnsending:
 * knappen er `type="button"` slik at skjemaet aldri sendes inn, og radenes
 * «bruk»-knapper skriver til feltene i nærmeste `<form>`.
 */
export default function SubUnitPicker({ orgNumber }: { orgNumber: string }) {
  const t = useTranslations("common");
  const [result, setResult] = useState<SubUnitList | null>(null);
  const [pending, setPending] = useState(false);

  const normalized = orgNumber.trim();

  async function handleFetch() {
    // Uten org.nummer finnes det ingen hovedenhet å liste underenheter for.
    if (!normalized) {
      setResult({ status: "unavailable" });
      return;
    }

    setPending(true);
    setResult(null);
    try {
      setResult(await listSubUnitsAction(normalized));
    } catch {
      // Nettverksfeil eller avvist action: samme melding som utilgjengelig.
      setResult({ status: "unavailable" });
    } finally {
      setPending(false);
    }
  }

  function handlePick(event: MouseEvent<HTMLButtonElement>, unit: SubUnit) {
    // currentTarget blir null etter en await, men her trengs ingen venting.
    const form = event.currentTarget.closest("form");
    if (!form) return;
    fillSiteForm(form, unit);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={handleFetch}
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          <Icon
            name={pending ? "sync" : "building"}
            className={`h-4 w-4 shrink-0 ${pending ? "animate-spin" : ""}`}
          />
          {pending
            ? t("customers.lookup.loading")
            : t("customers.subunits.button")}
        </button>
        <span className="text-[11px] font-medium text-[var(--muted,#62685f)]">
          {t("customers.lookup.source")}
        </span>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true">
        {result?.status === "ok" && (
          <div className="space-y-1.5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
              {t("customers.subunits.title")}
            </p>
            {result.units.length === 0 ? (
              <p className="text-xs font-bold text-[var(--muted,#62685f)]">
                {t("customers.subunits.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--line,#dedcd1)]">
                {result.units.map((unit) => {
                  const addressLine = [
                    unit.address,
                    unit.postalCode,
                    unit.city,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li
                      key={unit.orgNumber}
                      className="flex flex-wrap items-start justify-between gap-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[var(--ink,#101310)]">
                          {unit.name}
                        </p>
                        <p className="text-xs text-[var(--muted,#62685f)]">
                          {t("customers.detail.orgNumber", {
                            number: unit.orgNumber,
                          })}
                        </p>
                        <p className="text-xs text-[var(--muted,#62685f)]">
                          {addressLine || t("customers.sites.noAddress")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => handlePick(event, unit)}
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                      >
                        {t("customers.subunits.pick")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {result?.status === "not_found" && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            {t("customers.subunits.empty")}
          </p>
        )}

        {result?.status === "unavailable" && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            {t("customers.subunits.unavailable")}
          </p>
        )}
      </div>
    </div>
  );
}
