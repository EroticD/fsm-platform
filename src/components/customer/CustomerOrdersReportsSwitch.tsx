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

  return (
    <nav
      aria-label={t("customers.reports.switchLabel")}
      className="inline-flex w-full gap-1 rounded-2xl border-2 border-gray-200 bg-white p-1 shadow-sm sm:w-auto"
    >
      <Link
        href={ordersHref}
        scroll={false}
        aria-current={active === "orders" ? "page" : undefined}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition sm:flex-none ${
          active === "orders"
            ? "bg-blue-600 text-white shadow-sm"
            : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        <Icon name="folder" className="h-4 w-4 shrink-0" />
        {t("customers.detail.tabs.orders")}
      </Link>
      <Link
        href={reportsHref}
        scroll={false}
        aria-current={active === "reports" ? "page" : undefined}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition sm:flex-none ${
          active === "reports"
            ? "bg-blue-600 text-white shadow-sm"
            : "text-gray-600 hover:bg-gray-100"
        }`}
      >
        <Icon name="clipboard" className="h-4 w-4 shrink-0" />
        {t("customers.reports.title")}
        {reportCount > 0 && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
              active === "reports"
                ? "bg-white/20 text-white"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {reportCount}
          </span>
        )}
      </Link>
    </nav>
  );
}
