import { redirect } from "next/navigation";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { type Prisma, WorkStatus } from "@prisma/client";
import StatusBadge from "@/components/StatusBadge";
import KpiCard from "@/components/KpiCard";
import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateRangeLocalized,
  formatDateTimeLocalized,
  parseDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";

// ------------------------------------------------------------------
// Hjelpere (definert utenfor komponenten slik at render forblir ren)
// ------------------------------------------------------------------

// Dagens dato-grenser til bruk i spørringene. Kalenderdatoer er `date` i
// databasen, så grensene regnes som rene datoer i Oslo – ikke lokal tid på
// serveren, som kan være en annen tidssone.
function getDateContext() {
  const startOfToday = parseDateOnly(todayInOslo()) ?? new Date();
  const endOfToday = addDaysUtc(startOfToday, 1);
  const startOfMonth = new Date(
    Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth(), 1),
  );
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
async function OrderList({
  orders,
  empty,
  locale,
}: {
  orders: OrderWith[];
  empty: string;
  locale: string;
}) {
  const t = await getTranslations("common");
  if (orders.length === 0) {
    return <p className="text-xs text-gray-600 italic">{empty}</p>;
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
          <p className="text-xs text-gray-600 mt-1">
            🏢 {wo.customer?.name || t("dashboard.orderList.noCustomer")} • 📅 {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("dashboard.orderList.noDate")}
            {wo.technicians.length === 0
              ? ` • ${t("dashboard.orderList.unassigned")}`
              : ` • 👷 ${wo.technicians.map((tech) => tech.name?.split(" ")[0]).filter(Boolean).join(", ")}`}
          </p>
          {address && (
            <p className="text-xs text-gray-600 mt-0.5">📍 {address}</p>
          )}
          {wo.tags && wo.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {wo.tags.map((tag: any) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 rounded-full text-xs font-bold shadow-sm"
                  suppressHydrationWarning
                  style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
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
  { value: "", labelKey: "dashboard.statusOptions.all" },
  { value: "OPEN", labelKey: "dashboard.statusOptions.open" },
  { value: "PENDING", labelKey: "dashboard.statusOptions.pending" },
  { value: "WAITING", labelKey: "dashboard.statusOptions.waiting" },
  { value: "IN_PROGRESS", labelKey: "dashboard.statusOptions.inProgress" },
  { value: "PLANNED", labelKey: "dashboard.statusOptions.planned" },
  { value: "COMPLETED", labelKey: "dashboard.statusOptions.completed" },
  { value: "CANCELLED", labelKey: "dashboard.statusOptions.cancelled" },
];

// Hurtighandlinger for kontoret.
const OFFICE_ACTIONS = [
  { href: "/oppdrag/ny", icon: "➕", labelKey: "dashboard.quickActions.newWorkOrder" },
  { href: "/kalender", icon: "📅", labelKey: "dashboard.quickActions.calendar" },
  { href: "/kart", icon: "🗺️", labelKey: "dashboard.quickActions.map" },
  { href: "/kalender/dispatch", icon: "🎛️", labelKey: "dashboard.quickActions.dispatch" },
  { href: "/kunder", icon: "🏢", labelKey: "dashboard.quickActions.customers" },
  { href: "/dokumenter", icon: "📚", labelKey: "dashboard.quickActions.documents" },
  { href: "/innstillinger?tab=maler", icon: "📋", labelKey: "dashboard.quickActions.checklists" },
  { href: "/innstillinger?tab=ansatte", icon: "👥", labelKey: "dashboard.quickActions.employees" },
  { href: "/innstillinger?tab=statistikk", icon: "📊", labelKey: "dashboard.quickActions.statistics" },
];

// Hurtighandlinger for montører: feltrelevante sider, ingen kontorverktøy.
const FIELD_ACTIONS = [
  { href: "/mine-oppdrag/ny", icon: "➕", labelKey: "dashboard.quickActions.newWorkOrder" },
  { href: "/mine-oppdrag", icon: "📋", labelKey: "dashboard.quickActions.myWorkOrders" },
  { href: "/oppdrag", icon: "📂", labelKey: "dashboard.quickActions.allWorkOrders" },
  { href: "/kalender", icon: "📅", labelKey: "dashboard.quickActions.calendar" },
  { href: "/kart", icon: "🗺️", labelKey: "dashboard.quickActions.map" },
  { href: "/kunder", icon: "🏢", labelKey: "dashboard.quickActions.customers" },
  { href: "/enheter", icon: "🔧", labelKey: "dashboard.quickActions.equipment" },
  { href: "/rapporter", icon: "📄", labelKey: "dashboard.quickActions.reports" },
];

const ACTIVE_STATUSES = ["OPEN", "PENDING", "PLANNED", "WAITING", "IN_PROGRESS"];

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const t = await getTranslations("common");
  const locale = await getLocale();

  // Dashbordet bygger på oppdrag. En bruker med utvidede rettigheter, men uten
  // oppdragstilgang, sendes til den første siden vedkommende faktisk kan bruke.
  if (!hasPermission(user, "workorders.view")) {
    if (user.role === "CUSTOMER") redirect("/kundeportal");
    if (hasPermission(user, "customers.view")) redirect("/kunder");
    if (hasPermission(user, "documents.view")) redirect("/dokumenter");
    if (hasPermission(user, "equipment.view")) redirect("/enheter");
    if (hasPermission(user, "reports.view")) redirect("/rapporter");
    if (hasPermission(user, "users.view")) redirect("/brukere");
    redirect("/kundeportal");
  }

  // Dashbordet er felles for kontor og montører. Montørene ser de samme
  // tallene og listene, men hurtighandlingene peker til feltportalen deres.
  const office = user.role === "ADMIN" || user.role === "OFFICE";
  const canCreate = hasPermission(user, "workorders.create");
  const canSeeCancelled = user.role !== "TECHNICIAN";
  const canViewAudit = hasPermission(user, "audit.view");
  const canAssign = hasPermission(user, "workorders.assign");

  // Vis bare hurtighandlinger brukeren faktisk har tilgang til.
  const allowedHrefs = new Set<string>([
    "/kalender",
    "/kart",
    "/oppdrag",
    "/mine-oppdrag",
  ]);
  if (canCreate) {
    allowedHrefs.add("/oppdrag/ny");
    allowedHrefs.add("/mine-oppdrag/ny");
  }
  if (hasPermission(user, "workorders.assign")) allowedHrefs.add("/kalender/dispatch");
  if (hasPermission(user, "customers.view")) allowedHrefs.add("/kunder");
  if (hasPermission(user, "documents.view")) allowedHrefs.add("/dokumenter");
  if (hasPermission(user, "templates.manage")) allowedHrefs.add("/innstillinger?tab=maler");
  if (hasPermission(user, "users.view")) allowedHrefs.add("/innstillinger?tab=ansatte");
  if (hasPermission(user, "reports.view")) allowedHrefs.add("/innstillinger?tab=statistikk");
  if (hasPermission(user, "equipment.view")) allowedHrefs.add("/enheter");
  if (hasPermission(user, "reports.view")) allowedHrefs.add("/rapporter");
  const quickActions = (office ? OFFICE_ACTIONS : FIELD_ACTIONS).filter((a) =>
    allowedHrefs.has(a.href),
  );

  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q?.trim() || "";
  const rawStatus = resolvedParams.status?.trim() || "";
  const requestedStatus = Object.values(WorkStatus).includes(rawStatus as WorkStatus)
    ? (rawStatus as WorkStatus)
    : undefined;
  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  const statusFilter =
    !canSeeCancelled && requestedStatus === "CANCELLED" ? undefined : requestedStatus;
  const statusOptions = canSeeCancelled
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((option) => option.value !== "CANCELLED");
  const visibleStatus: Prisma.WorkOrderWhereInput = canSeeCancelled
    ? {}
    : { status: { not: "CANCELLED" } };
  const scope = workOrderScope(user);
  // Kunde- og enhets-KPI-ene skal følge samme avdelingssperre som oppdragene.
  // Administrator ser hele organisasjonen; andre ser egen avdeling.
  const organisationScope: Prisma.CustomerWhereInput =
    user.role === "ADMIN"
      ? {}
      : user.departmentId
        ? { departmentId: user.departmentId }
        : { id: { in: [] } };

  const branding = await prisma.branding.findFirst();
  const companyName = branding?.companyName || "FSM System";

  const page = Math.max(1, parseInt(resolvedParams.page?.toString() || "1", 10) || 1);
  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  const { startOfToday, endOfToday, startOfMonth } = getDateContext();

  // --- GLOBALE TALL ---
  const statusGroups = await prisma.workOrder.groupBy({
    by: ["status"],
    where: { AND: [scope, visibleStatus] },
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
  // Fullførte og kansellerte oppdrag er historikk og skal ikke fylles inn i
  // den generelle oversikten. Velger man en av dem i statusfilteret, er det en
  // bevisst historikk-visning og da vises de.
  const explicitHistory =
    statusFilter === "COMPLETED" || statusFilter === "CANCELLED";
  const listWhere: Prisma.WorkOrderWhereInput = {
    AND: [
      scope,
      visibleStatus,
      explicitHistory ? {} : { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      statusFilter ? { status: statusFilter } : {},
      listSearchWhere,
    ],
  };

  // Flerdagersoppdrag teller som «i dag» så lenge perioden dekker dagen.
  const todayWhere = {
    AND: [
      scope,
      visibleStatus,
      { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      {
        scheduledFor: { lte: endOfToday },
        OR: [
          { scheduledTo: { gte: startOfToday } },
          { scheduledTo: null, scheduledFor: { gte: startOfToday } },
        ],
      },
    ],
  } satisfies Prisma.WorkOrderWhereInput;

  const overdueWhere = {
    AND: [
      scope,
      visibleStatus,
      {
        scheduledFor: { lt: startOfToday },
        OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }],
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    ],
  } satisfies Prisma.WorkOrderWhereInput;

  const [
    todayOrders,
    todayCount,
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
      take: 100,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.workOrder.count({ where: todayWhere }),
    prisma.workOrder.count({ where: overdueWhere }),
    prisma.workOrder.findMany({
      where: overdueWhere,
      orderBy: { scheduledFor: "asc" },
      take: 8,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.workOrder.count({
      where: {
        AND: [
          scope,
          visibleStatus,
          {
            technicians: { none: {} },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
        ],
      },
    }),
    prisma.workOrder.findMany({
      where: {
        AND: [
          scope,
          visibleStatus,
          {
            technicians: { none: {} },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
        ],
      },
      orderBy: { scheduledFor: "asc" },
      take: 8,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.report.count({
      where: {
        completedAt: { gte: startOfMonth },
        workOrder: workOrderScope(user),
      },
    }),
    prisma.customer.count({ where: organisationScope }),
    prisma.product.count({ where: { customer: organisationScope } }),
    canViewAudit
      ? prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 })
      : Promise.resolve([]),
    prisma.workOrder.count({ where: listWhere }),
    prisma.workOrder.findMany({
      where: listWhere,
      orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }],
      take: pageSize,
      skip,
      include: {
        customer: true,
        technicians: true,
        tags: true,
        _count: { select: { reports: true } },
      },
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
              {t("dashboard.greeting", { name: user?.name?.split(" ")[0] || t("admin") })}
            </h1>
            <p className="text-gray-600 mt-1 font-medium text-sm">
              {t("dashboard.adminOf", { companyName })}
              {" • "}
              {formatDateLocalized(startOfToday, locale, undefined, t("dashboard.orderList.noDate"))}
            </p>
          </div>
          <div className="flex gap-2">
            {canCreate && (
              <Link
                href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
                className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition shadow-sm whitespace-nowrap"
              >
                {t("dashboard.newWorkOrder")}
              </Link>
            )}
            <Link
              href="/kalender"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              {t("dashboard.calendar")}
            </Link>
          </div>
        </div>

        {/* HURTIGHANDLINGER */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-600 mb-2">{t("dashboard.quickActionsTitle")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-2 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-800 transition"
              >
                <span className="text-base leading-none">{a.icon}</span>
                <span className="truncate">{t(a.labelKey)}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* KPI-ER */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon="📂"
            label={t("dashboard.kpi.open")}
            value={openCount}
            sub={t("dashboard.kpi.awaiting", { count: awaitingCount })}
            tone="blue"
            href="/oppdrag?vis=apne"
          />
          <KpiCard
            icon="🔄"
            label={t("dashboard.kpi.inProgress")}
            value={inProgressCount}
            sub={t("dashboard.kpi.inProgressSub")}
            tone="purple"
            href="/oppdrag?vis=pagaaende"
          />
          <KpiCard
            icon="📅"
            label={t("dashboard.kpi.today")}
            value={todayCount}
            sub={formatDateLocalized(startOfToday, locale, undefined, t("dashboard.orderList.noDate"))}
            tone="gray"
            href="/oppdrag?vis=idag"
          />
          <KpiCard
            icon="⚠️"
            label={t("dashboard.kpi.overdue")}
            value={overdueCount}
            sub={t("dashboard.kpi.overdueSub")}
            tone={overdueCount > 0 ? "red" : "gray"}
            href="/oppdrag?vis=forfalte"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon="🙋"
            label={t("dashboard.kpi.unassigned")}
            value={unassignedCount}
            sub={t("dashboard.kpi.unassignedSub")}
            tone={unassignedCount > 0 ? "amber" : "gray"}
            href="/oppdrag?vis=ikke-tildelt"
          />
          <KpiCard
            icon="📋"
            label={t("dashboard.kpi.reports")}
            value={reportsThisMonth}
            sub={t("dashboard.kpi.reportsSub")}
            tone="green"
            href="/rapporter"
          />
          <KpiCard
            icon="🏢"
            label={t("dashboard.kpi.customers")}
            value={customerCount}
            sub={t("dashboard.kpi.customersSub")}
            tone="gray"
            href="/kunder"
          />
          <KpiCard
            icon="🔧"
            label={t("dashboard.kpi.equipment")}
            value={productCount}
            sub={t("dashboard.kpi.equipmentSub", { count: completedCount })}
            tone="gray"
            href="/enheter"
          />
        </div>

        {/* DAGENS + FORFALTE */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="font-black text-gray-900 text-base">{t("dashboard.todayTitle")}</h2>
              <Link href="/kalender" className="text-[11px] font-bold text-blue-600 hover:underline">
                {t("dashboard.calendarLink")}
              </Link>
            </div>
            <OrderList orders={todayOrders} empty={t("dashboard.todayEmpty")} locale={locale} />
          </div>

          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="font-black text-gray-900 text-base">{t("dashboard.overdueTitle")}</h2>
              {overdueCount > 0 && (
                <span className="text-xs font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                  {overdueCount}
                </span>
              )}
            </div>
            <OrderList orders={overdueOrders} empty={t("dashboard.overdueEmpty")} locale={locale} />
          </div>
        </div>

        {/* IKKE TILDELTE */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">{t("dashboard.unassignedTitle")}</h2>
            {canAssign && (
              <Link href="/kalender/dispatch" className="text-[11px] font-bold text-blue-600 hover:underline">
                {t("dashboard.openDispatch")}
              </Link>
            )}
          </div>
          <OrderList
            orders={unassignedOrders}
            empty={t("dashboard.unassignedEmpty")}
            locale={locale}
          />
        </div>

        {/* OPPDRAGSLISTE MED SØK OG FILTER */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">{t("dashboard.ordersTitle")}</h2>
            <span className="text-[11px] text-gray-600">{t("dashboard.hits", { count: listTotal })}</span>
          </div>

          <form method="GET" action="/" className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <input
              type="text"
              name="q"
              aria-label={t("dashboard.searchPlaceholder")}
              defaultValue={searchQuery}
              placeholder={t("dashboard.searchPlaceholder")}
              className="flex-1 min-w-[200px] border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            />
            <select
              name="status"
              aria-label={t("dashboard.statusFilterLabel")}
              defaultValue={statusFilter}
              className="border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-gray-900 text-white px-5 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap text-sm"
            >
              {t("dashboard.search")}
            </button>
            {(searchQuery || statusFilter) && (
              <Link
                href="/"
                className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center whitespace-nowrap text-sm"
              >
                {t("dashboard.reset")}
              </Link>
            )}
          </form>

          {listOrders.length === 0 ? (
            <div className="p-6 text-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-gray-600 font-medium">{t("dashboard.noMatches")}</p>
              {canCreate && (
                <Link href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"} className="text-blue-600 font-bold hover:underline mt-2 inline-block">
                  {t("dashboard.createNew")}
                </Link>
              )}
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
                    <p className="text-xs text-gray-600">
                      🏢 {wo.customer?.name || t("dashboard.orderList.noCustomer")} • 📅 {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("dashboard.orderList.noDate")}
                      {wo._count.reports > 0 ? ` • ${t("dashboard.checklists", { count: wo._count.reports })}` : ""}
                    </p>
                    {formatAddress(wo.customer) && (
                      <p className="text-xs text-gray-600">📍 {formatAddress(wo.customer)}</p>
                    )}
                    {wo.tags && wo.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {wo.tags.map((tag: any) => (
                          <span
                            key={tag.id}
                            className="px-2 py-0.5 rounded-full text-xs font-bold shadow-sm"
                            suppressHydrationWarning
                            style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                          >
                            🏷️ {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="text-gray-600">
                      <p className="font-bold text-gray-700 text-xs uppercase tracking-wider">{t("dashboard.technicians")}</p>
                      <p className="truncate">
                        {wo.technicians.length > 0 ? (
                          wo.technicians.map((tech) => tech.name?.split(" ")[0]).filter(Boolean).join(", ")
                        ) : (
                          <span className="text-red-700 font-bold">{t("dashboard.notAssigned")}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-gray-600 font-bold">&rarr;</div>
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
                  {t("dashboard.previous")}
                </Link>
              )}
              <span className="text-sm text-gray-600">
                {t("dashboard.page", { page, pages: totalPages })}
              </span>
              {page < totalPages && (
                <Link
                  href={`/?page=${page + 1}${listQuery}`}
                  className="text-blue-600 font-bold hover:underline text-sm whitespace-nowrap"
                >
                  {t("dashboard.next")}
                </Link>
              )}
            </div>
          )}
        </div>

        {/* SISTE AKTIVITET */}
        {canViewAudit && (
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <h2 className="font-black text-gray-900 text-base">{t("dashboard.activityTitle")}</h2>
              <Link href="/innstillinger?tab=auditlog" className="text-[11px] font-bold text-blue-600 hover:underline">
                {t("dashboard.viewAllActivity")}
              </Link>
            </div>
            {recentLogs.length === 0 ? (
              <p className="text-xs text-gray-600 italic">{t("dashboard.noActivity")}</p>
            ) : (
              <ol className="space-y-2">
                {recentLogs.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-gray-800 font-medium">{log.action}</p>
                      <p className="text-xs text-gray-600">
                        {log.userName || t("dashboard.unknownUser")} • {formatDateTimeLocalized(log.createdAt, locale)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
