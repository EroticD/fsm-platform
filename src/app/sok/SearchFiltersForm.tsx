"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
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

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const LEGEND =
  "text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";

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
  formRef,
}: FilterFormProps & { formRef?: RefObject<HTMLFormElement | null> }) {
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
      ref={formRef}
      action="/sok"
      method="get"
      aria-labelledby={titleId}
      onSubmit={() => onApply?.()}
      className="office-card space-y-5 p-4 sm:p-5"
    >
      <input type="hidden" name="q" value={query} />

      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("components.search.filters.title")}
        </h2>
        <a
          href={buildSearchHref({ q: query, filters: {} })}
          className="text-xs font-bold text-[var(--ink,#101310)] underline-offset-2 hover:underline"
        >
          {t("components.search.filters.clear")}
        </a>
      </div>

      <fieldset>
        <legend className={LEGEND}>
          {t("components.search.filters.types")}
        </legend>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
          {SEARCH_GROUP_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
            >
              <input
                type="checkbox"
                name="types"
                value={kind}
                defaultChecked={selectedTypes.has(kind)}
                className="h-4 w-4 rounded accent-[var(--ink,#101310)]"
              />
              <span>{tl(GROUP_KEYS[kind] ?? kind)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor={statusId}
          className={LEGEND}
        >
          {t("components.search.filters.status")}
        </label>
        <select
          id={statusId}
          name="status"
          defaultValue={filters.status ?? ""}
          className={`${FIELD} mt-1`}
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
            className={LEGEND}
          >
            {t("components.search.filters.customer")}
          </label>
          <select
            id={customerId}
            name="customer"
            defaultValue={filters.customer ?? ""}
            className={`${FIELD} mt-1`}
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
            className={LEGEND}
          >
            {t("components.search.filters.technician")}
          </label>
          <select
            id={technicianId}
            name="technician"
            defaultValue={filters.technician ?? ""}
            className={`${FIELD} mt-1`}
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
            className={LEGEND}
          >
            {t("components.search.filters.dateFrom")}
          </label>
          <input
            id={dateFromId}
            type="date"
            name="dateFrom"
            defaultValue={filters.dateFrom ?? ""}
            className={`${FIELD} mt-1`}
          />
        </div>
        <div>
          <label
            htmlFor={dateToId}
            className={LEGEND}
          >
            {t("components.search.filters.dateTo")}
          </label>
          <input
            id={dateToId}
            type="date"
            name="dateTo"
            defaultValue={filters.dateTo ?? ""}
            className={`${FIELD} mt-1`}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={tagId}
          className={LEGEND}
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
          className={`${FIELD} mt-1`}
        />
      </div>

      <div>
        <label
          htmlFor={hmsTypeId}
          className={LEGEND}
        >
          {t("components.search.filters.hmsType")}
        </label>
        <select
          id={hmsTypeId}
          name="hmsType"
          defaultValue={filters.hmsType ?? ""}
          className={`${FIELD} mt-1`}
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
        className={`${SIGNAL_BUTTON} w-full`}
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
  const formRef = useRef<HTMLFormElement>(null);
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

  // Header- og footer-knappen står utenfor selve skjemaet, men skal bruke de
  // avkryssede filtrene. requestSubmit validerer og sender skjemaet på samme
  // måte som den innebygde «Bruke filtre»-knappen.
  function applyFilters() {
    formRef.current?.requestSubmit();
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
        className="office-card flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold text-[var(--ink,#101310)] transition hover:border-[#bdb3a0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="filter" className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {t("components.search.filters.mobileTrigger", { count: activeCount })}
          </span>
        </span>
        <Icon
          name="chevronDown"
          className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)]"
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden
            onClick={close}
            className="absolute inset-0 bg-[var(--ink,#101310)]/50 backdrop-blur-[1px]"
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={t("components.search.filters.panelLabel")}
            tabIndex={-1}
            onKeyDown={trapFocus}
            className="absolute inset-x-0 top-0 flex max-h-[85vh] flex-col overflow-hidden rounded-b-card border-b border-[var(--line,#dedcd1)] bg-[var(--canvas,#f4f5f2)] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-3">
              <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
                {t("components.search.filters.title")}
              </h2>
              <button
                type="button"
                data-autofocus
                onClick={applyFilters}
                className={SIGNAL_BUTTON}
              >
                {t("components.search.filters.showResults")}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              <FilterForm
                {...formProps}
                idPrefix={`${idPrefix}-panel`}
                formRef={formRef}
                onApply={() => window.setTimeout(close, 0)}
              />
              {children && <div className="mt-4 space-y-4">{children}</div>}
            </div>

            <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                onClick={applyFilters}
                className={`${SIGNAL_BUTTON} w-full`}
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
