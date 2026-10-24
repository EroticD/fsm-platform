import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { formatDate } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");

  const t = await getTranslations("common");

  const { q, cursor: rawCursor } = await searchParams;
  const search = q?.trim() || "";
  const cursor = rawCursor?.trim() || "";

  const searchWhere: Prisma.ProductWhereInput = search
    ? {
        OR: [
          { model: { contains: search, mode: "insensitive" } },
          { serialNumber: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
        ],
      }
    : {};

  // Stabil cursor-paginering: kundenavn, modell og id gir en deterministisk
  // rekkefølge også når flere enheter heter det samme.
  const [unitRows, total, serviced, withDeviation, customerCount] = await Promise.all([
    prisma.product.findMany({
      where: searchWhere,
      orderBy: [{ customer: { name: "asc" } }, { model: "asc" }, { id: "asc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        model: true,
        serialNumber: true,
        location: true,
        customer: { select: { id: true, name: true, city: true } },
      },
    }),
    prisma.product.count({ where: searchWhere }),
    prisma.product.count({
      where: { AND: [searchWhere, { reportUnits: { some: {} } }] },
    }),
    prisma.product.count({
      where: { AND: [searchWhere, { reportUnits: { some: { status: "AVVIK" } } }] },
    }),
    prisma.customer.count(),
  ]);

  const hasMore = unitRows.length > PAGE_SIZE;
  const units = hasMore ? unitRows.slice(0, PAGE_SIZE) : unitRows;
  const nextCursor = hasMore ? units[units.length - 1]?.id : undefined;

  // Servicehistorikken hentes som aggregater for siden, ikke som alle
  // ReportUnit-radene. Det holder listespørringen liten.
  const historyByProduct = new Map<
    string,
    { services: number; deviations: number; last: Date | null }
  >();
  if (units.length > 0) {
    const historyGroups = await prisma.reportUnit.groupBy({
      by: ["productId", "status"],
      where: { productId: { in: units.map((unit) => unit.id) } },
      orderBy: [{ productId: "asc" }, { status: "asc" }],
      _count: { _all: true },
      _max: { createdAt: true },
      take: 500,
    });
    for (const group of historyGroups) {
      if (!group.productId) continue;
      const current = historyByProduct.get(group.productId) ?? {
        services: 0,
        deviations: 0,
        last: null,
      };
      current.services += group._count._all;
      if (group.status === "AVVIK") current.deviations += group._count._all;
      if (group._max.createdAt && (!current.last || group._max.createdAt > current.last)) {
        current.last = group._max.createdAt;
      }
      historyByProduct.set(group.productId, current);
    }
  }

  const linkFor = (next: string | null) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (next) params.set("cursor", next);
    const qs = params.toString();
    return `/enheter${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">{t("equipment.list.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              {t("equipment.list.subtitle")} •{" "}
              <span className="font-bold text-gray-700">
                {t("equipment.list.summary", {
                  units: total,
                  customers: customerCount,
                })}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              ← {t("equipment.list.dashboard")}
            </Link>
            <Link
              href="/kunder"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              🏢 {t("equipment.list.customers")}
            </Link>
          </div>
        </div>

        {/* SAMMENDRAG + SØK */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{t("equipment.list.units")}</p>
              <p className="text-xl font-black text-gray-900">{total}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-green-700">{t("equipment.list.withHistory")}</p>
              <p className="text-xl font-black text-green-800">{serviced}</p>
            </div>
            <div
              className={`rounded-xl px-3 py-2 border ${
                withDeviation > 0 ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"
              }`}
            >
              <p
                className={`text-[10px] font-bold uppercase tracking-wide ${
                  withDeviation > 0 ? "text-red-700" : "text-gray-500"
                }`}
              >
                {t("equipment.list.withDeviation")}
              </p>
              <p className={`text-xl font-black ${withDeviation > 0 ? "text-red-800" : "text-gray-900"}`}>
                {withDeviation}
              </p>
            </div>
          </div>

          <form method="GET" action="/enheter" className="flex flex-wrap gap-2">
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder={t("equipment.list.searchPlaceholder")}
              className="flex-1 min-w-[14rem] border-2 border-gray-200 p-2.5 rounded-xl text-sm font-medium text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
            />
            <button
              type="submit"
              className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition"
            >
              {t("equipment.list.search")}
            </button>
            {search ? (
              <Link
                href="/enheter"
                className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
              >
                {t("equipment.list.reset")}
              </Link>
            ) : null}
          </form>
          {search ? (
            <p className="text-[11px] text-gray-500 font-bold">
              {t("equipment.list.hits", { total, query: search })}
            </p>
          ) : null}
        </div>

        {/* LISTE */}
        {units.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">
              {search
                ? t("equipment.list.noMatches", { query: search })
                : t("equipment.list.empty")}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {t("equipment.list.emptyHint")}
            </p>
            <Link
              href="/kunder"
              className="inline-block mt-3 bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition"
            >
              🏢 {t("equipment.list.goToCustomers")}
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {units.map((unit) => {
              const history = historyByProduct.get(unit.id);
              const services = history?.services ?? 0;
              const deviations = history?.deviations ?? 0;
              const last = history?.last ?? null;
              return (
                <Link
                  key={unit.id}
                  href={`/kunder/${unit.customer.id}?tab=enheter`}
                  className="block bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 truncate">🔧 {unit.model}</p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        🏢 {unit.customer.name}
                        {unit.customer.city ? ` (${unit.customer.city})` : ""}
                        {unit.serialNumber ? ` • #️⃣ ${unit.serialNumber}` : ""}
                        {unit.location ? ` • 📍 ${unit.location}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {services > 0 ? (
                        <span
                          className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                            deviations > 0
                              ? "bg-red-50 text-red-800 border-red-200"
                              : "bg-green-50 text-green-800 border-green-200"
                          }`}
                        >
                          {deviations > 0
                            ? `❌ ${t("equipment.list.deviations", { count: deviations })}`
                            : `✅ ${t("equipment.list.serviceCount", { count: services })}`}
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold px-2 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                          {t("equipment.list.neverChecked")}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2 font-bold">
                    🕓 {t("equipment.list.serviceCount", { count: services })} •{" "}
                    {t("equipment.list.lastService", {
                      date: formatDate(last, t("equipment.list.never")),
                    })}
                  </p>
                </Link>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-bold">
          {cursor && (
            <Link
              href={linkFor(null)}
              className="text-blue-700 bg-white border-2 border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-100 transition"
            >
              &larr; {t("equipment.list.firstPage")}
            </Link>
          )}
          {hasMore && nextCursor && (
            <Link
              href={linkFor(nextCursor)}
              className="text-white bg-blue-700 hover:bg-blue-800 transition px-4 py-2 rounded-xl"
            >
              {t("equipment.list.showMore")} &rarr;
            </Link>
          )}
        </div>
        <p className="text-center text-xs text-gray-500">
          {t("equipment.list.showing", { shown: units.length, total })}
        </p>
      </div>
    </div>
  );
}
