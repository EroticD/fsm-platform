import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import {
  addDaysUtc,
  formatDateLocalized,
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
import { cityCoordinates, offsetCityPoint } from "@/lib/map-coordinates";
import { effectiveAddress } from "@/lib/geocode";
import { getMapSettings } from "@/server/map-settings";
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

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{
    technician?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
  }>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const mapSettings = await getMapSettings();
  const params = await searchParams;
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
    filters.push(...scheduledOverlapFilters(range.from, range.to));
  }

  const where: Prisma.WorkOrderWhereInput = { AND: filters };

  const [totalCount, workOrders] = await Promise.all([
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
    <div className="mx-auto min-h-screen max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🗺️ {t("p3.map.title")}</h1>
          <p className="text-sm text-gray-600">{t("p3.map.description")}</p>
        </div>
        <Link
          href="/kalender"
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          {t("p3.map.calendar")}
        </Link>
      </div>

      <form
        action="/kart"
        method="get"
        className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
          {t("p3.map.filters.technician")}
          <select
            name="technician"
            defaultValue={technicianId}
            className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <option value="">{t("p3.map.filters.allTechnicians")}</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.name || technician.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
          {t("p3.map.filters.dateFrom")}
          <input
            type="date"
            name="dateFrom"
            defaultValue={range.fromText}
            className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
          {t("p3.map.filters.dateTo")}
          <input
            type="date"
            name="dateTo"
            defaultValue={range.toText}
            className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 self-end rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
        >
          {t("p3.map.filters.apply")}
        </button>
        <Link
          href="/kart"
          className="inline-flex min-h-11 self-end items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          {t("p3.map.filters.clear")}
        </Link>
      </form>

      {range.invalid && (
        <div
          role="alert"
          className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"
        >
          {range.invalidOrder
            ? t("p3.map.filters.dateRangeError")
            : t("p3.map.filters.dateError")}
        </div>
      )}

      <p className="text-sm font-medium text-gray-700">
        {t("p3.map.resultRange", {
          count: workOrders.length,
          total: totalCount,
        })}
      </p>
      {totalCount > workOrders.length && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t("p3.map.truncated", { limit: MAP_LIMIT })}
        </p>
      )}

      <WorkOrderStatusLegend
        title={t("p3.map.legendTitle")}
        items={legendItems}
      />

      <section className="space-y-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:p-4">
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
        <p className="px-1 text-xs text-gray-600">{t("p3.map.mapHint")}</p>
      </section>

      <div id="map-order-list" className="space-y-5">
        {groups.size === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <p className="text-sm text-gray-600">{t("p3.map.empty")}</p>
          </div>
        ) : (
          Array.from(groups.entries()).map(([city, items]) => (
            <section
              key={city}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <h2 className="mb-3 border-b border-gray-100 pb-2 text-lg font-bold text-gray-900">
                📍 {city} ({items.length})
              </h2>
              <ul className="divide-y divide-gray-100">
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
                          className="font-bold text-gray-900 hover:underline"
                        >
                          {workOrder.title}
                        </Link>
                        <p className="text-xs text-gray-500">
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
                          <p className="text-xs text-gray-500">
                            👷{" "}
                            {workOrder.technicians
                              .map((technician) => technician.name)
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {address && (
                          <p className="text-xs text-gray-500">{address}</p>
                        )}
                      </div>
                      <GoogleMapsLink
                        address={address}
                        label={t("p3.map.openMaps")}
                        newTabLabel={t("p3.map.opensInNewTab")}
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
  );
}
