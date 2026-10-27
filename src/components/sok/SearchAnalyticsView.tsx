import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { SearchAnalytics } from "@/server/search-analytics";
import {
  barWidthPercent,
  formatSearchCount,
  formatSearchLatency,
  formatSearchRate,
  SEARCH_ANALYTICS_DAY_OPTIONS,
  zeroResultRate,
  type SearchAnalyticsDays,
} from "@/lib/search-analytics-format";

type SearchAnalyticsViewProps = {
  data: SearchAnalytics;
  selectedDays: SearchAnalyticsDays;
};

const cardClass =
  "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6";

export default async function SearchAnalyticsView({
  data,
  selectedDays,
}: SearchAnalyticsViewProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const rate = zeroResultRate(data.zeroResultCount, data.totalSearches);
  const busiestDay = data.daily.reduce((max, row) => Math.max(max, row.count), 0);

  return (
    <div className="space-y-6">
      <nav aria-label={t("searchAdmin.period")} className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gray-700">
          {t("searchAdmin.period")}:
        </span>
        {SEARCH_ANALYTICS_DAY_OPTIONS.map((days) => {
          const active = days === selectedDays;
          return (
            <Link
              key={days}
              href={`/sok/analyse?days=${days}`}
              aria-current={active ? "page" : undefined}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-bold transition ${
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {t("searchAdmin.days", { days })}
            </Link>
          );
        })}
      </nav>

      <aside
        aria-labelledby="search-analytics-privacy-title"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5"
      >
        <h2
          id="search-analytics-privacy-title"
          className="text-sm font-bold text-amber-900"
        >
          🔒 {t("searchAdmin.privacyTitle")}
        </h2>
        <p className="mt-1 text-sm text-amber-800">
          {t("searchAdmin.privacyBody")}
        </p>
      </aside>

      {data.totalSearches === 0 ? (
        <div className={`${cardClass} text-center`}>
          <p className="text-4xl" aria-hidden="true">
            🔍
          </p>
          <h2 className="mt-3 text-xl font-bold text-gray-900">
            {t("searchAdmin.empty.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
            {t("searchAdmin.empty.body")}
          </p>
        </div>
      ) : (
        <>
          <section aria-label={t("searchAdmin.stats.total")}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className={cardClass}>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {t("searchAdmin.stats.total")}
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">
                  {formatSearchCount(data.totalSearches, locale)}
                </p>
              </div>
              <div className={cardClass}>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {t("searchAdmin.stats.zeroResults")}
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">
                  {formatSearchCount(data.zeroResultCount, locale)}
                </p>
              </div>
              <div className={cardClass}>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {t("searchAdmin.stats.zeroResultRate")}
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">
                  {formatSearchRate(rate, locale)}
                </p>
              </div>
              <div className={cardClass}>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  {t("searchAdmin.stats.averageLatency")}
                </p>
                <p className="mt-2 text-3xl font-black text-gray-900">
                  {formatSearchLatency(data.averageLatencyMs, locale)}
                </p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className={cardClass} aria-labelledby="search-analytics-top-title">
              <h2
                id="search-analytics-top-title"
                className="text-lg font-bold text-gray-900"
              >
                {t("searchAdmin.topQueries.title")}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {t("searchAdmin.topQueries.description")}
              </p>
              {data.topQueries.length === 0 ? (
                <p className="mt-4 text-sm text-gray-600">
                  {t("searchAdmin.topQueries.empty")}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      {t("searchAdmin.topQueries.title")}
                    </caption>
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                        <th scope="col" className="py-2 pr-4 font-bold">
                          {t("searchAdmin.topQueries.query")}
                        </th>
                        <th scope="col" className="py-2 text-right font-bold">
                          {t("searchAdmin.topQueries.count")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topQueries.map((row) => (
                        <tr key={row.query} className="border-b border-gray-100 last:border-0">
                          <td className="break-words py-3 pr-4 text-gray-900">
                            {row.query}
                          </td>
                          <td className="py-3 text-right font-bold text-gray-900">
                            {formatSearchCount(row.count, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={cardClass} aria-labelledby="search-analytics-zero-title">
              <h2
                id="search-analytics-zero-title"
                className="text-lg font-bold text-gray-900"
              >
                {t("searchAdmin.topZeroQueries.title")}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {t("searchAdmin.topZeroQueries.description")}
              </p>
              {data.topZeroResultQueries.length === 0 ? (
                <p className="mt-4 text-sm text-gray-600">
                  {t("searchAdmin.topZeroQueries.empty")}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      {t("searchAdmin.topZeroQueries.title")}
                    </caption>
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                        <th scope="col" className="py-2 pr-4 font-bold">
                          {t("searchAdmin.topQueries.query")}
                        </th>
                        <th scope="col" className="py-2 text-right font-bold">
                          {t("searchAdmin.topQueries.count")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topZeroResultQueries.map((row) => (
                        <tr key={row.query} className="border-b border-gray-100 last:border-0">
                          <td className="break-words py-3 pr-4 text-gray-900">
                            {row.query}
                          </td>
                          <td className="py-3 text-right font-bold text-gray-900">
                            {formatSearchCount(row.count, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className={cardClass} aria-labelledby="search-analytics-daily-title">
            <h2
              id="search-analytics-daily-title"
              className="text-lg font-bold text-gray-900"
            >
              {t("searchAdmin.daily.title")}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {t("searchAdmin.daily.description")}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">
                  {t("searchAdmin.daily.caption")}
                </caption>
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                    <th scope="col" className="py-2 pr-4 font-bold">
                      {t("searchAdmin.daily.date")}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-bold">
                      {t("searchAdmin.daily.count")}
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-bold">
                      {t("searchAdmin.daily.zeroResults")}
                    </th>
                    <th scope="col" className="py-2 font-bold">
                      {t("searchAdmin.daily.bar")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr key={row.date} className="border-b border-gray-100 last:border-0">
                      <th scope="row" className="py-3 pr-4 text-left font-normal text-gray-900">
                        <time dateTime={row.date}>{row.date}</time>
                      </th>
                      <td className="py-3 pr-4 text-right font-bold text-gray-900">
                        {formatSearchCount(row.count, locale)}
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-700">
                        {formatSearchCount(row.zeroResultCount, locale)}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 min-w-24 flex-1 rounded-full bg-gray-100"
                            aria-hidden="true"
                          >
                            <div
                              className="h-2 rounded-full bg-blue-600"
                              style={{
                                width: `${barWidthPercent(row.count, busiestDay)}%`,
                              }}
                            />
                          </div>
                          <span className="sr-only">
                            {t("searchAdmin.daily.barLabel", {
                              count: formatSearchCount(row.count, locale),
                            })}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
