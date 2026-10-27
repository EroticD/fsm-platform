"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

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
          className="block text-sm font-bold text-gray-700 mb-1"
        >
          {optional
            ? t("orders.customerSelect.labelOptional")
            : t("orders.customerSelect.label")}
        </label>
      )}

      <input type="hidden" name="customerId" value={selected?.id ?? ""} />

      {selected && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-sm font-bold text-blue-950">
            {selected.name}
            {selected.city ? ` (${selected.city})` : ""}
            {selected.customerNumber
              ? ` · ${t("orders.customerSelect.customerNumber", {
                  number: selected.customerNumber,
                })}`
              : ""}
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
            }}
            className="min-h-9 shrink-0 rounded-lg border border-blue-300 bg-white px-3 text-xs font-bold text-blue-800 hover:bg-blue-100"
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
        className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />

      {isOpen && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-gray-300 bg-white p-2 shadow-lg">
          {loading && (
            <p className="px-2 py-1 text-xs text-gray-500" role="status">
              {t("orders.customerSelect.searching")}
            </p>
          )}
          {loadError && (
            <p className="px-2 py-1 text-xs font-bold text-red-700" role="alert">
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
              <li className="px-2 py-3 text-center text-xs text-gray-500">
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
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm ${
                    index === activeIndex
                      ? "bg-blue-100 text-blue-950"
                      : "text-gray-800 hover:bg-blue-50"
                  }`}
                >
                  <span className="font-bold">{customer.name}</span>
                  <span className="shrink-0 text-xs text-gray-600">
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
        <p className="mt-1 text-xs text-red-600">
          {t("orders.customerSelect.noCustomers")}
        </p>
      )}

      {selected && (
        <div className="mt-3">
          <label
            htmlFor={`${listboxId}-contact`}
            className="block text-sm font-bold text-gray-700 mb-1"
          >
            {t("orders.customerSelect.contactLabel")}
          </label>
          {contactsLoading ? (
            <p className="text-xs text-gray-500" role="status">
              {t("orders.customerSelect.loadingContacts")}
            </p>
          ) : contactOptions.length === 0 ? (
            <p className="text-xs italic text-gray-500">
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
              className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900 shadow-sm outline-none focus:border-blue-600"
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
