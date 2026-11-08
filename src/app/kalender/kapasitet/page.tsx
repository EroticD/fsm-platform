import { requireModulePage } from "@/lib/module-guards";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import CalendarShell from "@/app/kalender/CalendarShell";
import IsoDateInput from "@/components/IsoDateInput";
import Icon from "@/components/icons";
import ErrorBanner from "@/components/ErrorBanner";
import Button, { buttonClassName } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { controlClassName } from "@/components/ui/controlStyles";
import {
  addDaysUtc,
  formatDateLocalized,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getCapacityOverview } from "@/server/dispatch";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.kapasitet") };
}

/**
 * Kapasitet mot belastning. Siden er bevisst en enkel tabell: den skal kunne
 * leses på et øyeblikk av kontoret, og alle tallene kommer fra én avgrenset
 * tjenestefunksjon – ikke fra summering i nettleseren.
 */
export default async function CapacityPage({
  searchParams,
}: {
  searchParams: Promise<{
    fra?: string | string[];
    til?: string | string[];
  }>;
}) {
  await requireModulePage("calendar");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.assign")) redirect("/kalender");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const today = parseDateOnly(todayInOslo()) ?? new Date();
  const defaultFrom = toDateOnly(today);
  const defaultTo = toDateOnly(addDaysUtc(today, 6));
  const rawFrom = firstParam(params.fra) ?? defaultFrom;
  const rawTo = firstParam(params.til) ?? defaultTo;
  const from = parseDateOnly(rawFrom) ?? today;
  const to = parseDateOnly(rawTo) ?? addDaysUtc(from, 6);
  const range =
    to < from
      ? { from: toDateOnly(from), to: toDateOnly(addDaysUtc(from, 6)) }
      : { from: toDateOnly(from), to: toDateOnly(to) };

  const overview = await getCapacityOverview(
    user,
    parseDateOnly(range.from)!,
    parseDateOnly(range.to)!,
  );
  const data = overview.ok ? overview.data : null;
  const canDispatch = hasPermission(user, "workorders.assign");
  const canReports = hasPermission(user, "reports.view");

  const formatDay = (date: string) =>
    formatDateLocalized(date, locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }) || date;

  const utilisation = (capacity: number, load: number) =>
    capacity > 0 ? Math.round((load / capacity) * 100) : 0;

  const departments = data
    ? Array.from(
        new Map(
          data.days.map((day) => [
            day.departmentId,
            { id: day.departmentId, name: day.departmentName },
          ]),
        ).values(),
      )
    : [];

  return (
    <CalendarShell
      active="capacity"
      canDispatch={canDispatch}
      canReports={canReports}
      subtitle={t("dispatch.capacity.subtitle")}
      periodLabel={`${formatDay(range.from)} – ${formatDay(range.to)}`}
      canCreate={hasPermission(user, "workorders.create")}
      newWorkOrderHref="/oppdrag/ny"
    >
      <Card>
        <form
          action="/kalender/kapasitet"
          method="get"
          className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4"
          aria-label={t("dispatch.capacity.filters")}
        >
          <Field
            id="capacity-from"
            label={t("dispatch.capacity.from")}
            className="min-w-0"
          >
            <IsoDateInput
              id="capacity-from"
              name="fra"
              defaultValue={range.from}
              className={controlClassName()}
            />
          </Field>
          <Field
            id="capacity-to"
            label={t("dispatch.capacity.to")}
            className="min-w-0"
          >
            <IsoDateInput
              id="capacity-to"
              name="til"
              defaultValue={range.to}
              className={controlClassName()}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              <Icon name="check" className="h-4 w-4" />
              {t("dispatch.capacity.apply")}
            </Button>
          </div>
          <div className="flex items-end">
            <Link
              href="/kalender/kapasitet"
              className={`${buttonClassName({ variant: "secondary" })} w-full`}
            >
              {t("dispatch.capacity.reset")}
            </Link>
          </div>
        </form>
      </Card>

      {!overview.ok && (
        <ErrorBanner message={t("dispatch.capacity.error")} />
      )}

      {data && (
        <>
          <section
            aria-labelledby="capacity-total-title"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <Card className="p-4">
              <p className="type-eyebrow text-[var(--muted,#62685f)]">
                {t("dispatch.capacity.totalCapacity")}
              </p>
              <p className="type-title-2 mt-1 tabular-nums text-[var(--ink,#101310)]">
                {Math.round(data.totals.capacityMinutes / 60)} h
              </p>
            </Card>
            <Card className="p-4">
              <p className="type-eyebrow text-[var(--muted,#62685f)]">
                {t("dispatch.capacity.totalLoad")}
              </p>
              <p className="type-title-2 mt-1 tabular-nums text-[var(--ink,#101310)]">
                {Math.round(data.totals.loadMinutes / 60)} h
              </p>
            </Card>
            <Card className="p-4">
              <p className="type-eyebrow text-[var(--muted,#62685f)]">
                {t("dispatch.capacity.utilisation")}
              </p>
              <p className="type-title-2 mt-1 tabular-nums text-[var(--ink,#101310)]">
                {utilisation(
                  data.totals.capacityMinutes,
                  data.totals.loadMinutes,
                )}
                %
              </p>
            </Card>
          </section>

          {departments.length === 0 ? (
            <Card className="p-6 text-sm italic text-[var(--muted,#62685f)]">
              {t("dispatch.capacity.empty")}
            </Card>
          ) : (
            departments.map((department) => {
              const days = data.days.filter(
                (day) => day.departmentId === department.id,
              );
              return (
                <Card
                  as="section"
                  key={department.id}
                  aria-labelledby={`capacity-${department.id}`}
                  className="min-w-0 p-3 sm:p-4"
                >
                  <h2
                    id={`capacity-${department.id}`}
                    className="type-title-3 mb-2 flex items-center gap-2 text-[var(--ink,#101310)]"
                  >
                    <Icon
                      name="building"
                      className="h-4 w-4 text-[var(--muted,#62685f)]"
                    />
                    {department.name}
                  </h2>
                  <div
                    className="overflow-x-auto"
                    role="region"
                    tabIndex={0}
                    aria-label={t("dispatch.capacity.tableCaption", { name: department.name })}
                  >
                    <table className="w-full min-w-[38rem] border-collapse text-left text-xs">
                      <caption className="sr-only">
                        {t("dispatch.capacity.tableCaption", {
                          name: department.name,
                        })}
                      </caption>
                      <thead>
                        <tr className="border-b border-[var(--line,#dedcd1)] text-2xs uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                          <th scope="col" className="px-2 py-2">
                            {t("dispatch.capacity.date")}
                          </th>
                          <th scope="col" className="px-2 py-2">
                            {t("dispatch.capacity.technician")}
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            {t("dispatch.capacity.capacity")}
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            {t("dispatch.capacity.load")}
                          </th>
                          <th scope="col" className="px-2 py-2 text-right">
                            {t("dispatch.capacity.utilisationShort")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {days.flatMap((day) =>
                          day.technicians.length === 0
                            ? [
                                <tr
                                  key={`${day.date}-empty`}
                                  className="border-b border-[var(--line,#dedcd1)]"
                                >
                                  <td className="px-2 py-2 font-bold">
                                    {formatDay(day.date)}
                                  </td>
                                  <td
                                    colSpan={4}
                                    className="px-2 py-2 italic text-[var(--muted,#62685f)]"
                                  >
                                    {t("dispatch.capacity.noTechnicians")}
                                  </td>
                                </tr>,
                              ]
                            : day.technicians.map((person) => (
                                <tr
                                  key={`${day.date}-${person.id}`}
                                  className="border-b border-[var(--line,#dedcd1)] last:border-0"
                                >
                                  <td className="px-2 py-2 font-bold">
                                    {formatDay(day.date)}
                                  </td>
                                  <td className="px-2 py-2">{person.name}</td>
                                  <td className="px-2 py-2 text-right tabular-nums">
                                    {person.capacityMinutes} min
                                  </td>
                                  <td className="px-2 py-2 text-right tabular-nums">
                                    {person.loadMinutes} min
                                  </td>
                                  <td className="px-2 py-2 text-right tabular-nums">
                                    {utilisation(
                                      person.capacityMinutes,
                                      person.loadMinutes,
                                    )}
                                    %
                                  </td>
                                </tr>
                              )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })
          )}
        </>
      )}
    </CalendarShell>
  );
}
