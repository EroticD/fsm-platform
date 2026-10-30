import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";

/**
 * Segmentert bytte mellom oppdragshistorikken og kundens rapporter.
 * Begge ligger under Oppdrag-fanen, slik at kundekortet fortsatt har fem
 * toppnivåfaner.
 */
export default async function CustomerOrdersReportsSwitch({
  ordersHref,
  reportsHref,
  active,
  reportCount,
}: {
  ordersHref: string;
  reportsHref: string;
  active: "orders" | "reports";
  reportCount: number;
}) {
  const t = await getTranslations("common");

  const optionClass = (selected: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border px-3 text-xs font-bold transition sm:flex-none ${
      selected
        ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-[1px_1px_0_var(--ink,#101310)]"
        : "border-transparent text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
    }`;

  return (
    <nav
      aria-label={t("customers.reports.switchLabel")}
      className="inline-flex w-full gap-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1 shadow-[0_1px_2px_rgba(20,17,11,0.05)] [--focus-ring:var(--ink,#101310)] sm:w-auto"
    >
      <Link
        href={ordersHref}
        scroll={false}
        aria-current={active === "orders" ? "page" : undefined}
        className={optionClass(active === "orders")}
      >
        <Icon name="folder" className="h-4 w-4 shrink-0" />
        {t("customers.detail.tabs.orders")}
      </Link>
      <Link
        href={reportsHref}
        scroll={false}
        aria-current={active === "reports" ? "page" : undefined}
        className={optionClass(active === "reports")}
      >
        <Icon name="clipboard" className="h-4 w-4 shrink-0" />
        {t("customers.reports.title")}
        {reportCount > 0 && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-xs font-black tabular-nums ${
              active === "reports"
                ? "bg-[#101310]/10 text-[var(--ink,#101310)]"
                : "border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
            }`}
          >
            {reportCount}
          </span>
        )}
      </Link>
    </nav>
  );
}
