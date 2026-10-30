import Link from "next/link";
import type { DashboardView } from "./helpers";

/**
 * Visningsvelgeren er vanlige lenker med query-parameter, ikke klientstate.
 * Da er valget delbart, fungerer uten JavaScript og gir ingen hydreringsflimmer.
 */
export default function DashboardViewSwitch({
  view,
  listHref,
  boardHref,
  listLabel,
  boardLabel,
  ariaLabel,
}: {
  view: DashboardView;
  listHref: string;
  boardHref: string;
  listLabel: string;
  boardLabel: string;
  ariaLabel: string;
}) {
  const options = [
    { key: "liste" as const, href: listHref, label: listLabel },
    { key: "tavle" as const, href: boardHref, label: boardLabel },
  ];

  return (
    <nav
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1 shadow-[0_1px_0_rgba(16,19,16,0.04)]"
    >
      {options.map((option) => {
        const active = option.key === view;
        return (
          <Link
            key={option.key}
            href={option.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-lg px-3.5 text-xs font-bold transition sm:text-sm ${
              active
                ? "bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                : "text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
