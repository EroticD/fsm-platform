import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import CalendarTabs from "@/app/kalender/CalendarTabs";
import type {
  CalendarTabKey,
  CalendarTabQuery,
} from "@/lib/calendar-tabs";

// Command Center-verdier. Fallbackene matcher office-card/signal-button/
// ink-button-tokenene, slik at flaten står riktig også før de er lastet.
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";

/**
 * Felles ramme for alle kalenderflatene: ressursoversikt, måned, uke,
 * to uker og dispatch. Ett tydelig sidehode («Kalender»), periode,
 * fanebyte og primærhandlingen «Nytt oppdrag» – uten dupliserte titler.
 */
export default async function CalendarShell({
  active,
  canDispatch,
  canReports,
  query,
  subtitle,
  periodLabel,
  canCreate,
  newWorkOrderHref = "/oppdrag/ny",
  children,
}: {
  active: CalendarTabKey;
  canDispatch: boolean;
  canReports: boolean;
  query?: CalendarTabQuery;
  subtitle: string;
  periodLabel?: string | null;
  canCreate: boolean;
  newWorkOrderHref?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("common");

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className={EYEBROW}>{t("calendar.page.eyebrow")}</p>
            <h1 className="mt-0.5 text-3xl font-black tracking-tight text-[var(--ink,#101310)] sm:text-4xl">
              {t("calendar.page.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
              {subtitle}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {periodLabel ? (
              <div className="w-full rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-1.5 sm:w-auto">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
                  {t("calendar.header.period")}
                </p>
                <p className="text-sm font-black tabular-nums text-[var(--ink,#101310)]">
                  {periodLabel}
                </p>
              </div>
            ) : null}
            {canCreate ? (
              <Link
                href={newWorkOrderHref}
                className={`${SIGNAL_BUTTON} w-full whitespace-nowrap sm:w-auto`}
              >
                <Icon name="plus" className="h-4 w-4" />
                {t("calendar.common.newWorkOrder")}
              </Link>
            ) : null}
          </div>
        </header>

        <CalendarTabs
          active={active}
          canDispatch={canDispatch}
          canReports={canReports}
          query={query}
        />

        {children}
      </div>
    </div>
  );
}
