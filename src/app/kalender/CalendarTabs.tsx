import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  calendarTabsFor,
  type CalendarTabKey,
} from "@/lib/calendar-tabs";

/**
 * Felles fanerad for alle kalendervisningene. Dispatch skjules for brukere
 * uten tildelingsrettighet, og rapporter vises bare med reports.view.
 */
export default async function CalendarTabs({
  active,
  canDispatch,
  canReports,
}: {
  active: CalendarTabKey;
  canDispatch: boolean;
  canReports: boolean;
}) {
  const t = await getTranslations("common");
  const tabs = calendarTabsFor({ canDispatch, canReports });

  return (
    <div className="overflow-x-auto pb-2" tabIndex={0}>
      <div className="flex min-w-max gap-1 rounded-xl bg-gray-200 p-1">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition ${
                isActive
                  ? "pointer-events-none bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.key === "reports" ? `📄 ${t(tab.labelKey)}` : t(tab.labelKey)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
