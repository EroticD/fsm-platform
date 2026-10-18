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
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Ingen dato";
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Tidsrom for rapportlisten. «denne-maneden» er standard, slik at listen viser
 * nøyaktig det samme som «Rapporter i mnd.» på dashbordet.
 */
const RANGES = [
  { key: "denne-maneden", label: "Denne måneden", icon: "📆" },
  { key: "forrige-maned", label: "Forrige måned", icon: "🗓️" },
  { key: "alle", label: "Alle", icon: "📂" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function isRangeKey(value: string): value is RangeKey {
  return RANGES.some((r) => r.key === value);
}

function rangeLabel(key: RangeKey) {
  const now = new Date();
  if (key === "denne-maneden") return now.toLocaleDateString("no-NO", { month: "long", year: "numeric" });
  if (key === "forrige-maned") {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return prev.toLocaleDateString("no-NO", { month: "long", year: "numeric" });
  }
  return "hele historikken";
}

function whereFor(range: RangeKey): Prisma.ReportWhereInput {
  const now = new Date();
  if (range === "denne-maneden") return { completedAt: { gte: startOfMonth(now) } };
  if (range === "forrige-maned") {
    return {
      completedAt: {
        gte: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        lt: startOfMonth(now),
      },
    };
  }
  return {};
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ vis?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  // Proxyen slipper kundeportalbrukere inn på /rapporter for å se egne PDF-er.
  // Selve listen er en intern oversikt, så de sendes tilbake til portalen.
  if (user?.role === "CUSTOMER") redirect("/kundeportal");
  if (user?.role === "TECHNICIAN") redirect("/mine-oppdrag");

  const { vis } = await searchParams;
  const range: RangeKey = vis && isRangeKey(vis) ? vis : "denne-maneden";

  const [reports, total, thisMonth, lastMonth, allReports] = await Promise.all([
    prisma.report.findMany({
      where: whereFor(range),
      orderBy: { completedAt: "desc" },
      take: 100,
      include: {
        template: { select: { title: true } },
        workOrder: { select: { id: true, title: true, customer: { select: { name: true } } } },
        units: { select: { id: true, status: true } },
      },
    }),
    prisma.report.count({ where: whereFor(range) }),
    prisma.report.count({ where: whereFor("denne-maneden") }),
    prisma.report.count({ where: whereFor("forrige-maned") }),
    prisma.report.count(),
  ]);

  const rangeCounts: Record<RangeKey, number> = {
    "denne-maneden": thisMonth,
    "forrige-maned": lastMonth,
    alle: allReports,
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">📋 Servicerapporter</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              Utfylte sjekklister med signaturer og bilder •{" "}
              <span className="font-bold text-gray-700">
                {total} rapport{total === 1 ? "" : "er"} ({rangeLabel(range)})
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
              href="/oppdrag"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              📂 Oppdrag
            </Link>
          </div>
        </div>

        {/* TIDSROM */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200">
          <div className="flex gap-2 flex-wrap">
            {RANGES.map((r) => {
              const active = r.key === range;
              return (
                <Link
                  key={r.key}
                  href={`/rapporter${r.key === "denne-maneden" ? "" : `?vis=${r.key}`}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border-2 transition whitespace-nowrap ${
                    active
                      ? "bg-blue-700 border-blue-700 text-white shadow-sm"
                      : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300"
                  }`}
                >
                  <span className="leading-none">{r.icon}</span>
                  <span>{r.label}</span>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      active ? "bg-white/25" : "bg-white border border-gray-200 text-gray-600"
                    }`}
                  >
                    {rangeCounts[r.key]}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* LISTE */}
        {reports.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">
              Ingen rapporter {rangeLabel(range)}.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Rapporter vises her så snart montørene har fylt ut og lagret et skjema.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => {
              const deviations = report.units.filter((u) => u.status === "AVVIK").length;
              return (
                <div
                  key={report.id}
                  className="bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 truncate">
                        {report.template?.title || "Servicerapport"}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        📅 {formatDate(report.completedAt)}
                        {" • 🏢 "}
                        {report.workOrder?.customer?.name || "Uten kunde"}
                        {" • 📂 "}
                        {report.workOrder?.title || "Ukjent oppdrag"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {report.units.length > 0 ? (
                        <span
                          className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                            deviations > 0
                              ? "bg-red-50 text-red-800 border-red-200"
                              : "bg-green-50 text-green-800 border-green-200"
                          }`}
                        >
                          {deviations > 0
                            ? `❌ ${deviations} avvik`
                            : `✅ ${report.units.length} enhet${report.units.length === 1 ? "" : "er"}`}
                        </span>
                      ) : null}
                      <span
                        className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                          report.isLocked
                            ? "bg-gray-100 text-gray-700 border-gray-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                      >
                        {report.isLocked ? "🔒 Låst" : "🔓 Åpen for retting"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px]">
                    <span className="font-bold text-gray-600">
                      ✍️ {report.technicianName || report.lockedByName || "Ikke signert"}
                    </span>
                    <Link
                      href={`/rapporter/${report.workOrderId}`}
                      className="font-bold text-blue-700 hover:underline"
                    >
                      📄 Se rapport (PDF)
                    </Link>
                    <Link
                      href={`/oppdrag/${report.workOrderId}`}
                      className="font-bold text-gray-600 hover:underline"
                    >
                      📂 Åpne oppdraget
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {total > reports.length && (
          <p className="text-center text-xs text-gray-500">
            Viser de {reports.length} nyeste av {total} rapporter.
          </p>
        )}
      </div>
    </div>
  );
}
