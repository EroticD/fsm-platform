import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { type Prisma, WorkStatus } from "@prisma/client";
import StatusBadge from "@/components/StatusBadge";
import KpiCard from "@/components/KpiCard";
import { formatAddress } from "@/lib/address";
import { formatDate, formatDateRange, formatDateTime } from "@/lib/dates";

// ------------------------------------------------------------------
// Hjelpere (definert utenfor komponenten slik at render forblir ren)
// ------------------------------------------------------------------

// Dagens dato-grenser til bruk i spørringene.
function getDateContext() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startOfToday, endOfToday, startOfMonth };
}

type OrderWith = {
  id: string;
  title: string;
  status: string;
  scheduledFor: Date | null;
  scheduledTo?: Date | null;
  customer: { name: string; address?: string | null; postalCode?: string | null; city?: string | null } | null;
  technicians: { name: string | null }[];
  tags?: { id: string; name: string }[];
};

// Kompakt oppdragsliste brukt i flere av dashbord-panelene.
function OrderList({ orders, empty }: { orders: OrderWith[]; empty: string }) {
  if (orders.length === 0) {
    return <p className="text-xs text-gray-500 italic">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {orders.map((wo) => {
        const address = formatAddress(wo.customer);
        return (
        <Link
          key={wo.id}
          href={`/oppdrag/${wo.id}`}
          className="block bg-gray-50 hover:bg-blue-50/60 border border-gray-200 hover:border-blue-300 p-3 rounded-xl transition"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-gray-900 text-sm truncate">{wo.title}</span>
            <StatusBadge status={wo.status} />
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            🏢 {wo.customer?.name || "Uten kunde"} • 📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato"}
            {wo.technicians.length === 0
              ? " • ⚠️ Ikke tildelt"
              : ` • 👷 ${wo.technicians.map((t) => t.name?.split(" ")[0]).filter(Boolean).join(", ")}`}
          </p>
          {address && (
            <p className="text-[10px] text-gray-500 mt-0.5">📍 {address}</p>
          )}
          {wo.tags && wo.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {wo.tags.map((tag: any) => (
                <span
                  key={tag.id}
                  className="text-white px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm"
                  style={{ backgroundColor: tag.color || "#3b82f6" }}
                >
                  🏷️ {tag.name}
                </span>
              ))}
            </div>
          )}
        </Link>
        );
      })}
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "", label: "Alle statuser" },
  { value: "OPEN", label: "Åpen" },
  { value: "PENDING", label: "Venter / Planlagt" },
  { value: "WAITING", label: "Venter" },
  { value: "IN_PROGRESS", label: "Påbegynt" },
  { value: "PLANNED", label: "Planlagt" },
  { value: "COMPLETED", label: "Fullført" },
  { value: "CANCELLED", label: "Kansellert" },
];

// Hurtighandlinger for kontoret.
const OFFICE_ACTIONS = [
  { href: "/oppdrag/ny", icon: "➕", label: "Nytt oppdrag" },
  { href: "/kalender", icon: "📅", label: "Kalender" },
  { href: "/kalender/dispatch", icon: "🎛️", label: "Dispatch" },
  { href: "/kunder", icon: "🏢", label: "Kunder" },
  { href: "/dokumenter", icon: "📚", label: "Dokumenter" },
  { href: "/innstillinger?tab=maler", icon: "📋", label: "Sjekklister" },
  { href: "/innstillinger?tab=ansatte", icon: "👥", label: "Ansatte" },
  { href: "/innstillinger?tab=statistikk", icon: "📊", label: "Statistikk" },
];

// Hurtighandlinger for montører: feltrelevante sider, ingen kontorverktøy.
const FIELD_ACTIONS = [
  { href: "/mine-oppdrag/ny", icon: "➕", label: "Nytt oppdrag" },
  { href: "/mine-oppdrag", icon: "📋", label: "Mine oppdrag" },
  { href: "/oppdrag", icon: "📂", label: "Alle oppdrag" },
  { href: "/kalender", icon: "📅", label: "Kalender" },
  { href: "/kunder", icon: "🏢", label: "Kunder" },
  { href: "/enheter", icon: "🔧", label: "Enheter" },
  { href: "/rapporter", icon: "📄", label: "Rapporter" },
];

const ACTIVE_STATUSES = ["OPEN", "PENDING", "PLANNED", "WAITING", "IN_PROGRESS"];

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) redirect("/api/auth/signin");

  // Dashbordet er felles for kontor og montører. Montørene ser de samme
  // tallene og listene, men hurtighandlingene peker til feltportalen deres.
  const office = user.role === "ADMIN" || user.role === "OFFICE";
  const quickActions = office ? OFFICE_ACTIONS : FIELD_ACTIONS;

  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q?.trim() || "";
  const rawStatus = resolvedParams.status?.trim() || "";
  const requestedStatus = Object.values(WorkStatus).includes(rawStatus as WorkStatus)
    ? (rawStatus as WorkStatus)
    : undefined;
  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  const statusFilter =
    !office && requestedStatus === "CANCELLED" ? undefined : requestedStatus;
  const statusOptions = office
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((option) => option.value !== "CANCELLED");
  const visibleStatus: Prisma.WorkOrderWhereInput = office
    ? {}
    : { status: { not: "CANCELLED" } };

  const branding = await prisma.branding.findFirst();
  const companyName = branding?.companyName || "FSM System";

  const page = Math.max(1, parseInt(resolvedParams.page?.toString() || "1", 10) || 1);
  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  const { startOfToday, endOfToday, startOfMonth } = getDateContext();

  // --- GLOBALE TALL ---
  const statusGroups = await prisma.workOrder.groupBy({
    by: ["status"],
    where: visibleStatus,
    _count: { _all: true },
  });
  const countByStatus = (s: string) =>
    statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const openCount = ACTIVE_STATUSES.reduce((sum, s) => sum + countByStatus(s), 0);
  const inProgressCount = countByStatus("IN_PROGRESS");
  const completedCount = countByStatus("COMPLETED");
  const awaitingCount =
    countByStatus("OPEN") +
    countByStatus("PENDING") +
    countByStatus("PLANNED") +
    countByStatus("WAITING");

  const listSearchWhere = searchQuery
    ? {
        OR: [
          { title: { contains: searchQuery, mode: "insensitive" as const } },
          { description: { contains: searchQuery, mode: "insensitive" as const } },
          { customer: { name: { contains: searchQuery, mode: "insensitive" as const } } },
          { customer: { city: { contains: searchQuery, mode: "insensitive" as const } } },
          { customer: { address: { contains: searchQuery, mode: "insensitive" as const } } },
        ],
      }
    : {};
  const listWhere: Prisma.WorkOrderWhereInput = {
    ...visibleStatus,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...listSearchWhere,
  };

  // Flerdagersoppdrag teller som «i dag» så lenge perioden dekker dagen.
  const todayWhere = {
    ...visibleStatus,
    scheduledFor: { lte: endOfToday },
    OR: [
      { scheduledTo: { gte: startOfToday } },
      { scheduledTo: null, scheduledFor: { gte: startOfToday } },
    ],
  } satisfies Prisma.WorkOrderWhereInput;

  const overdueWhere = {
    scheduledFor: { lt: startOfToday },
    OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }],
    status: { notIn: ["COMPLETED", "CANCELLED"] },
  } satisfies Prisma.WorkOrderWhereInput;

  const [
    todayOrders,
    overdueCount,
    overdueOrders,
    unassignedCount,
    unassignedOrders,
    reportsThisMonth,
    customerCount,
    productCount,
    recentLogs,
    listTotal,
    listOrders,
  ] = await Promise.all([
    prisma.workOrder.findMany({
      where: todayWhere,
      orderBy: { scheduledFor: "asc" },
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.workOrder.count({ where: overdueWhere }),
    prisma.workOrder.findMany({
      where: overdueWhere,
      orderBy: { scheduledFor: "asc" },
      take: 8,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.workOrder.count({
      where: {
        technicians: { none: {} },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    }),
    prisma.workOrder.findMany({
      where: {
        technicians: { none: {} },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      orderBy: { scheduledFor: "asc" },
      take: 8,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.report.count({ where: { completedAt: { gte: startOfMonth } } }),
    prisma.customer.count(),
    prisma.product.count(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.workOrder.count({ where: listWhere }),
    prisma.workOrder.findMany({
      where: listWhere,
      orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }],
      take: pageSize,
      skip,
      include: { customer: true, technicians: true, reports: true, tags: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const listQuery = `${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${
    statusFilter ? `&status=${statusFilter}` : ""
  }`;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">
              Velkommen, {user?.name?.split(" ")[0] || "Admin"} 👋
            </h1>
            <p className="text-gray-500 mt-1 font-medium text-sm">
              Du administrerer <span className="font-bold text-gray-700">{companyName}</span>
              {" • "}
              {formatDate(startOfToday, "Ingen dato")}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
              className="bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
            >
              ➕ Nytt oppdrag
            </Link>
            <Link
              href="/kalender"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              📅 Kalender
            </Link>
          </div>
        </div>

        {/* HURTIGHANDLINGER */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Hurtighandlinger</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-2 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-800 transition"
              >
                <span className="text-base leading-none">{a.icon}</span>
                <span className="truncate">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* KPI-ER */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon="📂"
            label="Åpne oppdrag"
            value={openCount}
            sub={`${awaitingCount} venter på oppstart`}
            tone="blue"
            href="/oppdrag?vis=apne"
          />
          <KpiCard
            icon="🔄"
            label="Påbegynt"
            value={inProgressCount}
            sub="Jobbes med nå"
            tone="purple"
            href="/oppdrag?vis=pagaaende"
          />
          <KpiCard
            icon="📅"
            label="Dagens oppdrag"
            value={todayOrders.length}
            sub={formatDate(startOfToday, "Ingen dato")}
            tone="gray"
            href="/oppdrag?vis=idag"
          />
          <KpiCard
            icon="⚠️"
            label="Forfalte"
            value={overdueCount}
            sub="Ikke fullført i tide"
            tone={overdueCount > 0 ? "red" : "gray"}
            href="/oppdrag?vis=forfalte"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon="🙋"
            label="Ikke tildelt"
            value={unassignedCount}
            sub="Mangler montør"
            tone={unassignedCount > 0 ? "amber" : "gray"}
            href="/oppdrag?vis=ikke-tildelt"
          />
          <KpiCard
            icon="📋"
            label="Rapporter i mnd."
            value={reportsThisMonth}
            sub="Utfylte sjekklister"
            tone="green"
            href="/rapporter"
          />
          <KpiCard
            icon="🏢"
            label="Kunder"
            value={customerCount}
            sub="Totalt i registeret"
            tone="gray"
            href="/kunder"
          />
          <KpiCard
            icon="🔧"
            label="Enheter"
            value={productCount}
            sub={`${completedCount} fullførte oppdrag`}
            tone="gray"
            href="/enheter"
          />
        </div>

        {/* DAGENS + FORFALTE */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="font-black text-gray-900 text-base">📅 Dagens oppdrag</h2>
              <Link href="/kalender" className="text-[11px] font-bold text-blue-600 hover:underline">
                Kalender
              </Link>
            </div>
            <OrderList orders={todayOrders} empty="Ingen oppdrag planlagt i dag." />
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="font-black text-gray-900 text-base">⚠️ Forfalte oppdrag</h2>
              {overdueCount > 0 && (
                <span className="text-[10px] font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                  {overdueCount}
                </span>
              )}
            </div>
            <OrderList orders={overdueOrders} empty="Ingen forfalte oppdrag. Bra jobbet! 🎉" />
          </div>
        </div>

        {/* IKKE TILDELTE */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">🙋 Oppdrag uten montør</h2>
            {office && (
              <Link href="/kalender/dispatch" className="text-[11px] font-bold text-blue-600 hover:underline">
                Åpne dispatch
              </Link>
            )}
          </div>
          <OrderList
            orders={unassignedOrders}
            empty="Alle aktive oppdrag har en montør. 👏"
          />
        </div>

        {/* OPPDRAGSLISTE MED SØK OG FILTER */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">📂 Oppdrag</h2>
            <span className="text-[11px] text-gray-500">{listTotal} treff</span>
          </div>

          <form method="GET" action="/" className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <input
              type="text"
              name="q"
              defaultValue={searchQuery}
              placeholder="Filtrer oppdragslisten på tittel, beskrivelse, kunde eller sted..."
              className="flex-1 min-w-[200px] border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            />
            <select
              name="status"
              defaultValue={statusFilter}
              className="border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-gray-900 text-white px-5 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap text-sm"
            >
              Søk
            </button>
            {(searchQuery || statusFilter) && (
              <Link
                href="/"
                className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center whitespace-nowrap text-sm"
              >
                Nullstill
              </Link>
            )}
          </form>

          {listOrders.length === 0 ? (
            <div className="p-6 text-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-gray-500 font-medium">Ingen oppdrag matcher søket.</p>
              <Link href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"} className="text-blue-600 font-bold hover:underline mt-2 inline-block">
                Opprett et nytt oppdrag
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {listOrders.map((wo) => (
                <Link
                  key={wo.id}
                  href={`/oppdrag/${wo.id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 hover:bg-gray-50 transition gap-3 sm:gap-4 rounded-xl"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                      <h3 className="font-bold text-gray-900 text-base truncate">{wo.title}</h3>
                      <StatusBadge status={wo.status} />
                    </div>
                    <p className="text-[10px] text-gray-500">
                      🏢 {wo.customer?.name || "Uten kunde"} • 📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato"}
                      {wo.reports.length > 0 ? ` • 📋 ${wo.reports.length} sjekkliste(r)` : ""}
                    </p>
                    {formatAddress(wo.customer) && (
                      <p className="text-[10px] text-gray-500">📍 {formatAddress(wo.customer)}</p>
                    )}
                    {wo.tags && wo.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {wo.tags.map((tag: any) => (
                          <span
                            key={tag.id}
                            className="text-white px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm"
                            style={{ backgroundColor: tag.color || "#3b82f6" }}
                          >
                            🏷️ {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <div className="text-gray-600">
                      <p className="font-bold text-gray-700 text-[10px] uppercase tracking-wider">Montører</p>
                      <p className="truncate">
                        {wo.technicians.length > 0 ? (
                          wo.technicians.map((t) => t.name?.split(" ")[0]).filter(Boolean).join(", ")
                        ) : (
                          <span className="text-red-500 font-medium">Ikke tildelt</span>
                        )}
                      </p>
                    </div>
                    <div className="text-gray-400 font-bold">&rarr;</div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              {page > 1 && (
                <Link
                  href={`/?page=${page - 1}${listQuery}`}
                  className="text-blue-600 text-sm font-bold hover:underline whitespace-nowrap"
                >
                  &larr; Forrige
                </Link>
              )}
              <span className="text-sm text-gray-600">
                Side {page} av {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`/?page=${page + 1}${listQuery}`}
                  className="text-blue-600 font-bold hover:underline text-sm whitespace-nowrap"
                >
                  Neste &rarr;
                </Link>
              )}
            </div>
          )}
        </div>

        {/* SISTE AKTIVITET */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <div className="flex items-center justify-between border-b pb-2 mb-3">
            <h2 className="font-black text-gray-900 text-base">📋 Siste aktivitet</h2>
            {office && (
              <Link href="/innstillinger?tab=auditlog" className="text-[11px] font-bold text-blue-600 hover:underline">
                Se all aktivitet
              </Link>
            )}
          </div>
          {recentLogs.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Ingen aktivitet registrert.</p>
          ) : (
            <ol className="space-y-2">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-gray-800 font-medium">{log.action}</p>
                    <p className="text-[10px] text-gray-500">
                      {log.userName || "Ukjent"} • {formatDateTime(log.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

      </div>
    </div>
  );
}
