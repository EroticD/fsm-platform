"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { controlClassName } from "@/components/ui/controlStyles";

export type CustomerOption = {
  id: string;
  name: string;
  city?: string | null;
  customerNumber?: string | null;
};

export type ContactOption = {
  id: string;
  name: string;
  role?: string | null;
  customerId: string;
};

type CustomersResponse = { customers?: CustomerOption[]; error?: string };
type ContactsResponse = { contacts?: ContactOption[]; error?: string };

/**
 * Søkbart kundevalg med ARIA-combobox og tastaturnavigasjon.
 *
 * Kundelisten kommer fra serveren mens man skriver, så registeret er ikke
 * begrenset til de første 100 kundene. Kontaktene hentes for den valgte
 * kunden, og valget sendes videre som skjulte felt i skjemaet.
 */
export default function CustomerSelect({
  customers = [],
  selectedCustomer = null,
  selectedContactId = null,
  contacts = [],
  optional = false,
  hideLabel = false,
  persistenceKey,
  restoreSelection = true,
}: {
  /** Et lite startutvalg, slik at listen har innhold før man søker. */
  customers?: CustomerOption[];
  selectedCustomer?: CustomerOption | null;
  selectedContactId?: string | null;
  /** Kontakter for den valgte kunden, hvis de allerede er kjent. */
  contacts?: ContactOption[];
  optional?: boolean;
  /** Skjul den innebygde etiketten når skjemaet har sin egen. */
  hideLabel?: boolean;
  /**
   * Nøkkel for å huske valgt kunde over en redirect etter valideringsfeil.
   * Uten denne nullstilles visningen selv om skjemaet fortsatt har customerId.
   */
  persistenceKey?: string;
  /** Bare gjenopprett et lagret valg når skjemaet vises etter en feil. */
  restoreSelection?: boolean;
}) {
  const t = useTranslations("common");
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerOption[]>([]);
  const [selected, setSelected] = useState<CustomerOption | null>(
    selectedCustomer,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>(() =>
    contacts.filter((contact) => contact.customerId === selectedCustomer?.id),
  );
  const [contactsLoading, setContactsLoading] = useState(false);
  const requestRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectionStorageKey = persistenceKey
    ? `${persistenceKey}:selected-customer`
    : null;

  // Gjenopprett visningen av valgt kunde etter en feilredirect. Selve
  // customerId ligger allerede i skjemaet, men uten dette ville panelet sett
  // tomt ut selv om oppdraget faktisk opprettes på riktig kunde.
  useEffect(() => {
    if (!selectionStorageKey) return;

    let restored: CustomerOption | null = null;
    try {
      if (!restoreSelection) {
        sessionStorage.removeItem(selectionStorageKey);
      } else if (!selectedCustomer) {
        const saved = sessionStorage.getItem(selectionStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as CustomerOption;
          if (parsed?.id && parsed?.name) restored = parsed;
        }
      }
    } catch {
      // Ugyldig lagring skal ikke hindre kundesøket.
    }

    if (!restored) return;
    const customerToRestore = restored;
    // Utsatt til etter første render, så server- og klientmarkup er like.
    const timer = window.setTimeout(() => setSelected(customerToRestore), 0);
    return () => window.clearTimeout(timer);
    // Bare ved første visning; senere valg styres av komponenten selv.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = search.trim();
  // Uten søketekst vises startutvalget med den valgte kunden først.
  const options = useMemo(() => {
    if (query) {
      return selected && !searchResults.some((c) => c.id === selected.id)
        ? [selected, ...searchResults]
        : searchResults;
    }
    return selected
      ? [selected, ...customers.filter((c) => c.id !== selected.id)]
      : customers;
  }, [query, searchResults, selected, customers]);

  // Søk mot serveren når brukeren skriver. Selve tilstandsoppdateringene skjer
  // i den asynkrone tilbakemeldingen, ikke synkront i effekten.
  useEffect(() => {
    if (!query) return;

    const request = ++requestRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const response = await fetch(
          `/api/kunder/sok?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("sok-feilet");
        const data = (await response.json()) as CustomersResponse;
        if (request !== requestRef.current) return;
        const found = data.customers ?? [];
        setSearchResults(found);
        setActiveIndex(found.length > 0 ? 0 : -1);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (request !== requestRef.current) return;
        setSearchResults([]);
        setLoadError(true);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  // Lukk listen når man klikker utenfor.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  // Hent kontaktene til valgt kunde. Serveren er autoritativ, men kjente
  // kontakter fra sidens startutvalg vises umiddelbart.
  useEffect(() => {
    if (!selected) return;
    let active = true;
    fetch(`/api/kunder/kontakter?customerId=${encodeURIComponent(selected.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("kontakt-feilet");
        return (await response.json()) as ContactsResponse;
      })
      .then((data) => {
        if (!active) return;
        setContactOptions(data.contacts ?? []);
      })
      .catch(() => {
        if (!active) return;
        setContactOptions(
          contacts.filter((contact) => contact.customerId === selected.id),
        );
      })
      .finally(() => {
        if (active) setContactsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, contacts]);

  const choose = (customer: CustomerOption) => {
    setSelected(customer);
    setSearch("");
    setIsOpen(false);
    setActiveIndex(-1);
    setContactsLoading(true);
    if (selectionStorageKey) {
      try {
        sessionStorage.setItem(selectionStorageKey, JSON.stringify(customer));
      } catch {
        // Lagring kan være utilgjengelig; valget fungerer fortsatt i skjemaet.
      }
    }
    // Vis kjente kontakter med en gang, og la effekten erstatte dem med
    // det serveren returnerer.
    setContactOptions(
      contacts.filter((contact) => contact.customerId === customer.id),
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      setActiveIndex((index) =>
        options.length === 0 ? -1 : (index + 1) % options.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      setActiveIndex((index) =>
        options.length === 0
          ? -1
          : index <= 0
            ? options.length - 1
            : index - 1,
      );
    } else if (event.key === "Enter") {
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        choose(options[activeIndex]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const visibleOptions = useMemo(() => options, [options]);

  return (
    <div className="relative" ref={wrapperRef}>
      {!hideLabel && (
        <label
          htmlFor={`${listboxId}-search`}
          className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
        >
          {optional
            ? t("orders.customerSelect.labelOptional")
            : t("orders.customerSelect.label")}
        </label>
      )}

      <input type="hidden" name="customerId" value={selected?.id ?? ""} />

      {selected && (
        <div className="mb-2 flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--ink,#101310)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
            />
            <span className="break-words">
              {selected.name}
              {selected.city ? ` (${selected.city})` : ""}
              {selected.customerNumber
                ? ` · ${t("orders.customerSelect.customerNumber", {
                    number: selected.customerNumber,
                  })}`
                : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setSearch("");
              setSearchResults([]);
              setContactOptions([]);
              setContactsLoading(false);
              setIsOpen(true);
              if (selectionStorageKey) {
                try {
                  sessionStorage.removeItem(selectionStorageKey);
                } catch {
                  // Ignorer utilgjengelig lagring.
                }
              }
            }}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
          >
            {t("orders.customerSelect.change")}
          </button>
        </div>
      )}

      <input
        id={`${listboxId}-search`}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        aria-label={
          optional
            ? t("orders.customerSelect.labelOptional")
            : t("orders.customerSelect.label")
        }
        autoComplete="off"
        placeholder={
          selected
            ? t("orders.customerSelect.searchForAnother")
            : t("orders.customerSelect.searchPlaceholder")
        }
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        className={controlClassName("min-h-11")}
      />

      {isOpen && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2 shadow-[0_18px_40px_-18px_rgba(16,19,16,0.35)]">
          {loading && (
            <p className="px-2 py-1 text-xs text-[var(--muted,#62685f)]" role="status">
              {t("orders.customerSelect.searching")}
            </p>
          )}
          {loadError && (
            <p className="px-2 py-1 text-xs font-bold text-[var(--risk-text,#b42318)]" role="alert">
              {t("orders.customerSelect.searchFailed")}
            </p>
          )}
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("orders.customerSelect.listLabel")}
            className="max-h-56 space-y-1 overflow-y-auto"
          >
            {visibleOptions.length === 0 && !loading && !loadError ? (
              <li className="px-2 py-3 text-center text-xs text-[var(--muted,#62685f)]">
                {t("orders.customerSelect.noMatch")}
              </li>
            ) : (
              visibleOptions.map((customer, index) => (
                <li
                  key={customer.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected?.id === customer.id}
                  onMouseDown={(event) => {
                    // Hindre at input mister fokus før valget registreres.
                    event.preventDefault();
                    choose(customer);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-sm ${
                    index === activeIndex
                      ? "bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                      : "text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
                  }`}
                >
                  <span className="font-bold">{customer.name}</span>
                  <span className="shrink-0 text-xs text-[var(--muted,#62685f)]">
                    {customer.city || ""}
                    {customer.customerNumber
                      ? ` (${t("orders.customerSelect.customerNumber", {
                          number: customer.customerNumber,
                        })})`
                      : ""}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {customers.length === 0 && !selected && (
        <p className="mt-1 text-xs font-bold text-[var(--risk-text,#b42318)]">
          {t("orders.customerSelect.noCustomers")}
        </p>
      )}

      {selected && (
        <div className="mt-3">
          <label
            htmlFor={`${listboxId}-contact`}
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("orders.customerSelect.contactLabel")}
          </label>
          {contactsLoading ? (
            <p className="text-xs text-[var(--muted,#62685f)]" role="status">
              {t("orders.customerSelect.loadingContacts")}
            </p>
          ) : contactOptions.length === 0 ? (
            <p className="text-xs italic text-[var(--muted,#62685f)]">
              {t("orders.customerSelect.noContacts")}
            </p>
          ) : (
            <select
              id={`${listboxId}-contact`}
              name="contactId"
              defaultValue={
                contactOptions.some((c) => c.id === selectedContactId)
                  ? (selectedContactId ?? "")
                  : ""
              }
              className={controlClassName("min-h-11")}
            >
              <option value="">{t("orders.customerSelect.noContactOption")}</option>
              {contactOptions.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.role ? ` (${contact.role})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
