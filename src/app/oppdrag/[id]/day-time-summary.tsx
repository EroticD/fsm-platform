import type { ReactNode } from "react";
import type { VisitStatus } from "@prisma/client";
import Icon from "@/components/icons";
import { setRouteSequence } from "./actions";
import {
  dateOnlyInOslo,
  formatDateLocalized,
  formatDateRangeLocalized,
  parseDateOnly,
} from "@/lib/dates";
import { formatDurationMinutes } from "@/lib/duration";
import { VISIT_STATUS_LABEL_KEYS } from "@/lib/visit-status";
import {
  summarizeWorkOrderTime,
  visitTimeMetrics,
} from "@/lib/visit-time";

type Translate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

export type DaySummaryVisit = {
  id: string;
  startsAt: Date;
  routeSequence: number | null;
  status: VisitStatus;
  enRouteAt: Date | null;
  onSiteAt: Date | null;
  doneAt: Date | null;
  travelFromEndedAt: Date | null;
};

const VISIT_STATUS_TONES: Record<string, string> = {
  PLANNED:
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  ASSIGNED: "border-[#bcd39a] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  EN_ROUTE: "border-[#c9c0ac] bg-[#fff4d6] text-[#6b4808]",
  ON_SITE:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  DONE: "border-[#b9cdb4] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  CANCELLED: "border-[#e7b5ae] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
};

const TIME_STAMPS = [
  { field: "enRouteAt", labelKey: "orders.detail.time.enRouteAt" },
  { field: "onSiteAt", labelKey: "orders.detail.time.onSiteAt" },
  { field: "doneAt", labelKey: "orders.detail.time.doneAt" },
  {
    field: "travelFromEndedAt",
    labelKey: "orders.detail.time.travelFromEndedAt",
  },
] as const;

function visitStatusBadge(status: VisitStatus, t: Translate): ReactNode {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-bold ${
        VISIT_STATUS_TONES[status] ??
        "border-[var(--line,#dedcd1)] bg-surface"
      }`}
    >
      {t(VISIT_STATUS_LABEL_KEYS[status])}
    </span>
  );
}

/**
 * Kompakt, skrivebeskyttet «Dager og tid»-sammendrag for kontoret.
 *
 * Hver kalenderdag er én intern arbeidsøkt. Kontoret planlegger datoene på
 * oppdraget; felten registrerer de faktiske tidspunktene. Derfor viser denne
 * flaten bare status, tidsstempler og summer – ingen visittskjemaer.
 */
export function renderDayTimeSummary({
  visits,
  workOrderId,
  scheduledFor,
  scheduledTo,
  locale,
  t,
}: {
  visits: DaySummaryVisit[];
  workOrderId: string;
  scheduledFor: Date | null;
  scheduledTo: Date | null;
  locale: string;
  t: Translate;
}): ReactNode {
  if (visits.length === 0) {
    const range = formatDateRangeLocalized(
      scheduledFor,
      scheduledTo,
      locale,
      t("orders.detail.noDate"),
    );
    return (
      <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
        <p className="text-sm font-bold text-[var(--ink,#101310)]">
          {t("orders.detail.time.empty")}
        </p>
        <p className="mt-1 text-xs font-medium text-[#62685f]">
          {t("orders.detail.time.emptyHint", { range })}
        </p>
        <a
          href={`/oppdrag/${workOrderId}/rediger#office-edit-scheduled-for`}
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
        >
          {t("orders.detail.time.editDates")}
        </a>
      </div>
    );
  }

  const total = summarizeWorkOrderTime(visits);
  const rows = [...visits].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--ink,#101310)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#62685f]">
              {t("orders.detail.time.orderTotal")}
            </p>
            <p className="mt-0.5 text-2xl font-black tabular-nums text-[var(--ink,#101310)]">
              {formatDurationMinutes(total.totalMinutes, locale)}
            </p>
          </div>
          <p className="text-xs font-bold text-[#62685f]">
            {t("orders.detail.time.completedDays", {
              done: total.completedSessions,
              total: total.sessions,
            })}
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--line,#dedcd1)] bg-surface px-2.5 py-1.5">
            <dt className="font-bold text-[#62685f]">
              {t("orders.detail.time.work")}
            </dt>
            <dd className="font-black tabular-nums text-[var(--ink,#101310)]">
              {formatDurationMinutes(total.workMinutes, locale)}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line,#dedcd1)] bg-surface px-2.5 py-1.5">
            <dt className="font-bold text-[#62685f]">
              {t("orders.detail.time.travelTo")}
            </dt>
            <dd className="font-black tabular-nums text-[var(--ink,#101310)]">
              {formatDurationMinutes(total.travelToMinutes, locale)}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--line,#dedcd1)] bg-surface px-2.5 py-1.5">
            <dt className="font-bold text-[#62685f]">
              {t("orders.detail.time.travelFrom")}
            </dt>
            <dd className="font-black tabular-nums text-[var(--ink,#101310)]">
              {formatDurationMinutes(total.travelFromMinutes, locale)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 flex items-center gap-1 text-2xs font-medium text-[#62685f]">
          <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
          {t("orders.detail.time.totalIncludesTravel")}
        </p>
      </div>

      <div
        data-workorder-route-sequence
        className="overflow-x-auto rounded-xl border border-[var(--line,#dedcd1)]"
      >
        <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
          <thead className="bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-black">
                {t("orders.detail.time.day")}
              </th>
              <th scope="col" className="px-3 py-2 font-black">
                {t("orders.detail.time.routeSequence")}
              </th>
              <th scope="col" className="px-3 py-2 font-black">
                {t("orders.detail.time.status")}
              </th>
              <th scope="col" className="px-3 py-2 font-black">
                {t("orders.detail.time.timestamps")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-black">
                {t("orders.detail.time.work")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-black">
                {t("orders.detail.time.travelTo")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-black">
                {t("orders.detail.time.travelFrom")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-black">
                {t("orders.detail.time.total")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((visit, index) => {
              const metrics = visitTimeMetrics(visit);
              const date = parseDateOnly(dateOnlyInOslo(visit.startsAt));
              const stamps = TIME_STAMPS.filter(
                (stamp) => visit[stamp.field] instanceof Date,
              );
              return (
                <tr
                  key={visit.id}
                  className={
                    index % 2 === 0
                      ? "bg-[var(--surface,#fffdf8)]"
                      : "bg-[var(--paper,#f2efe6)]"
                  }
                >
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 font-black text-[var(--ink,#101310)]"
                  >
                    {formatDateLocalized(date, locale, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </th>
                  <td className="px-3 py-2">
                    <form action={setRouteSequence} className="flex items-center gap-1.5">
                      <input type="hidden" name="workOrderId" value={workOrderId} />
                      <input type="hidden" name="visitId" value={visit.id} />
                      <label className="sr-only" htmlFor={`route-sequence-${visit.id}`}>
                        {t("orders.detail.time.routeSequence")}
                      </label>
                      <input
                        id={`route-sequence-${visit.id}`}
                        name="routeSequence"
                        type="number"
                        min={1}
                        max={9999}
                        defaultValue={visit.routeSequence ?? ""}
                        placeholder={t("orders.detail.time.routeSequenceAuto")}
                        className="h-9 w-16 rounded-md border border-[var(--line,#dedcd1)] bg-surface px-1.5 text-center text-sm font-bold tabular-nums text-[var(--ink,#101310)]"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center rounded-md border border-[var(--ink,#101310)] px-2 text-2xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
                      >
                        {t("orders.detail.time.routeSequenceSave")}
                      </button>
                    </form>
                    <p className="mt-1 max-w-[10rem] text-2xs leading-4 text-[#62685f]">
                      {t("orders.detail.time.routeSequenceHint")}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {visitStatusBadge(visit.status, t)}
                  </td>
                  <td className="px-3 py-2">
                    {stamps.length === 0 ? (
                      <span className="text-[#62685f]">
                        {t("orders.detail.time.notStarted")}
                      </span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {stamps.map((stamp) => (
                          <span
                            key={stamp.field}
                            className="inline-flex items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 font-bold tabular-nums text-[var(--ink,#101310)]"
                          >
                            <span className="font-medium text-[#62685f]">
                              {t(stamp.labelKey)}
                            </span>
                            {formatDateLocalized(
                              visit[stamp.field],
                              locale,
                              { timeStyle: "short", hourCycle: "h23" },
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {formatDurationMinutes(metrics.workMinutes, locale)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {formatDurationMinutes(metrics.travelToMinutes, locale)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {formatDurationMinutes(metrics.travelFromMinutes, locale)}
                  </td>
                  <td className="px-3 py-2 text-right font-black tabular-nums">
                    {formatDurationMinutes(metrics.totalMinutes, locale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
