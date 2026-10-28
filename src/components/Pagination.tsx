import Link from "next/link";

export type PaginationLabels = {
  label: string;
  first: string;
  previous: string;
  next: string;
  last: string;
  stale: string;
  page: (page: number, totalPages: number) => string;
};

type Translate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** Klemmer et sidetall til en kjent sidebredde. */
export function clampPage(page: number, totalPages: number): number {
  const total = Math.max(1, Math.floor(totalPages) || 1);
  const current = Math.floor(page);
  if (!Number.isFinite(current)) return 1;
  return Math.min(Math.max(1, current), total);
}

/**
 * Henter de felles etikettene. Komponenten er bevisst uten `"use client"`, slik
 * at den kan brukes både fra serverkomponenter og fra klientkomponenter som
 * dokumentutforskeren. `hrefFor` bygges derfor i samme miljø som komponenten.
 */
export function paginationLabels(t: Translate): PaginationLabels {
  return {
    label: t("components.pagination.label"),
    first: t("components.pagination.first"),
    previous: t("components.pagination.previous"),
    next: t("components.pagination.next"),
    last: t("components.pagination.last"),
    stale: t("components.pagination.stale"),
    page: (page, totalPages) =>
      t("components.pagination.page", { page, totalPages }),
  };
}

const controlClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

const disabledClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-gray-100 bg-gray-50 px-3 text-sm font-bold text-gray-400";

const currentClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-blue-700 px-3 text-sm font-black text-white shadow-sm";

/**
 * Felles sidebladdring for lister. Sidetall utenfor området klemmes til siste
 * side, slik at en gammel `?side=999`-lenke alltid peker på en side som finnes.
 */
export default function Pagination({
  page,
  totalPages,
  hrefFor,
  labels,
  summary,
  className = "",
}: {
  page: number;
  totalPages: number;
  /** Bygger lenken til en gitt side med sidens egne søkeparametere. */
  hrefFor: (page: number) => string;
  labels: PaginationLabels;
  /** Valgfri oppsummering, f.eks. «Viser 1–20 av 43». */
  summary?: string;
  className?: string;
}) {
  const total = Math.max(1, Math.floor(totalPages) || 1);
  const requested = Math.max(1, Math.floor(page) || 1);
  const current = clampPage(requested, total);
  // En gammel lenke kan peke forbi siste side. Da viser vi siste side, men
  // gjør sidenummeret klikkbart slik at listen kan lastes på nytt.
  const stalePage = requested > total;
  if (total <= 1 && !stalePage) return null;

  const pageText = labels.page(current, total);
  const controls = [
    {
      key: "first",
      label: labels.first,
      target: 1,
      disabled: current <= 1,
      rel: undefined,
    },
    {
      key: "previous",
      label: labels.previous,
      target: current - 1,
      disabled: current <= 1,
      rel: "prev" as const,
    },
    {
      key: "next",
      label: labels.next,
      target: current + 1,
      disabled: current >= total,
      rel: "next" as const,
    },
    {
      key: "last",
      label: labels.last,
      target: total,
      disabled: current >= total,
      rel: undefined,
    },
  ];

  return (
    <nav
      aria-label={labels.label}
      className={`flex flex-col gap-2 sm:flex-row sm:items-center ${
        summary ? "sm:justify-between" : "sm:justify-center"
      } ${className}`}
    >
      {stalePage ? (
        <Link
          href={hrefFor(current)}
          className="text-center text-sm font-bold text-blue-700 underline hover:text-blue-900 sm:text-left"
        >
          {labels.stale}
        </Link>
      ) : summary ? (
        <p className="text-center text-sm text-gray-600 sm:text-left">
          {summary}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {controls.slice(0, 2).map((control) =>
          control.disabled ? (
            <span
              key={control.key}
              aria-disabled="true"
              className={disabledClass}
            >
              {control.label}
            </span>
          ) : (
            <Link
              key={control.key}
              href={hrefFor(control.target)}
              rel={control.rel}
              className={controlClass}
            >
              {control.label}
            </Link>
          ),
        )}

        <span
          aria-current="page"
          aria-label={pageText}
          className={currentClass}
        >
          {current}
        </span>

        {controls.slice(2).map((control) =>
          control.disabled ? (
            <span
              key={control.key}
              aria-disabled="true"
              className={disabledClass}
            >
              {control.label}
            </span>
          ) : (
            <Link
              key={control.key}
              href={hrefFor(control.target)}
              rel={control.rel}
              className={controlClass}
            >
              {control.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
