import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDate, parseDateOnly } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffWhere, workOrderScope } from "@/lib/access";
import prisma from "@/lib/prisma";
import WorkOrderMap from "@/components/WorkOrderMap";
import { cityCoordinates, offsetCityPoint } from "@/lib/map-coordinates";
import { effectiveAddress } from "@/lib/geocode";
import { getMapSettings } from "@/server/map-settings";

type MapWorkOrder = {
  id: string;
  title: string;
  scheduledFor: Date | null;
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
};

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{
    technician?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const mapSettings = await getMapSettings();
  const params = await searchParams;
  const technicianId = params.technician?.trim() ?? "";
  const dateFrom = parseDateOnly(params.dateFrom ?? "");
  const dateTo = parseDateOnly(params.dateTo ?? "");
  const technicians = await prisma.user.findMany({
    where: staffWhere(user.role === "ADMIN" ? undefined : user.departmentId),
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true },
  });

  const workOrders = (await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        { status: { notIn: ["COMPLETED", "CANCELLED"] } },
        ...(technicianId ? [{ technicians: { some: { id: technicianId } } }] : []),
        ...(dateFrom ? [{ scheduledFor: { gte: dateFrom } }] : []),
        ...(dateTo ? [{ scheduledFor: { lte: dateTo } }] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      scheduledFor: true,
      status: true,
      address: true,
      postalCode: true,
      city: true,
      latitude: true,
      longitude: true,
      customer: {
        select: { name: true, address: true, postalCode: true, city: true },
      },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    take: 1000,
  })) as MapWorkOrder[];

  const statusLabel = (status: string) => {
    const keys: Record<string, string> = {
      OPEN: "orders.detail.statusOpen",
      PENDING: "orders.detail.statusPending",
      PLANNED: "orders.detail.statusPlanned",
      WAITING: "orders.detail.statusWaiting",
      IN_PROGRESS: "orders.detail.statusInProgress",
      COMPLETED: "orders.detail.statusCompleted",
      CANCELLED: "orders.detail.statusCancelled",
    };
    return keys[status] ? t(keys[status]) : status;
  };

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
        ? formatDate(workOrder.scheduledFor)
        : t("p3.map.noDate"),
      status: statusLabel(workOrder.status),
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
            defaultValue={params.dateFrom ?? ""}
            className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
          {t("p3.map.filters.dateTo")}
          <input
            type="date"
            name="dateTo"
            defaultValue={params.dateTo ?? ""}
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

      <section className="space-y-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:p-4">
        <WorkOrderMap
          points={mapPoints}
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
      </section>

      {groups.size === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm text-gray-600">{t("p3.map.empty")}</p>
        </div>
      ) : (
        Array.from(groups.entries()).map(([city, items]) => (
          <section key={city} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
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
                const mapsUrl = address
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
                  : null;
                return (
                  <li key={workOrder.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <Link href={`/oppdrag/${workOrder.id}`} className="font-bold text-gray-900 hover:underline">
                        {workOrder.title}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {customer?.name || t("p3.map.noCustomer")}
                        {workOrder.scheduledFor ? ` · ${formatDate(workOrder.scheduledFor)}` : ""}
                      </p>
                      {address && <p className="text-xs text-gray-500">{address}</p>}
                    </div>
                    {mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                      >
                        {t("p3.map.openMaps")}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
