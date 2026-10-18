import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function formatDate(value: Date | string | null | undefined) {
  return value
    ? new Date(value).toLocaleDateString("no-NO", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Aldri";
}

type UnitWithHistory = Prisma.ProductGetPayload<{
  include: {
    customer: { select: { id: true; name: true; city: true } };
    reportUnits: { select: { id: true; status: true; createdAt: true } };
  };
}>;

/** Datoen for den nyeste servicen på en enhet (eller null hvis den aldri er kontrollert). */
function lastServiceDate(unit: UnitWithHistory): Date | null {
  if (unit.reportUnits.length === 0) return null;
  return unit.reportUnits.reduce<Date | null>((latest, ru) => {
    const created = new Date(ru.createdAt);
    return !latest || created > latest ? created : latest;
  }, null);
}

function deviationCount(unit: UnitWithHistory) {
  return unit.reportUnits.filter((ru) => ru.status === "AVVIK").length;
}

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role === "TECHNICIAN") redirect("/mine-oppdrag");

  const { q } = await searchParams;
  const search = q?.trim() || "";

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

  const [units, total, serviced, withDeviation, customerCount] = await Promise.all([
    prisma.product.findMany({
      where: searchWhere,
      orderBy: [{ customer: { name: "asc" } }, { model: "asc" }],
      take: 200,
      include: {
        customer: { select: { id: true, name: true, city: true } },
        reportUnits: { select: { id: true, status: true, createdAt: true } },
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">🔧 Utstyr &amp; enheter</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              Alle registrerte enheter hos kundene •{" "}
              <span className="font-bold text-gray-700">
                {total} enhet{total === 1 ? "" : "er"} hos {customerCount} kunder
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              ← Dashbord
            </Link>
            <Link
              href="/kunder"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              🏢 Kunder
            </Link>
          </div>
        </div>

        {/* SAMMENDRAG + SØK */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Enheter</p>
              <p className="text-xl font-black text-gray-900">{total}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-green-700">Har servicehistorikk</p>
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
                Med avvik
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
              placeholder="Søk på modell, serienummer, plassering eller kunde ..."
              className="flex-1 min-w-[14rem] border-2 border-gray-200 p-2.5 rounded-xl text-sm font-medium text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
            />
            <button
              type="submit"
              className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition"
            >
              Søk
            </button>
            {search ? (
              <Link
                href="/enheter"
                className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
              >
                Nullstill
              </Link>
            ) : null}
          </form>
          {search ? (
            <p className="text-[11px] text-gray-500 font-bold">
              {total} treff på «{search}».
            </p>
          ) : null}
        </div>

        {/* LISTE */}
        {units.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">
              {search ? `Ingen enheter matcher «${search}».` : "Ingen enheter registrert ennå."}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Enheter legges til på kundekortet, under fanen «Utstyr / enheter».
            </p>
            <Link
              href="/kunder"
              className="inline-block mt-3 bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition"
            >
              🏢 Gå til kundene
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {units.map((unit) => {
              const services = unit.reportUnits.length;
              const deviations = deviationCount(unit);
              const last = lastServiceDate(unit);
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
                            ? `❌ ${deviations} avvik`
                            : `✅ ${services} service${services === 1 ? "" : "r"}`}
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold px-2 py-1 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                          Aldri kontrollert
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2 font-bold">
                    🕓 {services} service{services === 1 ? "" : "r"} • siste {formatDate(last)}
                  </p>
                </Link>
              );
            })}
          </div>
        )}

        {total > units.length && (
          <p className="text-center text-xs text-gray-500">
            Viser de første {units.length} av {total} enheter. Bruk søket for å snevre inn.
          </p>
        )}
      </div>
    </div>
  );
}
