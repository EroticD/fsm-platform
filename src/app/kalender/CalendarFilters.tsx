import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { calendarViewHref } from "@/lib/calendar-tabs";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
} from "@/lib/work-order-status-colors";

type TechnicianOption = { id: string; name: string | null };

/**
 * Filtre for kalendervisningene. Skjemaet er vanlig GET-navigasjon, slik at
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
      className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"
      aria-label={t("calendar.filters.title")}
    >
      <input type="hidden" name="vis" value={visParam} />
      <input type="hidden" name="dato" value={date} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <div>
          <label
            htmlFor="calendar-filter-technician"
            className="mb-1 block text-xs font-bold text-gray-700"
          >
            {t("calendar.filters.technician")}
          </label>
          <select
            id="calendar-filter-technician"
            name="tekniker"
            defaultValue={technician}
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900"
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
            className="mb-1 block text-xs font-bold text-gray-700"
          >
            {t("calendar.filters.status")}
          </label>
          <select
            id="calendar-filter-status"
            name="status"
            defaultValue={status}
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900"
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
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-800">
            <input
              type="checkbox"
              name="ufordelt"
              value="1"
              defaultChecked={unassigned}
              className="h-4 w-4"
            />
            {t("calendar.filters.unassigned")}
          </label>
        )}

        <div className="flex gap-2 lg:justify-end">
          <button
            type="submit"
            className="min-h-11 flex-1 rounded-lg bg-gray-800 px-4 text-sm font-bold text-white transition hover:bg-gray-700 lg:flex-none"
          >
            {t("calendar.filters.apply")}
          </button>
          <Link
            href={calendarViewHref(visParam, { date })}
            className="flex min-h-11 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
          >
            {t("calendar.filters.reset")}
          </Link>
        </div>
      </div>
    </form>
  );
}
