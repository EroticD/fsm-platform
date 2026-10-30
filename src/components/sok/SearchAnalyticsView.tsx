import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type { SearchAnalytics } from "@/server/search-analytics";
import { formatDateLocalized } from "@/lib/dates";
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

const CARD = "office-card p-4 sm:p-6";
const CHIP =
  "inline-flex min-h-11 items-center rounded-[10px] border px-4 py-2 text-xs font-bold transition";
const MUTED = "text-[var(--muted,#62685f)]";

export default async function SearchAnalyticsView({
  data,
  selectedDays,
}: SearchAnalyticsViewProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const rate = zeroResultRate(data.zeroResultCount, data.totalSearches);
  const busiestDay = data.daily.reduce((max, row) => Math.max(max, row.count), 0);

  return (
    <div className="space-y-5">
      <nav aria-label={t("searchAdmin.period")} className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
          {t("searchAdmin.period")}:
        </span>
        {SEARCH_ANALYTICS_DAY_OPTIONS.map((days) => {
          const active = days === selectedDays;
          return (
            <Link
              key={days}
              href={`/sok/analyse?days=${days}`}
              aria-current={active ? "page" : undefined}
              className={`${CHIP} ${
                active
                  ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                  : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
              }`}
            >
              {t("searchAdmin.days", { days })}
            </Link>
          );
        })}
      </nav>

      <aside
        aria-labelledby="search-analytics-privacy-title"
        className="office-card relative overflow-hidden p-4 pl-5 sm:p-5 sm:pl-6"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-[var(--signal,#d8ff3e)]"
        />
        <h2
          id="search-analytics-privacy-title"
          className="flex items-center gap-2 text-sm font-extrabold text-[var(--ink,#101310)]"
        >
          <Icon name="shield" className="h-4 w-4 shrink-0" />
          {t("searchAdmin.privacyTitle")}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
          {t("searchAdmin.privacyBody")}
        </p>
      </aside>

      {data.totalSearches === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="flex justify-center text-[var(--muted,#62685f)]" aria-hidden="true">
            <Icon name="search" className="h-8 w-8" />
          </p>
          <h2 className="mt-3 text-lg font-extrabold text-[var(--ink,#101310)]">
            {t("searchAdmin.empty.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted,#62685f)]">
            {t("searchAdmin.empty.body")}
          </p>
        </div>
      ) : (
        <>
          <section aria-label={t("searchAdmin.stats.total")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: t("searchAdmin.stats.total"), value: formatSearchCount(data.totalSearches, locale), accent: "bg-[var(--signal,#d8ff3e)]" },
                { label: t("searchAdmin.stats.zeroResults"), value: formatSearchCount(data.zeroResultCount, locale), accent: "bg-[var(--ink,#101310)]" },
                { label: t("searchAdmin.stats.zeroResultRate"), value: formatSearchRate(rate, locale), accent: "bg-[var(--line,#dedcd1)]" },
                { label: t("searchAdmin.stats.averageLatency"), value: formatSearchLatency(data.averageLatencyMs, locale), accent: "bg-[var(--ink,#101310)]" },
              ].map((stat) => (
                <div key={stat.label} className="office-card relative overflow-hidden p-4">
                  <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${stat.accent}`} />
                  <p className="text-xs font-bold uppercase leading-4 tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-2xl font-extrabold leading-none tracking-tight text-[var(--ink,#101310)] tabular-nums sm:text-3xl">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className={CARD} aria-labelledby="search-analytics-top-title">
              <h2
                id="search-analytics-top-title"
                className="text-base font-extrabold text-[var(--ink,#101310)]"
              >
                {t("searchAdmin.topQueries.title")}
              </h2>
              <p className={`mt-1 text-sm ${MUTED}`}>
                {t("searchAdmin.topQueries.description")}
              </p>
              {data.topQueries.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
                  {t("searchAdmin.topQueries.empty")}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto" role="region" aria-label={t("searchAdmin.topQueries.title")} tabIndex={0}>
                  <table className="office-table">
                    <caption className="sr-only">
                      {t("searchAdmin.topQueries.title")}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("searchAdmin.topQueries.query")}</th>
                        <th scope="col" className="text-right">{t("searchAdmin.topQueries.count")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topQueries.map((row) => (
                        <tr key={row.query}>
                          <td className="break-words text-[var(--ink,#101310)]">
                            {row.query}
                          </td>
                          <td className="text-right font-bold text-[var(--ink,#101310)]">
                            {formatSearchCount(row.count, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={CARD} aria-labelledby="search-analytics-zero-title">
              <h2
                id="search-analytics-zero-title"
                className="text-base font-extrabold text-[var(--ink,#101310)]"
              >
                {t("searchAdmin.topZeroQueries.title")}
              </h2>
              <p className={`mt-1 text-sm ${MUTED}`}>
                {t("searchAdmin.topZeroQueries.description")}
              </p>
              {data.topZeroResultQueries.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
                  {t("searchAdmin.topZeroQueries.empty")}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto" role="region" aria-label={t("searchAdmin.topZeroQueries.title")} tabIndex={0}>
                  <table className="office-table">
                    <caption className="sr-only">
                      {t("searchAdmin.topZeroQueries.title")}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("searchAdmin.topQueries.query")}</th>
                        <th scope="col" className="text-right">{t("searchAdmin.topQueries.count")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topZeroResultQueries.map((row) => (
                        <tr key={row.query}>
                          <td className="break-words text-[var(--ink,#101310)]">
                            {row.query}
                          </td>
                          <td className="text-right font-bold text-[var(--ink,#101310)]">
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

          <section className={CARD} aria-labelledby="search-analytics-daily-title">
            <h2
              id="search-analytics-daily-title"
              className="text-base font-extrabold text-[var(--ink,#101310)]"
            >
              {t("searchAdmin.daily.title")}
            </h2>
            <p className={`mt-1 text-sm ${MUTED}`}>
              {t("searchAdmin.daily.description")}
            </p>
            <div className="mt-4 hidden overflow-x-auto sm:block" role="region" aria-label={t("searchAdmin.daily.caption")} tabIndex={0}>
              <table className="office-table min-w-[36rem]">
                <caption className="sr-only">
                  {t("searchAdmin.daily.caption")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("searchAdmin.daily.date")}</th>
                    <th scope="col" className="text-right">{t("searchAdmin.daily.count")}</th>
                    <th scope="col" className="text-right">{t("searchAdmin.daily.zeroResults")}</th>
                    <th scope="col">{t("searchAdmin.daily.bar")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr key={row.date}>
                      <th scope="row" className="text-left font-normal text-[var(--ink,#101310)]">
                        <time dateTime={row.date}>
                          {formatDateLocalized(row.date, locale)}
                        </time>
                      </th>
                      <td className="text-right font-bold text-[var(--ink,#101310)]">
                        {formatSearchCount(row.count, locale)}
                      </td>
                      <td className="text-right text-[var(--muted,#62685f)]">
                        {formatSearchCount(row.zeroResultCount, locale)}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 min-w-24 flex-1 rounded-full bg-[var(--paper,#f2efe6)]"
                            aria-hidden="true"
                          >
                            <div
                              className="h-2 rounded-full bg-[var(--ink,#101310)]"
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

            {/* På mobil vises dagstallene som kort, uten vannrett scrolling. */}
            <ul className="mt-4 divide-y divide-[var(--line,#dedcd1)] sm:hidden">
              {data.daily.map((row) => (
                <li key={row.date} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <time
                    dateTime={row.date}
                    className="text-sm font-bold text-[var(--ink,#101310)]"
                  >
                    {formatDateLocalized(row.date, locale)}
                  </time>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                        {t("searchAdmin.daily.count")}
                      </dt>
                      <dd className="mt-0.5 font-bold text-[var(--ink,#101310)]">
                        {formatSearchCount(row.count, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                        {t("searchAdmin.daily.zeroResults")}
                      </dt>
                      <dd className="mt-0.5 text-[var(--muted,#62685f)]">
                        {formatSearchCount(row.zeroResultCount, locale)}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 flex-1 rounded-full bg-[var(--paper,#f2efe6)]"
                      aria-hidden="true"
                    >
                      <div
                        className="h-2 rounded-full bg-[var(--ink,#101310)]"
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
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
