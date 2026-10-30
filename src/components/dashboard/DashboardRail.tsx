import Link from "next/link";
import Icon from "@/components/icons";
import { formatDateRangeLocalized } from "@/lib/dates";
import type { DashboardOrder } from "./helpers";

export type DashboardTeamMember = {
  id: string;
  name: string | null;
  count: number;
};

function initials(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.charAt(0) ?? "?"}${parts[1]?.charAt(0) ?? ""}`;
}

function CoverageRing({ percent, label }: { percent: number; label: string }) {
  const size = 52;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safePercent = Math.min(100, Math.max(0, percent));
  const dashOffset = circumference * (1 - safePercent / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e7e3d7"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--signal)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ink)"
        fontSize="11"
        fontWeight="800"
      >
        {safePercent}%
      </text>
    </svg>
  );
}

export default function DashboardRail({
  nextOrder,
  team,
  counts,
  updatedAt,
  locale,
  canAssign,
  t,
}: {
  nextOrder: DashboardOrder | null;
  team: DashboardTeamMember[];
  counts: {
    unassigned: number;
    completedToday: number;
    todayTotal: number;
    todayRemaining: number;
    todayInProgress: number;
  };
  updatedAt: string;
  locale: string;
  canAssign: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const percent =
    counts.todayTotal > 0
      ? Math.round((counts.completedToday / counts.todayTotal) * 100)
      : 0;
  const teamActive = team.filter((member) => member.count > 0).length;
  const coverage =
    team.length > 0 ? Math.round((teamActive / team.length) * 100) : 0;
  const teamMax = Math.max(1, ...team.map((member) => member.count));

  return (
    <aside className="space-y-4 lg:col-start-2 lg:row-span-2">
      <section
        className={`overflow-hidden rounded-2xl border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)] shadow-[0_18px_40px_-26px_rgba(16,19,16,0.7)] ${
          nextOrder ? "border-t-4 border-t-[var(--risk,#f04427)]" : ""
        }`}
        aria-labelledby="next-action-title"
      >
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="next-action-title"
              className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--paper,#f2efe6)]/65"
            >
              {t("dashboard.nextAction.title")}
            </h2>
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                nextOrder
                  ? "bg-[var(--risk,#f04427)]"
                  : "bg-[var(--signal,#d8ff3e)]"
              }`}
            />
          </div>

          {nextOrder ? (
            <>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--risk,#f04427)] px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.08em] text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                {t("dashboard.kpi.overdue")}
                <span aria-hidden>·</span>
                {formatDateRangeLocalized(
                  nextOrder.scheduledFor,
                  nextOrder.scheduledTo,
                  locale,
                ) || t("dashboard.orderList.noDate")}
              </p>
              <h3 className="mt-2 line-clamp-2 text-lg font-black leading-6 tracking-tight">
                {nextOrder.title}
              </h3>
              <p className="mt-1 text-xs font-medium text-[var(--paper,#f2efe6)]/70">
                {nextOrder.customer?.name ||
                  t("dashboard.orderList.noCustomer")}
                <span aria-hidden> · </span>
                {nextOrder.technicians
                  .map((technician) => technician.name)
                  .filter(Boolean)
                  .join(", ") || t("dashboard.orderList.unassigned")}
              </p>
              <Link
                href={`/oppdrag/${nextOrder.id}${canAssign ? "#tildel" : ""}`}
                className="signal-button mt-4 w-full justify-between text-sm"
              >
                <span>
                  {canAssign
                    ? t("dashboard.nextAction.assign")
                    : t("dashboard.nextAction.open")}
                </span>
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ink,#101310)] text-[var(--signal,#d8ff3e)]"
                >
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </span>
              </Link>
            </>
          ) : (
            <div className="mt-3">
              <p className="flex items-center gap-2 text-base font-black">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                  aria-hidden
                >
                  <Icon name="check" className="h-4 w-4" />
                </span>
                {t("dashboard.nextAction.emptyTitle")}
              </p>
              <p className="mt-1 text-xs font-medium text-[var(--paper,#f2efe6)]/65">
                {t("dashboard.nextAction.emptyDescription")}
              </p>
              <Link
                href="/oppdrag?vis=forfalte"
                className="signal-button mt-4 w-full justify-center text-sm"
              >
                {t("dashboard.nextAction.allOverdue")}
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </section>

      <section
        className="office-card p-4"
        aria-labelledby="progress-title"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="progress-title"
            className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--muted,#62685f)]"
          >
            {t("dashboard.progress.title")}
          </h2>
          <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-[11px] font-black tabular-nums text-[var(--ink,#101310)]">
            {t("dashboard.progress.percent", { percent })}
          </span>
        </div>

        {counts.todayTotal === 0 ? (
          <p className="mt-3 text-sm font-bold text-[var(--muted,#62685f)]">
            {t("dashboard.progress.empty")}
          </p>
        ) : (
          <>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-black leading-none tracking-[-0.05em] tabular-nums text-[var(--ink,#101310)]">
                {counts.todayRemaining}
              </span>
              <span className="text-sm font-bold text-[var(--ink,#101310)]">
                {t("dashboard.progress.remaining")}
              </span>
            </p>
            <p className="mt-1 text-xs font-medium text-[var(--muted,#62685f)]">
              {t("dashboard.progress.ofToday", {
                count: counts.todayTotal,
              })}
            </p>
            <div
              role="progressbar"
              aria-label={t("dashboard.progress.title")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7e3d7]"
            >
              <div
                className="h-full rounded-full bg-[var(--signal,#d8ff3e)]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-bold text-[var(--muted,#62685f)]">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-[var(--signal,#d8ff3e)] ring-1 ring-[var(--ink,#101310)]"
                />
                {t("dashboard.progress.inProgress", {
                  count: counts.todayInProgress,
                })}
              </span>
              <span>
                {t("dashboard.progress.completed", {
                  count: counts.completedToday,
                })}
              </span>
            </div>
          </>
        )}
      </section>

      <section
        className="office-card overflow-hidden"
        aria-labelledby="team-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line,#dedcd1)] px-4 py-3">
          <div className="min-w-0">
            <h2
              id="team-title"
              className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--muted,#62685f)]"
            >
              {t("dashboard.team.title")}
            </h2>
            <p className="mt-0.5 text-xs font-bold text-[var(--ink,#101310)]">
              {t("dashboard.team.coverageDetail", {
                active: teamActive,
                total: team.length,
              })}
            </p>
          </div>
          <CoverageRing
            percent={coverage}
            label={t("dashboard.team.coverage", { percent: coverage })}
          />
        </div>

        {team.length === 0 ? (
          <p className="px-4 py-4 text-xs font-medium text-[var(--muted,#62685f)]">
            {t("dashboard.team.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line,#dedcd1)]">
            {team.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-2.5 px-4 py-2"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink,#101310)] text-[11px] font-black uppercase text-[var(--signal,#d8ff3e)]"
                  aria-hidden
                >
                  {initials(member.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-[var(--ink,#101310)]">
                      {member.name || t("dashboard.unknownUser")}
                    </span>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-[var(--muted,#62685f)]">
                      {t("dashboard.team.load", { count: member.count })}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e7e3d7]">
                    <div
                      className={`h-full rounded-full ${
                        member.count === 0
                          ? "bg-transparent"
                          : "bg-[var(--signal,#d8ff3e)]"
                      }`}
                      style={{
                        width: `${member.count === 0 ? 0 : Math.max(12, Math.round((member.count / teamMax) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-4 py-2">
          <Link
            href="/oppdrag?vis=ikke-tildelt"
            prefetch={false}
            className="flex items-center justify-between gap-2 text-xs font-bold text-[var(--ink,#101310)]"
          >
            <span>{t("dashboard.kpi.unassigned")}</span>
            <span className="flex items-center gap-1.5 text-[var(--risk-text,#b42318)]">
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              {counts.unassigned}
            </span>
          </Link>
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--signal,#d8ff3e)] ring-1 ring-[#101310]/40"
        />
        {t("dashboard.updatedAt", { time: updatedAt })}
      </p>
    </aside>
  );
}
