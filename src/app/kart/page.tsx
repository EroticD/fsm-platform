import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import {
  addDaysUtc,
  formatDateLocalized,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { resolveDateRange, scheduledOverlapFilters } from "@/lib/date-range";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import prisma from "@/lib/prisma";
import WorkOrderMap from "@/components/WorkOrderMap";
import WorkOrderStatusLegend from "@/components/WorkOrderStatusLegend";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import IsoDateInput from "@/components/IsoDateInput";
import Icon from "@/components/icons";
import { cityCoordinates, offsetCityPoint } from "@/lib/map-coordinates";
import { effectiveAddress } from "@/lib/geocode";
import { getMapSettings } from "@/server/map-settings";
import { loadTechnicianMapLayer } from "@/lib/map-technician-layer";
import { geocodeMissingAction } from "./actions";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
  workOrderStatusColor,
} from "@/lib/work-order-status-colors";

type MapWorkOrder = {
  id: string;
  title: string;
  scheduledFor: Date | null;
  scheduledTo: Date | null;
  status: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  customer: {
    name: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
  } | null;
  technicians: { id: string; name: string | null }[];
};

const MAP_LIMIT = 500;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.kart") };
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{
    technician?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
    geokodet?: string | string[];
    geokodingsgjenstår?: string | string[];
    geokodingsfeil?: string | string[];
  }>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const mapSettings = await getMapSettings();
  const technicianLayer = await loadTechnicianMapLayer();
  const params = await searchParams;
  const canGeocode = hasPermission(user, "workorders.edit");
  const technicianId = (firstParam(params.technician) ?? "").trim();

  const today = parseDateOnly(todayInOslo());
  const defaultFrom = today ? toDateOnly(today) : todayInOslo();
  const defaultTo = today ? toDateOnly(addDaysUtc(today, 7)) : todayInOslo();
  const range = resolveDateRange({
    params: {
      from: firstParam(params.dateFrom),
      to: firstParam(params.dateTo),
    },
    defaultFrom,
    defaultTo,
  });
  const todayIso = todayInOslo();
  const fromIso = range.from ? toDateOnly(range.from) : "";
  const toIso = range.to ? toDateOnly(range.to) : "";
  const coversToday =
    (!fromIso || fromIso <= todayIso) && (!toIso || toIso >= todayIso);

  const technicians = await prisma.user.findMany({
    where: staffScope(user),
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true },
  });

  const filters: Prisma.WorkOrderWhereInput[] = [
    workOrderScope(user),
    { status: { not: "COMPLETED" } },
    { status: { not: "CANCELLED" } },
  ];
  if (technicianId) {
    filters.push({ technicians: { some: { id: technicianId } } });
  }
  if (range.invalid) {
    filters.push({ id: { in: [] } });
  } else {
    // Datofilteret følger visittene: en visitt som overlapper valgt periode
    // holder oppdraget synlig, også når oppdragets avledede dato er en annen.
    const visitRange: Prisma.VisitWhereInput = {
      status: { not: "CANCELLED" },
    };
    if (range.from) {
      visitRange.endsAt = {
        gt: osloDayStart(toDateOnly(range.from)),
      };
    }
    if (range.to) {
      visitRange.startsAt = {
        lt: osloDayStart(toDateOnly(addDaysUtc(range.to, 1))),
      };
    }

    filters.push({
      OR: [
        { visits: { some: visitRange } },
        {
          // Eldre oppdrag uten visitt bruker fortsatt oppdragets dato, slik
          // at backfill og historiske rader ikke forsvinner fra kartet.
          AND: [
            { visits: { none: {} } },
            ...scheduledOverlapFilters(range.from, range.to),
          ],
        },
      ],
    });
  }

  const where: Prisma.WorkOrderWhereInput = { AND: filters };

  const missingCoordinatesWhere: Prisma.WorkOrderWhereInput = {
    AND: [
      workOrderScope(user),
      { latitude: null },
      { longitude: null },
      { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      {
        OR: [
          { address: { not: null } },
          { postalCode: { not: null } },
          { city: { not: null } },
          { customer: { address: { not: null } } },
          { customer: { city: { not: null } } },
        ],
      },
    ],
  };

  const [totalCount, workOrders, missingCoordinates] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      select: {
        id: true,
        title: true,
        scheduledFor: true,
        scheduledTo: true,
        status: true,
        address: true,
        postalCode: true,
        city: true,
        latitude: true,
        longitude: true,
        customer: {
          select: { name: true, address: true, postalCode: true, city: true },
        },
        technicians: { select: { id: true, name: true } },
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
      take: MAP_LIMIT,
    }),
    prisma.workOrder.count({ where: missingCoordinatesWhere }),
  ]);

  const statusLabel = (status: string) => {
    const key = WORK_ORDER_STATUS_LABEL_KEYS[status as keyof typeof WORK_ORDER_STATUS_LABEL_KEYS];
    return key ? t(key) : status;
  };

  const statusCounts = new Map<string, number>();
  for (const workOrder of workOrders) {
    statusCounts.set(
      workOrder.status,
      (statusCounts.get(workOrder.status) ?? 0) + 1,
    );
  }
  const legendItems = WORK_ORDER_STATUS_ORDER.filter(
    (status) => status !== "COMPLETED" && status !== "CANCELLED",
  ).map((status) => ({
    status,
    label: statusLabel(status),
    count: statusCounts.get(status) ?? 0,
  }));

  const cityIndexes = new Map<string, number>();
  const mapPoints = workOrders.flatMap((workOrder) => {
    const city = workOrder.city?.trim() || workOrder.customer?.city?.trim();
    const exact =
      workOrder.latitude != null && workOrder.longitude != null
        ? { lat: workOrder.latitude, lng: workOrder.longitude }
        : null;
    const center = exact ?? cityCoordinates(city);
    if (!center) return [];
    const key = exact ? `exact:${workOrder.id}` : (city ?? "unknown");
    const index = cityIndexes.get(key) ?? 0;
    cityIndexes.set(key, index + 1);
    const point = exact ? center : offsetCityPoint(center, index);
    const location = effectiveAddress({
      address: workOrder.address,
      postalCode: workOrder.postalCode,
      city: workOrder.city,
      customer: workOrder.customer,
    });
    return [{
      id: workOrder.id,
      title: workOrder.title,
      href: `/oppdrag/${workOrder.id}`,
      customerName: workOrder.customer?.name || t("p3.map.noCustomer"),
      address: location.query ?? "",
      date: workOrder.scheduledFor
        ? formatDateLocalized(workOrder.scheduledFor, locale)
        : t("p3.map.noDate"),
      status: statusLabel(workOrder.status),
      color: workOrderStatusColor(workOrder.status),
      technicians:
        workOrder.technicians
          .map((technician) => technician.name)
          .filter(Boolean)
          .join(", ") || t("p3.map.noTechnician"),
      lat: point.lat,
      lng: point.lng,
    }];
  });

  const groups = new Map<string, MapWorkOrder[]>();
  for (const workOrder of workOrders) {
    const city =
      workOrder.city?.trim() ||
      workOrder.customer?.city?.trim() ||
      t("p3.map.unknownCity");
    const list = groups.get(city) ?? [];
    list.push(workOrder);
    groups.set(city, list);
  }

  return (
    <div className="office-app min-h-screen p-4 [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--ink,#101310)]">
              <Icon name="map" className="h-6 w-6 shrink-0" strokeWidth={2} />
              {t("p3.map.title")}
            </h1>
            <p className="text-sm text-[var(--muted,#62685f)]">{t("p3.map.description")}</p>
          </div>
          <Link
            href="/kalender"
            className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("p3.map.calendar")}
          </Link>
        </div>

        <form
          action="/kart"
          method="get"
          className="grid grid-cols-1 gap-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="flex flex-col gap-1 text-xs font-bold text-[var(--ink,#101310)]">
            {t("p3.map.filters.technician")}
            <select
              name="technician"
              defaultValue={technicianId}
              className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)]"
            >
              <option value="">{t("p3.map.filters.allTechnicians")}</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name || technician.id}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-[var(--ink,#101310)]">
            {t("p3.map.filters.dateFrom")}
            <IsoDateInput
              name="dateFrom"
              defaultValue={range.fromText}
              className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-[var(--ink,#101310)]">
            {t("p3.map.filters.dateTo")}
            <IsoDateInput
              name="dateTo"
              defaultValue={range.toText}
              className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)]"
            />
          </label>
          <button
            type="submit"
            className="signal-button self-end text-sm"
          >
            {t("p3.map.filters.apply")}
          </button>
          <Link
            href="/kart"
            className="inline-flex min-h-11 items-center justify-center self-end rounded-[10px] border border-[var(--line,#dedcd1)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("p3.map.filters.clear")}
          </Link>
        </form>

        {canGeocode && missingCoordinates > 0 && (
          <div className="office-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--ink,#101310)]">
                {t("p3.map.geocode.missing", { count: missingCoordinates })}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                {t("p3.map.geocode.hint")}
              </p>
            </div>
            <form action={geocodeMissingAction}>
              <button type="submit" className="signal-button text-sm">
                <Icon name="map" className="h-4 w-4" />
                {t("p3.map.geocode.action")}
              </button>
            </form>
          </div>
        )}

        {(firstParam(params.geokodet) || firstParam(params.geokodingsfeil)) && (
          <div
            role="status"
            className="office-card border-[var(--line,#dedcd1)] p-4 text-sm font-bold text-[var(--ink,#101310)]"
          >
            {firstParam(params.geokodingsfeil) === "rate"
              ? t("p3.map.geocode.rateLimited")
              : t("p3.map.geocode.result", {
                  count: Number(firstParam(params.geokodet) ?? 0),
                  remaining: Number(firstParam(params.geokodingsgjenstår) ?? 0),
                })}
          </div>
        )}

        {range.invalid && (
          <div
            role="alert"
            className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-4 text-sm font-bold text-[var(--risk-text,#b42318)]"
          >
            {range.invalidOrder
              ? t("p3.map.filters.dateRangeError")
              : t("p3.map.filters.dateError")}
          </div>
        )}

        <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-3">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]">
            {t(
              coversToday
                ? "orders.map.visitsToday"
                : "orders.map.visitsPeriod",
            )}
          </p>
          <p className="mt-1 text-xs font-medium text-[var(--muted,#62685f)]">
            {t("orders.map.visitsHint")}
          </p>
        </div>

        <p className="text-sm font-medium text-[var(--muted,#62685f)]">
          {t("p3.map.resultRange", {
            count: workOrders.length,
            total: totalCount,
          })}
        </p>
        {totalCount > workOrders.length && (
          <p className="rounded-xl border border-[var(--warning-border,#fde68a)] bg-[var(--warning-surface,#fffbeb)] p-3 text-sm text-[var(--warning,#b45309)]">
            {t("p3.map.truncated", { limit: MAP_LIMIT })}
          </p>
        )}

        <WorkOrderStatusLegend
          title={t("p3.map.legendTitle")}
          items={legendItems}
        />

        {/* Teknikerlaget er et bevisst integrasjonspunkt: kilden kommer i 5C. */}
        <section
          aria-labelledby="map-technicians-title"
          className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 sm:p-4"
        >
          <h2
            id="map-technicians-title"
            className="flex items-center gap-2 text-sm font-black text-[var(--ink,#101310)]"
          >
            <Icon name="users" className="h-4 w-4" />
            {t("p3.map.technicians.title")}
          </h2>
          <p className="mt-1 text-xs font-medium text-[var(--muted,#62685f)]">
            {technicianLayer.enabled && technicianLayer.markers.length > 0
              ? t("p3.map.technicians.active", {
                  count: technicianLayer.markers.length,
                })
              : t("p3.map.technicians.pending")}
          </p>
        </section>

        <section className="space-y-2 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 sm:p-4">
          <WorkOrderMap
            points={mapPoints}
            listId="map-order-list"
            listHint={t("p3.map.regionHint")}
            ariaLabel={t("p3.map.mapAria")}
            noPointsLabel={t("p3.map.noMapPoints")}
            openLabel={t("p3.map.openWorkOrder")}
            layerLabels={{
              osm: t("p3.map.layers.osm"),
              topo: t("p3.map.layers.topo"),
              light: t("p3.map.layers.light"),
              satellite: t("p3.map.layers.satellite"),
            }}
            settings={mapSettings}
          />
          <p className="px-1 text-xs text-[var(--muted,#62685f)]">{t("p3.map.mapHint")}</p>
        </section>

        <div id="map-order-list" className="space-y-5">
          {groups.size === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-10 text-center">
              <p className="text-sm text-[var(--muted,#62685f)]">{t("p3.map.empty")}</p>
            </div>
          ) : (
            Array.from(groups.entries()).map(([city, items]) => (
              <section
                key={city}
                className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-5"
              >
                <h2 className="mb-3 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-2 text-lg font-bold text-[var(--ink,#101310)]">
                  <Icon name="pin" className="h-4 w-4 shrink-0" strokeWidth={2} />
                  {city} ({items.length})
                </h2>
                <ul className="divide-y divide-[var(--line,#dedcd1)]">
                  {items.map((workOrder) => {
                    const customer = workOrder.customer;
                    const location = effectiveAddress({
                      address: workOrder.address,
                      postalCode: workOrder.postalCode,
                      city: workOrder.city,
                      customer,
                    });
                    const address = location.query ?? "";
                    return (
                      <li
                        key={workOrder.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div>
                          <Link
                            href={`/oppdrag/${workOrder.id}`}
                            className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:decoration-[var(--ink,#101310)]"
                          >
                            {workOrder.title}
                          </Link>
                          <p className="text-xs text-[var(--muted,#62685f)]">
                            {customer?.name || t("p3.map.noCustomer")}
                            {workOrder.scheduledFor
                              ? ` · ${formatDateLocalized(workOrder.scheduledFor, locale)}`
                              : ""}
                            <span className="ml-2 inline-flex items-center gap-1">
                              <span
                                aria-hidden="true"
                                className="h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: workOrderStatusColor(
                                    workOrder.status,
                                  ),
                                }}
                              />
                              {statusLabel(workOrder.status)}
                            </span>
                          </p>
                          {workOrder.technicians.length > 0 && (
                            <p className="flex items-center gap-1 text-xs text-[var(--muted,#62685f)]">
                              <Icon name="users" className="h-3.5 w-3.5 shrink-0" />
                              {workOrder.technicians
                                .map((technician) => technician.name)
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          )}
                          {address && (
                            <p className="text-xs text-[var(--muted,#62685f)]">{address}</p>
                          )}
                        </div>
                        <GoogleMapsLink
                          address={address}
                          label={t("p3.map.openMaps")}
                          newTabLabel={t("p3.map.opensInNewTab")}
                          className="font-bold text-[var(--ink,#101310)]! underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
