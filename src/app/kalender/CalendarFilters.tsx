import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { calendarViewHref } from "@/lib/calendar-tabs";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
} from "@/lib/work-order-status-colors";

type TechnicianOption = { id: string; name: string | null };

const FIELD =
  "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]";

/** Filtre for kalendervisningene. Skjemaet er vanlig GET-navigasjon, slik at
 * filtrene ligger i URL-en og kan bokmerkes, deles og overleve refresh uten
 * JavaScript. `vis` og `dato` sendes med som skjulte felt.
 */
export default async function CalendarFilters({
  visParam,
  date,
  technician,
  status,
  unassigned,
  technicians,
  showUnassigned,
}: {
  visParam: string;
  date: string;
  technician: string;
  status: string;
  unassigned: boolean;
  technicians: TechnicianOption[];
  showUnassigned: boolean;
}) {
  const t = await getTranslations("common");
  const statuses = WORK_ORDER_STATUS_ORDER.filter(
    (candidate) => candidate !== "CANCELLED",
  );

  return (
    <form
      method="get"
      action="/kalender"
      className="office-card p-3 sm:p-4"
      aria-label={t("calendar.filters.title")}
    >
      <input type="hidden" name="vis" value={visParam} />
      <input type="hidden" name="dato" value={date} />

      <div className="mb-3 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
        <Icon name="filter" className="h-4 w-4 text-[var(--ink,#101310)]" />
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]">
          {t("calendar.filters.title")}
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <div>
          <label
            htmlFor="calendar-filter-technician"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]"
          >
            {t("calendar.filters.technician")}
          </label>
          <select
            id="calendar-filter-technician"
            name="tekniker"
            defaultValue={technician}
            className={FIELD}
          >
            <option value="">{t("calendar.filters.allTechnicians")}</option>
            {technicians.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name ?? t("calendar.filters.unnamedTechnician")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="calendar-filter-status"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]"
          >
            {t("calendar.filters.status")}
          </label>
          <select
            id="calendar-filter-status"
            name="status"
            defaultValue={status}
            className={FIELD}
          >
            <option value="">{t("calendar.filters.allStatuses")}</option>
            {statuses.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t(WORK_ORDER_STATUS_LABEL_KEYS[candidate])}
              </option>
            ))}
          </select>
        </div>

        {showUnassigned && (
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 text-sm font-semibold text-[var(--ink,#101310)]">
            <input
              type="checkbox"
              name="ufordelt"
              value="1"
              defaultChecked={unassigned}
              className="h-4 w-4 accent-[var(--ink,#101310)]"
            />
            {t("calendar.filters.unassigned")}
          </label>
        )}

        <div className="flex gap-2 lg:justify-end">
          <button
            type="submit"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--ink,#101310)] px-4 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85 lg:flex-none"
          >
            <Icon name="check" className="h-4 w-4" />
            {t("calendar.filters.apply")}
          </button>
          <Link
            href={calendarViewHref(visParam, { date })}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-white px-4 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("calendar.filters.reset")}
          </Link>
        </div>
      </div>
    </form>
  );
}
