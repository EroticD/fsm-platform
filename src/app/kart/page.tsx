import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import prisma from "@/lib/prisma";

type MapWorkOrder = {
  id: string;
  title: string;
  scheduledFor: Date | null;
  customer: {
    name: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
  } | null;
};

export default async function MapPage() {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const workOrders = (await prisma.workOrder.findMany({
    where: {
      AND: [workOrderScope(user), { scheduledFor: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      scheduledFor: true,
      customer: {
        select: { name: true, address: true, postalCode: true, city: true },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 200,
  })) as MapWorkOrder[];

  const groups = new Map<string, MapWorkOrder[]>();
  for (const workOrder of workOrders) {
    const city = workOrder.customer?.city?.trim() || t("p3.map.unknownCity");
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
                const address = customer
                  ? [customer.address, customer.postalCode, customer.city]
                      .filter(Boolean)
                      .join(", ")
                  : "";
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
