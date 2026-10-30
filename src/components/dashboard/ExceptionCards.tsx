import Link from "next/link";
import Icon, { type IconName } from "@/components/icons";
import type { DispatchExceptionCounts } from "@/server/dispatch";

type ExceptionKey = keyof DispatchExceptionCounts;

type ExceptionDefinition = {
  key: ExceptionKey;
  labelKey: string;
  hintKey: string;
  href: string;
  icon: IconName;
  tone: "risk" | "warn" | "neutral";
};

/** Alle kort har en faktisk side å åpne – ingen døde knapper. */
const EXCEPTIONS: ExceptionDefinition[] = [
  {
    key: "unassignedToday",
    labelKey: "dashboard.exceptions.unassignedToday",
    hintKey: "dashboard.exceptions.unassignedTodayHint",
    href: "/oppdrag?vis=ikke-tildelt",
    icon: "user",
    tone: "risk",
  },
  {
    key: "visitsWithoutTechnician",
    labelKey: "dashboard.exceptions.visitsWithoutTechnician",
    hintKey: "dashboard.exceptions.visitsWithoutTechnicianHint",
    href: "/kalender/dispatch",
    icon: "calendar",
    tone: "warn",
  },
  {
    key: "doubleBooked",
    labelKey: "dashboard.exceptions.doubleBooked",
    hintKey: "dashboard.exceptions.doubleBookedHint",
    href: "/kalender/dispatch",
    icon: "columns",
    tone: "risk",
  },
  {
    key: "overdue",
    labelKey: "dashboard.exceptions.overdue",
    hintKey: "dashboard.exceptions.overdueHint",
    href: "/oppdrag?vis=forfalte",
    icon: "alert",
    tone: "risk",
  },
  {
    key: "missingCoordinates",
    labelKey: "dashboard.exceptions.missingCoordinates",
    hintKey: "dashboard.exceptions.missingCoordinatesHint",
    href: "/kart",
    icon: "pin",
    tone: "warn",
  },
  {
    key: "unsignedReports",
    labelKey: "dashboard.exceptions.unsignedReports",
    hintKey: "dashboard.exceptions.unsignedReportsHint",
    href: "/rapporter?vis=alle",
    icon: "file",
    tone: "neutral",
  },
  {
    key: "staleBookings",
    labelKey: "dashboard.exceptions.staleBookings",
    hintKey: "dashboard.exceptions.staleBookingsHint",
    href: "/kalender/dispatch",
    icon: "clock",
    tone: "warn",
  },
];

const TONE: Record<ExceptionDefinition["tone"], string> = {
  risk: "border-l-[var(--risk,#f04427)]",
  warn: "border-l-[#c78b16]",
  neutral: "border-l-[var(--line,#dedcd1)]",
};

export default function ExceptionCards({
  counts,
  t,
}: {
  counts: DispatchExceptionCounts;
  t: (key: string) => string;
}) {
  return (
    <section aria-labelledby="dashboard-exceptions-title" className="min-w-0">
      <div className="mb-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h2
            id="dashboard-exceptions-title"
            className="text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("dashboard.exceptions.title")}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-[var(--muted,#62685f)]">
            {t("dashboard.exceptions.subtitle")}
          </p>
        </div>
        <Link
          href="/kalender/dispatch"
          prefetch={false}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-2.5 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
        >
          {t("dashboard.exceptions.openDispatch")}
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {EXCEPTIONS.map((exception) => {
          const value = counts[exception.key];
          return (
            <li key={exception.key}>
              <Link
                href={exception.href}
                prefetch={false}
                className={`office-card flex min-h-[5.25rem] flex-col justify-between border-l-4 p-3 transition hover:shadow-[2px_2px_0_var(--signal,#d8ff3e)] ${TONE[exception.tone]}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold leading-snug text-[var(--ink,#101310)]">
                    {t(exception.labelKey)}
                  </span>
                  <Icon
                    name={exception.icon}
                    className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)]"
                  />
                </span>
                <span className="mt-2 flex items-end justify-between gap-2">
                  <span className="text-2xl font-black leading-none tabular-nums text-[var(--ink,#101310)]">
                    {value}
                  </span>
                  <span className="text-right text-[10px] font-medium leading-tight text-[var(--muted,#62685f)]">
                    {t(exception.hintKey)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
