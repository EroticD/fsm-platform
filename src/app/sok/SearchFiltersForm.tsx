"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { SearchFilters } from "@/lib/search-filters";
import { SEARCH_GROUP_KINDS } from "@/lib/search-filters";
import { buildSearchHref } from "./search-params";
import {
  GROUP_KEYS,
  SEARCH_HMS_TYPE_OPTIONS,
  SEARCH_STATUS_OPTIONS,
} from "./labels";

type Option = { id: string; name: string };

type FilterFormProps = {
  query: string;
  filters: SearchFilters;
  customers: Option[];
  technicians: Option[];
  showCustomers: boolean;
  showTechnicians: boolean;
  idPrefix: string;
  onApply?: () => void;
};

function countActiveFilters(filters: SearchFilters): number {
  const singleValues = [
    filters.status,
    filters.customer,
    filters.technician,
    filters.dateFrom,
    filters.dateTo,
    filters.tag,
    filters.hmsType,
  ].filter(Boolean).length;

  return (filters.types?.length ?? 0) + singleValues;
}

function FilterForm({
  query,
  filters,
  customers,
  technicians,
  showCustomers,
  showTechnicians,
  idPrefix,
  onApply,
}: FilterFormProps) {
  const t = useTranslations("common");
  const tl = t as unknown as (key: string) => string;
  const selectedTypes = new Set(filters.types ?? []);

  const titleId = `${idPrefix}-search-filters-title`;
  const statusId = `${idPrefix}-search-filter-status`;
  const customerId = `${idPrefix}-search-filter-customer`;
  const technicianId = `${idPrefix}-search-filter-technician`;
  const dateFromId = `${idPrefix}-search-filter-date-from`;
  const dateToId = `${idPrefix}-search-filter-date-to`;
  const tagId = `${idPrefix}-search-filter-tag`;
  const hmsTypeId = `${idPrefix}-search-filter-hms-type`;

  return (
    <form
      action="/sok"
      method="get"
      aria-labelledby={titleId}
      onSubmit={() => onApply?.()}
      className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <input type="hidden" name="q" value={query} />

      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-black text-gray-900">
          {t("components.search.filters.title")}
        </h2>
        <a
          href={buildSearchHref({ q: query, filters: {} })}
          className="text-xs font-bold text-blue-700 hover:underline"
        >
          {t("components.search.filters.clear")}
        </a>
      </div>

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide text-gray-500">
          {t("components.search.filters.types")}
        </legend>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
          {SEARCH_GROUP_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                name="types"
                value={kind}
                defaultChecked={selectedTypes.has(kind)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
              />
              <span>{tl(GROUP_KEYS[kind] ?? kind)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor={statusId}
          className="text-xs font-bold uppercase tracking-wide text-gray-500"
        >
          {t("components.search.filters.status")}
        </label>
        <select
          id={statusId}
          name="status"
          defaultValue={filters.status ?? ""}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        >
          <option value="">{t("components.search.filters.allStatuses")}</option>
          {SEARCH_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {tl(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {showCustomers && (
        <div>
          <label
            htmlFor={customerId}
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.customer")}
          </label>
          <select
            id={customerId}
            name="customer"
            defaultValue={filters.customer ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            <option value="">{t("components.search.filters.allCustomers")}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showTechnicians && technicians.length > 0 && (
        <div>
          <label
            htmlFor={technicianId}
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.technician")}
          </label>
          <select
            id={technicianId}
            name="technician"
            defaultValue={filters.technician ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            <option value="">{t("components.search.filters.allTechnicians")}</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={dateFromId}
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.dateFrom")}
          </label>
          <input
            id={dateFromId}
            type="date"
            name="dateFrom"
            defaultValue={filters.dateFrom ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
        <div>
          <label
            htmlFor={dateToId}
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.dateTo")}
          </label>
          <input
            id={dateToId}
            type="date"
            name="dateTo"
            defaultValue={filters.dateTo ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={tagId}
          className="text-xs font-bold uppercase tracking-wide text-gray-500"
        >
          {t("components.search.filters.tag")}
        </label>
        <input
          id={tagId}
          type="text"
          name="tag"
          maxLength={64}
          defaultValue={filters.tag ?? ""}
          placeholder={t("components.search.filters.tagPlaceholder")}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </div>

      <div>
        <label
          htmlFor={hmsTypeId}
          className="text-xs font-bold uppercase tracking-wide text-gray-500"
        >
          {t("components.search.filters.hmsType")}
        </label>
        <select
          id={hmsTypeId}
          name="hmsType"
          defaultValue={filters.hmsType ?? ""}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        >
          <option value="">{t("components.search.filters.allHmsTypes")}</option>
          {SEARCH_HMS_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {tl(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
      >
        {t("components.search.filters.apply")}
      </button>
    </form>
  );
}

function MobileFilters({
  idPrefix,
  children,
  ...formProps
}: Omit<FilterFormProps, "idPrefix" | "onApply"> & {
  idPrefix: string;
  children?: ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerId = `${idPrefix}-mobile-filter-trigger`;
  const panelId = `${idPrefix}-mobile-filter-panel`;
  const activeCount = countActiveFilters(formProps.filters);

  // Låser sidescrollen mens panelet er åpent, og flytter fokus inn i panelet.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus();
    });

    // Om vinduet blir bredt nok til desktop-layouten, skal panelet lukkes slik
    // at body-scrollen ikke blir stående låst bak den skjulte sidebaren.
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktopQuery.addEventListener("change", closeOnDesktop);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      desktopQuery.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first || document.activeElement === panel) {
        event.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="sticky top-0 z-30 lg:hidden">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden>⚙️</span>
          <span className="truncate">
            {t("components.search.filters.mobileTrigger", { count: activeCount })}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-xs text-gray-400">
          ▼
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden
            onClick={close}
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-[1px]"
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={t("components.search.filters.panelLabel")}
            tabIndex={-1}
            onKeyDown={trapFocus}
            className="absolute inset-x-0 top-0 flex max-h-[85vh] flex-col overflow-hidden rounded-b-2xl bg-gray-50 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
              <h2 className="text-base font-black text-gray-900">
                {t("components.search.filters.title")}
              </h2>
              <button
                type="button"
                data-autofocus
                onClick={close}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
              >
                {t("components.search.filters.showResults")}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              <FilterForm
                {...formProps}
                idPrefix={`${idPrefix}-panel`}
                onApply={() => window.setTimeout(close, 0)}
              />
              {children && <div className="mt-4 space-y-4">{children}</div>}
            </div>

            <div className="border-t border-gray-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                onClick={close}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
              >
                {t("components.search.filters.showResults")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tilgjengelig GET-skjema for søkefiltre.
 *
 * Skjemaet er en vanlig GET-forespørsel, så resultatet kan bokmerkes, deles og
 * brukes uten JavaScript. Alle verdier valideres på nytt i `parseSearchFilters`
 * og backend legger alltid på brukerens tilgangsScope.
 *
 * På mobil (`variant="mobile"`) vises skjemaet i et overlegg som ikke dytter
 * resultatene ned. På desktop rendres det uendret i sidebaren.
 */
export default function SearchFiltersForm({
  variant = "sidebar",
  children,
  ...formProps
}: Omit<FilterFormProps, "idPrefix" | "onApply"> & {
  variant?: "sidebar" | "mobile";
  children?: ReactNode;
}) {
  const baseId = useId().replace(/:/g, "");

  if (variant === "mobile") {
    return (
      <MobileFilters {...formProps} idPrefix={baseId}>
        {children}
      </MobileFilters>
    );
  }

  return <FilterForm {...formProps} idPrefix={baseId} />;
}
