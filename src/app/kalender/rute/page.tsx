import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import CalendarShell from "@/app/kalender/CalendarShell";
import IsoDateInput from "@/components/IsoDateInput";
import WorkOrderMap from "@/components/WorkOrderMap";
import Icon from "@/components/icons";
import { formatDateLocalized, formatDateTimeLocalized, todayInOslo } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope } from "@/lib/access";
import prisma from "@/lib/prisma";
import { getMapSettings } from "@/server/map-settings";
import {
  getRoutePlan,
  ROUTE_ERROR_CODES,
  type RouteSkippedReason,
} from "@/server/route-plan";
import { VISIT_STATUS_LABEL_KEYS } from "@/lib/visit-status";
import { applyRouteOrderAction } from "./actions";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.rute") };
}

const SKIPPED_KEYS: Record<RouteSkippedReason, string> = {
  missing_coordinates: "calendar.route.skippedMissingCoordinates",
  outside_time_window: "calendar.route.skippedOutsideWindow",
  limit: "calendar.route.skippedLimit",
};

const ERROR_KEYS: Record<string, string> = {
  [ROUTE_ERROR_CODES.invalid]: "calendar.route.errors.invalid",
  [ROUTE_ERROR_CODES.forbidden]: "calendar.route.errors.forbidden",
  [ROUTE_ERROR_CODES.notFound]: "calendar.route.errors.notFound",
  [ROUTE_ERROR_CODES.conflict]: "calendar.route.errors.conflict",
  [ROUTE_ERROR_CODES.absence]: "calendar.route.errors.absence",
  [ROUTE_ERROR_CODES.overlap]: "calendar.route.errors.overlap",
  [ROUTE_ERROR_CODES.orderMismatch]: "calendar.route.errors.orderMismatch",
  [ROUTE_ERROR_CODES.applyFailed]: "calendar.route.errors.applyFailed",
  forbidden: "calendar.route.errors.forbidden",
};

/**
 * Dagens rute per montør. Siden beregner på nytt ved hvert sidevisning og
 * lagrer ingen plan. Kontoret kan bruke rekkefølgen eksplisitt; da flyttes
 * visittene i én transaksjon med revisjonsspor.
 */
export default async function RoutePage({
  searchParams,
}: {
  searchParams: Promise<{
    dato?: string | string[];
    tekniker?: string | string[];
    anvendt?: string | string[];
    feil?: string | string[];
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.assign")) redirect("/kalender");

  const params = await searchParams;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const date = firstParam(params.dato) || todayInOslo();
  const technicianId = (firstParam(params.tekniker) ?? "").trim();
  const applied = firstParam(params.anvendt);
  const error = firstParam(params.feil);

  const [plan, technicians, mapSettings] = await Promise.all([
    getRoutePlan(user, { date, technicianId: technicianId || undefined }),
    prisma.user.findMany({
      where: staffScope(user),
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 200,
    }),
    getMapSettings(),
  ]);

  const planData = plan.ok ? plan.data : null;
  const planFailureKey = !plan.ok
    ? plan.reason === "forbidden"
      ? "calendar.route.errors.forbidden"
      : plan.reason === "invalid"
        ? "calendar.route.errors.invalid"
        : "calendar.route.errors.notFound"
    : null;
  const canReports = hasPermission(user, "reports.view");
  const canCreate = hasPermission(user, "workorders.create");
  const periodLabel = formatDateLocalized(date, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <CalendarShell
      active="route"
      canDispatch
      canReports={canReports}
      subtitle={t("calendar.route.subtitle")}
      periodLabel={periodLabel}
      canCreate={canCreate}
      newWorkOrderHref="/oppdrag/ny"
    >
      <form
        action="/kalender/rute"
        method="get"
        className="office-card grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4"
        aria-label={t("calendar.route.filters")}
      >
        <label className="flex min-w-0 flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
          {t("calendar.route.date")}
          <IsoDateInput
            name="dato"
            defaultValue={date}
            className="min-h-10 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
          {t("calendar.route.technician")}
          <select
            name="tekniker"
            defaultValue={technicianId}
            className="min-h-10 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          >
            <option value="">{t("calendar.route.allTechnicians")}</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.name ?? t("calendar.filters.unnamedTechnician")}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2 lg:col-span-2">
          <button
            type="submit"
            className="signal-button min-h-10 text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]"
          >
            <Icon name="search" className="h-4 w-4" />
            {t("calendar.route.show")}
          </button>
          <Link
            href="/kalender/dispatch"
            className="min-h-10 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
          >
            {t("calendar.route.backToDispatch")}
          </Link>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-4 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(ERROR_KEYS[error] ?? "calendar.route.errors.unknown")}
        </div>
      )}

      {applied !== undefined && (
        <div
          role="status"
          className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4 text-sm font-bold text-[var(--ink,#101310)]"
        >
          {t("calendar.route.applied", { count: Number(applied) || 0 })}
        </div>
      )}

      {!plan.ok && planFailureKey && (
        <div className="office-card p-6 text-sm font-bold text-[var(--risk-text,#b42318)]">
          {t(planFailureKey)}
        </div>
      )}

      {planData && planData.plans.length === 0 && (
        <div className="office-card p-8 text-center">
          <p className="text-sm font-medium text-[var(--muted,#62685f)]">
            {t("calendar.route.empty")}
          </p>
        </div>
      )}

      {planData?.plans.map((technicianPlan) => {
        const points = technicianPlan.stops.map((stop) => ({
          id: stop.visitId,
          title: `${stop.sequence}. ${stop.workOrderTitle}`,
          href: `/oppdrag/${stop.workOrderId}`,
          customerName: stop.customerName ?? t("calendar.common.noCustomer"),
          address: stop.address,
          date: formatDateTimeLocalized(stop.startsAt, locale),
          status: t(VISIT_STATUS_LABEL_KEYS[stop.status]),
          color: "#d8ff3e",
          technicians: "",
          lat: stop.point.latitude,
          lng: stop.point.longitude,
        }));
        const routePath = points.map((point) => ({
          lat: point.lat,
          lng: point.lng,
        }));

        return (
          <section
            key={technicianPlan.technicianId}
            aria-labelledby={`route-${technicianPlan.technicianId}`}
            className="office-card space-y-4 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
                  {t("calendar.route.eyebrow")}
                </p>
                <h2
                  id={`route-${technicianPlan.technicianId}`}
                  className="text-lg font-black tracking-tight text-[var(--ink,#101310)]"
                >
                  {technicianPlan.technicianName}
                </h2>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("calendar.route.totalDrive")}
                  </dt>
                  <dd className="font-black tabular-nums text-[var(--ink,#101310)]">
                    {t("calendar.route.minutes", {
                      count: technicianPlan.totalTravelMinutes,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("calendar.route.totalDistance")}
                  </dt>
                  <dd className="font-black tabular-nums text-[var(--ink,#101310)]">
                    {t("calendar.route.km", {
                      count: Math.round(technicianPlan.totalDistanceKm),
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("calendar.route.totalWaiting")}
                  </dt>
                  <dd className="font-black tabular-nums text-[var(--ink,#101310)]">
                    {t("calendar.route.minutes", {
                      count: technicianPlan.totalWaitingMinutes,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("calendar.route.provider")}
                  </dt>
                  <dd className="font-black text-[var(--ink,#101310)]">
                    {technicianPlan.provider === "osrm"
                      ? t("calendar.route.providerOsrm")
                      : t("calendar.route.providerLocal")}
                  </dd>
                </div>
              </dl>
            </div>

            {technicianPlan.fallbackUsed && (
              <p className="rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-xs font-medium text-[var(--muted,#62685f)]">
                {t("calendar.route.fallback")}
              </p>
            )}

            {technicianPlan.stops.length > 0 && (
              <>
                <WorkOrderMap
                  points={points}
                  routePath={routePath}
                  listId={`route-list-${technicianPlan.technicianId}`}
                  listHint={t("calendar.route.mapHint")}
                  ariaLabel={t("calendar.route.mapAria", {
                    name: technicianPlan.technicianName,
                  })}
                  noPointsLabel={t("calendar.route.empty")}
                  openLabel={t("calendar.route.openWorkOrder")}
                  layerLabels={{
                    osm: t("p3.map.layers.osm"),
                    topo: t("p3.map.layers.topo"),
                    light: t("p3.map.layers.light"),
                    satellite: t("p3.map.layers.satellite"),
                  }}
                  settings={mapSettings}
                />

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                    <caption className="sr-only">
                      {t("calendar.route.tableCaption", {
                        name: technicianPlan.technicianName,
                      })}
                    </caption>
                    <thead>
                      <tr className="border-b border-[var(--line,#dedcd1)] text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                        <th scope="col" className="px-2 py-2">
                          {t("calendar.route.stop")}
                        </th>
                        <th scope="col" className="px-2 py-2">
                          {t("calendar.route.eta")}
                        </th>
                        <th scope="col" className="px-2 py-2">
                          {t("calendar.route.planned")}
                        </th>
                        <th scope="col" className="px-2 py-2">
                          {t("calendar.route.travel")}
                        </th>
                        <th scope="col" className="px-2 py-2">
                          {t("calendar.route.wait")}
                        </th>
                        <th scope="col" className="px-2 py-2">
                          {t("calendar.route.workOrder")}
                        </th>
                      </tr>
                    </thead>
                    <tbody id={`route-list-${technicianPlan.technicianId}`}>
                      {technicianPlan.stops.map((stop) => (
                        <tr
                          key={stop.visitId}
                          className="border-b border-[var(--line,#dedcd1)] align-top last:border-0"
                        >
                          <th scope="row" className="px-2 py-3 text-left">
                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-2 text-xs font-black tabular-nums text-[var(--ink,#101310)]">
                              {stop.sequence}
                            </span>
                          </th>
                          <td className="px-2 py-3 font-bold tabular-nums text-[var(--ink,#101310)]">
                            {formatDateTimeLocalized(stop.startsAt, locale)}
                          </td>
                          <td className="px-2 py-3 text-[var(--muted,#62685f)]">
                            {formatDateTimeLocalized(stop.plannedStartsAt, locale)}
                          </td>
                          <td className="px-2 py-3 tabular-nums text-[var(--muted,#62685f)]">
                            {t("calendar.route.minutes", {
                              count: stop.travelMinutes,
                            })}
                            <span className="block text-xs">
                              {t("calendar.route.km", {
                                count: Math.round(stop.distanceKm),
                              })}
                            </span>
                          </td>
                          <td className="px-2 py-3 tabular-nums text-[var(--muted,#62685f)]">
                            {t("calendar.route.minutes", {
                              count: stop.waitMinutes,
                            })}
                          </td>
                          <td className="px-2 py-3">
                            <Link
                              href={`/oppdrag/${stop.workOrderId}`}
                              className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:decoration-[var(--ink,#101310)]"
                            >
                              {stop.workOrderTitle}
                            </Link>
                            <span className="mt-1 block text-xs text-[var(--muted,#62685f)]">
                              {stop.customerName ?? t("calendar.common.noCustomer")}
                              {stop.address ? ` · ${stop.address}` : ""}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <form action={applyRouteOrderAction} className="flex flex-wrap items-center gap-3 border-t border-[var(--line,#dedcd1)] pt-3">
                  <input type="hidden" name="dato" value={date} />
                  <input type="hidden" name="tekniker" value={technicianPlan.technicianId} />
                  {technicianPlan.stops.map((stop) => (
                    <input
                      key={stop.visitId}
                      type="hidden"
                      name="visitId"
                      value={stop.visitId}
                    />
                  ))}
                  <button
                    type="submit"
                    className="signal-button min-h-10 text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]"
                  >
                    <Icon name="check" className="h-4 w-4" />
                    {t("calendar.route.applyOrder")}
                  </button>
                  <p className="max-w-xl text-xs leading-5 text-[var(--muted,#62685f)]">
                    {t("calendar.route.applyHint")}
                  </p>
                </form>
              </>
            )}

            {technicianPlan.skipped.length > 0 && (
              <div className="rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
                <h3 className="text-xs font-black uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  {t("calendar.route.skippedTitle")}
                </h3>
                <ul className="mt-2 space-y-1 text-xs text-[var(--muted,#62685f)]">
                  {technicianPlan.skipped.map((row) => (
                    <li key={`${row.visitId}-${row.reason}`}>
                      <Link
                        href={`/oppdrag/${row.workOrderId}`}
                        className="font-bold text-[var(--ink,#101310)] hover:underline"
                      >
                        {row.workOrderTitle}
                      </Link>{" "}
                      – {t(SKIPPED_KEYS[row.reason])}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </CalendarShell>
  );
}
