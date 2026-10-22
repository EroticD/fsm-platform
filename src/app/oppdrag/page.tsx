import { redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import { formatAddress } from "@/lib/address";
import { formatDateRange } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";

// ---------------------------------------------------------------------------
// Hjelpere (utenfor komponenten slik at render forblir ren)
// ---------------------------------------------------------------------------

// Samme definisjoner som dashbordet bruker, slik at tallene stemmer.
const ACTIVE_STATUSES: WorkStatus[] = ["OPEN", "PENDING", "PLANNED", "WAITING", "IN_PROGRESS"];
const AWAITING_STATUSES: WorkStatus[] = ["OPEN", "PENDING", "PLANNED", "WAITING"];
const CLOSED_STATUSES: WorkStatus[] = ["COMPLETED", "CANCELLED"];
const PAGE_SIZE = 20;

function getDateContext() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  return { startOfToday, endOfToday };
}

/**
 * De filtrerte visningene av oppdragslisten. Dashbordets tallkort lenker hit,
 * slik at man ser nøyaktig de oppdragene tallet gjelder.
 */
const VIEWS = [
  { key: "alle", label: "Alle", icon: "📂", description: "Alle oppdrag i systemet." },
  {
    key: "apne",
    label: "Åpne",
    icon: "🔄",
    description: "Oppdrag som ikke er fullført eller kansellert.",
  },
  {
    key: "venter",
    label: "Venter på oppstart",
    icon: "⏳",
    description: "Åpne oppdrag som ennå ikke er satt i gang.",
  },
  {
    key: "pagaaende",
    label: "Påbegynt",
    icon: "🛠️",
    description: "Oppdrag det jobbes med nå.",
  },
  {
    key: "idag",
    label: "I dag",
    icon: "📅",
    description: "Oppdrag som er planlagt til i dag.",
  },
  {
    key: "forfalte",
    label: "Forfalte",
    icon: "⚠️",
    description: "Planlagt før i dag, men ikke fullført.",
  },
  {
    key: "ikke-tildelt",
    label: "Ikke tildelt",
    icon: "🙋",
    description: "Åpne oppdrag som mangler montør.",
  },
  {
    key: "fullforte",
    label: "Fullførte",
    icon: "✅",
    description: "Oppdrag som er fullført.",
  },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function isViewKey(value: string): value is ViewKey {
  return VIEWS.some((v) => v.key === value);
}

/** Spørringen bak hver visning – identisk med tallene på dashbordet. */
function whereFor(
  view: ViewKey,
  { startOfToday, endOfToday }: { startOfToday: Date; endOfToday: Date },
): Prisma.WorkOrderWhereInput {
  switch (view) {
    case "apne":
      return { status: { in: ACTIVE_STATUSES } };
    case "venter":
      return { status: { in: AWAITING_STATUSES } };
    case "pagaaende":
      return { status: "IN_PROGRESS" };
    case "idag":
      // Tar med flerdagersoppdrag som er i gang i dag.
      return {
        scheduledFor: { lte: endOfToday },
        OR: [
          { scheduledTo: { gte: startOfToday } },
          { scheduledTo: null, scheduledFor: { gte: startOfToday } },
        ],
      };
    case "forfalte":
      return {
        scheduledFor: { lt: startOfToday },
        OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }],
        status: { notIn: CLOSED_STATUSES },
      };
    case "ikke-tildelt":
      return { technicians: { none: {} }, status: { notIn: CLOSED_STATUSES } };
    case "fullforte":
      return { status: "COMPLETED" };
    default:
      return {};
  }
}

/** Forfalte og dagens oppdrag leses nedenfra og opp, resten nyeste først. */
function orderByFor(view: ViewKey): Prisma.WorkOrderOrderByWithRelationInput[] {
  if (view === "forfalte" || view === "idag") return [{ scheduledFor: "asc" }];
  return [{ scheduledFor: { sort: "desc", nulls: "last" } }];
}

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ vis?: string; q?: string; side?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  // Kontor og montører ser samme liste; montørene oppretter oppdrag i feltportalen.
  const office = user.role === "ADMIN" || user.role === "OFFICE";
  const canCreate = hasPermission(user, "workorders.create");

  const { vis, q, side } = await searchParams;
  const view: ViewKey = vis && isViewKey(vis) ? vis : "alle";
  const search = q?.trim() || "";
  const page = Math.max(1, parseInt(side?.toString() || "1", 10) || 1);

  const dates = getDateContext();

  const searchWhere: Prisma.WorkOrderWhereInput = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
          { customer: { city: { contains: search, mode: "insensitive" } } },
          { customer: { address: { contains: search, mode: "insensitive" } } },
        ],
      }
    : {};

  // Kansellerte oppdrag er avsluttet og vises ikke til montørene. Kontoret
  // trenger dem fortsatt for oppfølging og historikk. Avdelingsfilteret gjelder
  // uansett rolle; bare administrator ser oppdrag fra alle avdelinger.
  const visibleStatus: Prisma.WorkOrderWhereInput = {
    AND: [
      workOrderScope(user),
      office ? {} : { status: { not: "CANCELLED" } },
    ],
  };

  const activeWhere: Prisma.WorkOrderWhereInput = {
    AND: [visibleStatus, whereFor(view, dates), searchWhere],
  };

  const [statusGroups, todayCount, overdueCount, unassignedCount, total, orders] =
    await Promise.all([
      prisma.workOrder.groupBy({
        by: ["status"],
        where: visibleStatus,
        _count: { _all: true },
      }),
      prisma.workOrder.count({
        where: { AND: [visibleStatus, whereFor("idag", dates), searchWhere] },
      }),
      prisma.workOrder.count({
        where: { AND: [visibleStatus, whereFor("forfalte", dates), searchWhere] },
      }),
      prisma.workOrder.count({
        where: { AND: [visibleStatus, whereFor("ikke-tildelt", dates), searchWhere] },
      }),
      prisma.workOrder.count({ where: activeWhere }),
      prisma.workOrder.findMany({
        where: activeWhere,
        orderBy: orderByFor(view),
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        include: {
          customer: { select: { name: true, address: true, postalCode: true, city: true } },
          technicians: { select: { name: true } },
          templates: { select: { id: true } },
          reports: { select: { id: true } },
          tags: { select: { id: true, name: true } },
        },
      }),
    ]);

  const countByStatus = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const sumStatuses = (statuses: string[]) =>
    statuses.reduce((sum, s) => sum + countByStatus(s), 0);

  const viewCounts: Record<ViewKey, number> = {
    alle: statusGroups.reduce((sum, g) => sum + g._count._all, 0),
    apne: sumStatuses(ACTIVE_STATUSES),
    venter: sumStatuses(AWAITING_STATUSES),
    pagaaende: countByStatus("IN_PROGRESS"),
    idag: todayCount,
    forfalte: overdueCount,
    "ikke-tildelt": unassignedCount,
    fullforte: countByStatus("COMPLETED"),
  };

  const activeView = VIEWS.find((v) => v.key === view)!;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const linkFor = (key: ViewKey) => {
    const params = new URLSearchParams();
    if (key !== "alle") params.set("vis", key);
    if (search) params.set("q", search);
    const qs = params.toString();
    return `/oppdrag${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">
              {activeView.icon} {activeView.label}
            </h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              {activeView.description}
              {" • "}
              <span className="font-bold text-gray-700">{total} oppdrag</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              ← Dashbord
            </Link>
            {canCreate && (
              <Link
                href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
                className="bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
              >
                ➕ Nytt oppdrag
              </Link>
            )}
          </div>
        </div>

        {/* FILTRE */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
          <div className="-mx-1 px-1 overflow-x-auto">
            <div className="flex gap-2 w-max">
              {VIEWS.map((v) => {
                const active = v.key === view;
                return (
                  <Link
                    key={v.key}
                    href={linkFor(v.key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border-2 transition whitespace-nowrap ${
                      active
                        ? "bg-blue-700 border-blue-700 text-white shadow-sm"
                        : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300"
                    }`}
                  >
                    <span className="leading-none">{v.icon}</span>
                    <span>{v.label}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                        active ? "bg-white/25" : "bg-white border border-gray-200 text-gray-600"
                      }`}
                    >
                      {viewCounts[v.key]}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          <form method="GET" action="/oppdrag" className="flex flex-wrap gap-2">
            <input type="hidden" name="vis" value={view} />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Søk i tittel, beskrivelse, kunde eller sted ..."
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
                href={linkFor(view)}
                className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
              >
                Nullstill
              </Link>
            ) : null}
          </form>
        </div>

        {/* LISTE */}
        {orders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">Ingen oppdrag i denne visningen.</p>
            <p className="text-xs text-gray-500 mt-1">
              {search
                ? `Ingen treff på «${search}». Prøv et annet søkeord, eller nullstill søket.`
                : "Velg en annen visning over, eller opprett et nytt oppdrag."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((wo) => {
              const address = formatAddress(wo.customer);
              return (
              <Link
                key={wo.id}
                href={`/oppdrag/${wo.id}`}
                className="block bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-black text-gray-900 truncate">{wo.title}</p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      🏢 {wo.customer?.name || "Uten kunde"}
                      {address ? ` • 📍 ${address}` : ""}
                      {" • 📅 "}
                      {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato"}
                    </p>
                    {wo.tags && wo.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {wo.tags.map((tag: any) => (
                          <span
                            key={tag.id}
                            className="text-white px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm"
                            style={{ backgroundColor: tag.color || "#3b82f6" }}
                          >
                            🏷️ {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={wo.status} />
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] font-bold">
                  <span className={wo.technicians.length === 0 ? "text-amber-700" : "text-gray-600"}>
                    {wo.technicians.length === 0
                      ? "⚠️ Ikke tildelt montør"
                      : `👷 ${wo.technicians.map((t) => t.name).filter(Boolean).join(", ")}`}
                  </span>
                  <span className="text-gray-600">
                    📋 {wo.reports.length}/{wo.templates.length} sjekklister utfylt
                  </span>
                  {wo.scheduledFor && new Date(wo.scheduledTo || wo.scheduledFor) < dates.startOfToday &&
                    !CLOSED_STATUSES.includes(wo.status) && (
                      <span className="text-red-700">⚠️ Forfalt</span>
                    )}
                </div>
              </Link>
              );
            })}
          </div>
        )}

        {/* SIDEBLADDRING */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            {page > 1 && (
              <Link
                href={`${linkFor(view)}${linkFor(view).includes("?") ? "&" : "?"}side=${page - 1}`}
                className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition"
              >
                ← Forrige
              </Link>
            )}
            <span className="text-sm font-bold text-gray-600">
              Side {page} av {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`${linkFor(view)}${linkFor(view).includes("?") ? "&" : "?"}side=${page + 1}`}
                className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition"
              >
                Neste →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
