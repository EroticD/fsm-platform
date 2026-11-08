import { requireModulePage } from "@/lib/module-guards";
import { statusKeysByCategory } from "@/lib/work-order-status";
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
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { Field, Select } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import { brandInset } from "@/components/ui/brandStyles";
import { controlClassName } from "@/components/ui/controlStyles";
import { cityCoordinates, offsetCityPoint } from "@/lib/map-coordinates";
import { effectiveAddress } from "@/lib/geocode";
import { getMapSettings } from "@/server/map-settings";
import { loadTechnicianMapLayer } from "@/lib/map-technician-layer";
import { geocodeMissingAction } from "./actions";
import { moduleEnabled } from "@/server/modules";
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
const FIELD = controlClassName("min-h-11 text-sm");

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
  await requireModulePage("map");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const mapSettings = await getMapSettings();
  const technicianLayer = (await moduleEnabled("tracking"))
    ? await loadTechnicianMapLayer(user)
    : { enabled: false, markers: [] };
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
      { status: { notIn: statusKeysByCategory("CLOSED") } },
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

  const technicianMapPoints = technicianLayer.markers.map((marker) => ({
    id: marker.visitId,
    name: marker.name || t("p3.map.noTechnician"),
    status: marker.status,
    updatedAt:
      formatDateLocalized(marker.updatedAt, locale, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }) || "",
    lat: marker.point.latitude,
    lng: marker.point.longitude,
  }));

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
    <PageShell>
      <PageHeader
        title={t("p3.map.title")}
        subtitle={t("p3.map.description")}
        icon={<Icon name="map" className="h-6 w-6" strokeWidth={2} />}
        actions={
          <Link
            href="/kalender"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {t("p3.map.calendar")}
          </Link>
        }
      />

      <Card as="section" className="p-4">
        <form
          action="/kart"
          method="get"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <Field id="map-technician" label={t("p3.map.filters.technician")}>
            <Select
              id="map-technician"
              name="technician"
              defaultValue={technicianId}
            >
              <option value="">{t("p3.map.filters.allTechnicians")}</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name || technician.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="map-date-from" label={t("p3.map.filters.dateFrom")}>
            <IsoDateInput
              id="map-date-from"
              name="dateFrom"
              defaultValue={range.fromText}
              className={FIELD}
            />
          </Field>
          <Field id="map-date-to" label={t("p3.map.filters.dateTo")}>
            <IsoDateInput
              id="map-date-to"
              name="dateTo"
              defaultValue={range.toText}
              className={FIELD}
            />
          </Field>
          <button
            type="submit"
            className={`${buttonClassName({ variant: "primary" })} self-end`}
          >
            {t("p3.map.filters.apply")}
          </button>
          <Link
            href="/kart"
            className={`${buttonClassName({ variant: "secondary" })} self-end`}
          >
            {t("p3.map.filters.clear")}
          </Link>
        </form>
      </Card>

      {canGeocode && missingCoordinates > 0 && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {t("p3.map.geocode.missing", { count: missingCoordinates })}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t("p3.map.geocode.hint")}
            </p>
          </div>
          <form action={geocodeMissingAction}>
            <button
              type="submit"
              className={buttonClassName({ variant: "primary" })}
            >
              <Icon name="map" className="h-4 w-4" />
              {t("p3.map.geocode.action")}
            </button>
          </form>
        </Card>
      )}

      {(firstParam(params.geokodet) || firstParam(params.geokodingsfeil)) && (
        <div
          role="status"
          className={`${brandInset} p-4 text-sm font-bold text-ink`}
        >
          {(() => {
            const failure = firstParam(params.geokodingsfeil);
            const count = Number(firstParam(params.geokodet) ?? 0);
            const remaining = Number(firstParam(params.geokodingsgjenstår) ?? 0);
            if (failure === "rate") return t("p3.map.geocode.rateLimited");
            if (failure === "unavailable" || failure === "timeout") {
              return t(
                failure === "timeout"
                  ? "p3.map.geocode.timeout"
                  : "p3.map.geocode.unavailable",
              );
            }
            if (failure === "disabled") return t("p3.map.geocode.disabled");
            if (failure === "no_result") return t("p3.map.geocode.noResult");
            return t("p3.map.geocode.result", { count, remaining });
          })()}
        </div>
      )}

      <ErrorBanner
        message={
          range.invalid
            ? range.invalidOrder
              ? t("p3.map.filters.dateRangeError")
              : t("p3.map.filters.dateError")
            : undefined
        }
      />

      <div className={`${brandInset} px-4 py-3`}>
        <p className="type-eyebrow text-ink">
          {t(
            coversToday
              ? "orders.map.visitsToday"
              : "orders.map.visitsPeriod",
          )}
        </p>
        <p className="mt-1 text-xs font-medium text-muted">
          {t("orders.map.visitsHint")}
        </p>
      </div>

      <p className="text-sm font-medium text-muted">
        {t("p3.map.resultRange", {
          count: workOrders.length,
          total: totalCount,
        })}
      </p>
      {totalCount > workOrders.length && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] p-3 text-sm text-[var(--warning-text,#7a4f0c)]">
          {t("p3.map.truncated", { limit: MAP_LIMIT })}
        </p>
      )}

      <WorkOrderStatusLegend
        title={t("p3.map.legendTitle")}
        items={legendItems}
      />

      {/* Teknikerlaget er et bevisst integrasjonspunkt: kilden kommer i 5C. */}
      <Card
        as="section"
        aria-labelledby="map-technicians-title"
        className="p-3 sm:p-4"
      >
        <h2
          id="map-technicians-title"
          className="flex items-center gap-2 text-sm font-black text-ink"
        >
          <Icon name="users" className="h-4 w-4" />
          {t("p3.map.technicians.title")}
        </h2>
        <p className="mt-1 text-xs font-medium text-muted">
          {technicianLayer.enabled && technicianLayer.markers.length > 0
            ? t("p3.map.technicians.active", {
                count: technicianLayer.markers.length,
              })
            : t("p3.map.technicians.pending")}
        </p>
      </Card>

      <Card as="section" className="space-y-2 p-3 sm:p-4">
        <WorkOrderMap
          points={mapPoints}
          technicians={technicianMapPoints}
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
        <p className="px-1 text-xs text-muted">{t("p3.map.mapHint")}</p>
      </Card>

      <div id="map-order-list" className="space-y-5">
        {groups.size === 0 ? (
          <EmptyState
            icon={<Icon name="pin" className="h-6 w-6" />}
            title={t("p3.map.empty")}
          />
        ) : (
          Array.from(groups.entries()).map(([city, items]) => (
            <Card key={city} as="section" className="p-4 sm:p-5">
              <h2 className="mb-3 flex items-center gap-2 border-b border-line pb-2 text-lg font-bold text-ink">
                <Icon name="pin" className="h-4 w-4 shrink-0" strokeWidth={2} />
                {city} ({items.length})
              </h2>
              <ul className="divide-y divide-line">
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
                          className="font-bold text-ink underline decoration-signal decoration-2 underline-offset-4 hover:decoration-ink"
                        >
                          {workOrder.title}
                        </Link>
                        <p className="text-xs text-muted">
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
                          <p className="flex items-center gap-1 text-xs text-muted">
                            <Icon name="users" className="h-3.5 w-3.5 shrink-0" />
                            {workOrder.technicians
                              .map((technician) => technician.name)
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {address && (
                          <p className="text-xs text-muted">{address}</p>
                        )}
                      </div>
                      <GoogleMapsLink
                        address={address}
                        label={t("p3.map.openMaps")}
                        newTabLabel={t("p3.map.opensInNewTab")}
                        className="font-bold text-ink underline decoration-signal decoration-2 underline-offset-4"
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))
        )}
      </div>
    </PageShell>
  );
}
