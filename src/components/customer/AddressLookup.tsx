"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { searchAddressAction } from "@/app/kunder/lookup-actions";
import type { AddressHit, AddressSearch } from "@/lib/address-search";
import Icon from "@/components/icons";
import { buttonClassName } from "@/components/ui/Button";

/**
 * Under denne lengden gir adressesøket for mange treff til å være nyttig, og
 * vi bruker ikke et serverkall på det. Samme grense som `searchAddresses`.
 */
const SEARCH_MIN_LENGTH = 3;

/** Feltene et adressevalg fyller i samme skjema. */
const POSTAL_CODE_FIELD = "postalCode";
const CITY_FIELD = "city";

/**
 * Én ekstra tilstand før kallet: «for kort». Den kan ikke uttrykkes med
 * `AddressSearch`, så den holdes utenfor unionen.
 */
type AddressState = AddressSearch | { status: "tooShort" };

/**
 * Skriver en verdi til et inputfelt på en måte React oppdager.
 *
 * Samme teknikk som `CompanyLookup` bruker: den innebygde value-setteren gjør
 * at Reacts egen sporingslogikk ser endringen, og `input`/`change` varsler
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
 * Adressesøk mot Kartverket for adressefeltet i kundeskjemaet.
 *
 * Komponenten tegner ingen adresseinput selv: den leser verdien brukeren
 * allerede har skrevet i `input[name=address]` i samme `<form>`, slik at den
 * kan gjenbrukes både ved oppretting og redigering. «Bruk» fyller gateadresse,
 * postnummer og poststed, og kommunen vises i treffet for å skille like
 * gatenavn i ulike kommuner.
 *
 * Knappen er `type="button"` med vilje: søket skal aldri sende inn skjemaet.
 */
export default function AddressLookup({
  addressInputName = "address",
}: {
  addressInputName?: string;
}) {
  const t = useTranslations("common");
  const [state, setState] = useState<AddressState | null>(null);
  const [pending, setPending] = useState(false);

  function addressInputIn(form: HTMLFormElement) {
    return form.querySelector<HTMLInputElement>(
      `input[name="${addressInputName}"]`,
    );
  }

  async function handleSearch(form: HTMLFormElement | null) {
    if (!form) return;

    const query = addressInputIn(form)?.value.trim() ?? "";
    if (query.length < SEARCH_MIN_LENGTH) {
      setState({ status: "tooShort" });
      return;
    }

    setPending(true);
    setState(null);
    try {
      setState(
        await searchAddressAction(
          query,
          // Postnummeret brukeren allerede har skrevet løfter riktig by øverst;
          // Geonorge sorterer ikke etter relevans selv.
          form.querySelector<HTMLInputElement>('input[name="postalCode"]')?.value,
        ),
      );
    } catch {
      // Nettverksfeil eller avvist action: samme melding som utilgjengelig.
      setState({ status: "unavailable" });
    } finally {
      setPending(false);
    }
  }

  /** Fyller de tre adressefeltene. Tomme verdier i treffet rører vi ikke. */
  function fillForm(form: HTMLFormElement, hit: AddressHit) {
    const address = addressInputIn(form);
    if (address && hit.text) setFieldValue(address, hit.text);

    const postalCode = form.querySelector<HTMLInputElement>(
      `input[name="${POSTAL_CODE_FIELD}"]`,
    );
    if (postalCode && hit.postalCode) setFieldValue(postalCode, hit.postalCode);

    const city = form.querySelector<HTMLInputElement>(
      `input[name="${CITY_FIELD}"]`,
    );
    if (city && hit.city) setFieldValue(city, hit.city);
  }

  function handlePick(
    event: MouseEvent<HTMLButtonElement>,
    hit: AddressHit,
  ) {
    const form = event.currentTarget.closest("form");
    if (!form) return;

    fillForm(form, hit);
    setState(null);
  }

  const hits =
    state?.status === "ok" && state.hits.length > 0 ? state.hits : null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={(event) =>
            void handleSearch(event.currentTarget.closest("form"))
          }
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          <Icon
            name={pending ? "sync" : "search"}
            className={`h-4 w-4 shrink-0 ${pending ? "animate-spin" : ""}`}
          />
          {t("customers.address.button")}
        </button>
        <span className="text-[11px] font-medium text-[var(--muted,#62685f)]">
          {t("customers.address.placeholder")}
        </span>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true">
        {state?.status === "tooShort" && (
          <p className="text-xs font-bold text-[var(--muted,#62685f)]">
            {t("customers.address.tooShort")}
          </p>
        )}

        {state?.status === "unavailable" && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            {t("customers.address.unavailable")}
          </p>
        )}

        {state?.status === "ok" && !hits && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
            <Icon name="search" className="mt-px h-3.5 w-3.5 shrink-0" />
            {t("customers.address.empty")}
          </p>
        )}

        {hits && (
          <ul className="space-y-1.5">
            {hits.map((hit, index) => {
              const place = [hit.postalCode, hit.city].filter(Boolean).join(" ");
              return (
                <li
                  key={`${hit.text}-${hit.postalCode ?? ""}-${index}`}
                  className="flex items-start justify-between gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-bold text-[var(--ink,#101310)]">
                      {hit.text}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--muted,#62685f)]">
                      {[place, hit.municipality].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => handlePick(event, hit)}
                    className={`${buttonClassName({
                      variant: "secondary",
                      size: "sm",
                    })} shrink-0`}
                  >
                    {t("customers.address.pick")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
