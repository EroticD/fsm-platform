import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatAddress } from "@/lib/address";
import { formatDateRangeLocalized } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { idSchema } from "@/lib/schemas/common";
import * as workOrderService from "@/server/work-orders";
import StatusBadge from "@/components/StatusBadge";
import LogoutButton from "@/components/LogoutButton";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import SubmitButton from "@/components/SubmitButton";
import CustomerToast from "@/components/customer/CustomerToast";

/** Feltportalen viser de nærmeste oppdragene, ikke hele historikken. */
const LIST_PAGE_SIZE = 25;
const LIST_MAX_LIMIT = 200;

function listLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return LIST_PAGE_SIZE;
  return Math.min(LIST_MAX_LIMIT, Math.max(LIST_PAGE_SIZE, parsed));
}

const LIST_SELECT = {
  id: true,
  title: true,
  orderNumber: true,
  status: true,
  scheduledFor: true,
  scheduledTo: true,
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      address: true,
      postalCode: true,
      city: true,
    },
  },
  tags: { select: { id: true, name: true, color: true } },
} as const;

type ListCustomer = {
  phone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.mineOppdrag") };
}

export default async function TechnicianDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    a?: string;
    u?: string;
    h?: string;
    claimed?: string;
    error?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q?.trim() || "";
  const accessScope = workOrderScope(user);
  const canClaim = hasPermission(user, "workorders.update");
  const assignedLimit = listLimit(resolvedParams.a);
  const unassignedLimit = listLimit(resolvedParams.u);
  const historyLimit = listLimit(resolvedParams.h);

  const searchOr: Prisma.WorkOrderWhereInput = searchQuery
    ? {
        OR: [
          { title: { contains: searchQuery, mode: 'insensitive' } },
          { orderNumber: { contains: searchQuery, mode: 'insensitive' } },
          { description: { contains: searchQuery, mode: 'insensitive' } },
          { customer: { name: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { city: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { address: { contains: searchQuery, mode: 'insensitive' } } },
        ],
      }
    : {};

  const assignedWhere: Prisma.WorkOrderWhereInput = {
    AND: [accessScope, searchOr],
    technicians: { some: { id: user.id } },
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
  };
  const unassignedWhere: Prisma.WorkOrderWhereInput = {
    AND: [accessScope, searchOr],
    technicians: { none: {} },
    status: { notIn: ['COMPLETED', 'CANCELLED'] },
  };
  const historyWhere: Prisma.WorkOrderWhereInput = {
    AND: [accessScope, searchOr],
    technicians: { some: { id: user.id } },
    status: 'COMPLETED',
  };

  // Hent én rad mer enn vi viser, slik at «vis flere» bare dukker opp når det
  // faktisk finnes flere. Totalene vises i overskriftene, så ingenting ser ut
  // som at listen er komplett når den er avkortet.
  const [
    assignedRows,
    assignedTotal,
    unassignedRows,
    unassignedTotal,
    completedRows,
    completedTotal,
  ] = await Promise.all([
    prisma.workOrder.findMany({
      where: assignedWhere,
      select: LIST_SELECT,
      orderBy: { scheduledFor: 'asc' },
      take: assignedLimit + 1,
    }),
    prisma.workOrder.count({ where: assignedWhere }),
    prisma.workOrder.findMany({
      where: unassignedWhere,
      select: LIST_SELECT,
      orderBy: { scheduledFor: 'asc' },
      take: unassignedLimit + 1,
    }),
    prisma.workOrder.count({ where: unassignedWhere }),
    prisma.workOrder.findMany({
      where: historyWhere,
      select: LIST_SELECT,
      orderBy: { scheduledFor: 'desc' },
      take: historyLimit + 1,
    }),
    prisma.workOrder.count({ where: historyWhere }),
  ]);

  const activeAssigned = assignedRows.slice(0, assignedLimit);
  const unassignedWorkOrders = unassignedRows.slice(0, unassignedLimit);
  const completedAssigned = completedRows.slice(0, historyLimit);
  const hasMoreAssigned = assignedRows.length > assignedLimit;
  const hasMoreUnassigned = unassignedRows.length > unassignedLimit;
  const hasMoreHistory = completedRows.length > historyLimit;

  const moreHref = (
    key: "a" | "u" | "h",
    current: number,
    total: number,
  ) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (assignedLimit > LIST_PAGE_SIZE || key === "a") {
      params.set("a", String(key === "a" ? Math.min(total, current + LIST_PAGE_SIZE) : assignedLimit));
    }
    if (unassignedLimit > LIST_PAGE_SIZE || key === "u") {
      params.set("u", String(key === "u" ? Math.min(total, current + LIST_PAGE_SIZE) : unassignedLimit));
    }
    if (historyLimit > LIST_PAGE_SIZE || key === "h") {
      params.set("h", String(key === "h" ? Math.min(total, current + LIST_PAGE_SIZE) : historyLimit));
    }
    return `/mine-oppdrag?${params.toString()}`;
  };

  /**
   * Selvtilmelding. Klienten kan bare sende et oppdrags-id; autorisasjonen
   * kjøres på nytt her, og tjenestelaget kontrollerer avdeling, aktiv bruker og
   * at målet faktisk er ansatt i oppdragets avdeling. Fullførte/kansellerte
   * oppdrag avvises før tildelingen.
   */
  async function claimWorkOrder(formData: FormData) {
    "use server";
    // Autorisasjonen kjøres på nytt i handlingen, ikke bare ved render.
    const actor = await getCurrentUser();
    if (!actor || !actor.isActive) {
      redirect("/api/auth/signin");
    }
    if (!hasPermission(actor, "workorders.update")) {
      redirect("/mine-oppdrag?error=ikke-tilgang");
    }

    const parsedId = idSchema.safeParse(formData.get("workOrderId"));
    if (!parsedId.success) redirect("/mine-oppdrag?error=ugyldig-data");

    const target = await prisma.workOrder.findFirst({
      where: { id: parsedId.data, ...workOrderScope(actor) },
      select: { id: true, status: true },
    });
    if (!target) redirect("/mine-oppdrag?error=ikke-tilgang");
    if (target.status === "COMPLETED" || target.status === "CANCELLED") {
      redirect("/mine-oppdrag?error=workorder-locked");
    }

    const result = await workOrderService.addTechnician(
      actor,
      target.id,
      actor.id,
    );
    if (!result.ok) {
      redirect(`/mine-oppdrag?error=${encodeURIComponent(result.error)}`);
    }

    revalidatePath("/mine-oppdrag");
    revalidatePath(`/mine-oppdrag/${target.id}`);
    redirect("/mine-oppdrag?claimed=1");
  }

  /** Ring- og kartsnarveier. Kortet selv er ikke en lenke, så dette er trygt. */
  const contactShortcuts = (customer: ListCustomer | null) => {
    if (!customer) return null;
    const hasAddress = Boolean(formatAddress(customer));
    if (!customer.phone && !hasAddress) return null;

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {customer.phone && (
          <a
            href={`tel:${customer.phone}`}
            aria-label={t("orders.fieldList.callPhone", {
              phone: customer.phone,
            })}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800 transition hover:bg-blue-100"
          >
            📞 {t("orders.fieldList.call")}
          </a>
        )}
        {hasAddress && (
          <GoogleMapsLink
            address={customer.address}
            postalCode={customer.postalCode}
            city={customer.city}
            label={t("orders.fieldList.showMap")}
            newTabLabel={t("orders.fieldList.newTab")}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border-2 border-gray-200 bg-white px-3 text-xs font-bold no-underline hover:bg-gray-50"
          />
        )}
      </div>
    );
  };

  const claimError =
    resolvedParams.error === "ikke-tilgang"
      ? t("orders.fieldList.claimDenied")
      : resolvedParams.error === "workorder-locked"
        ? t("orders.fieldList.claimLocked")
        : resolvedParams.error
          ? t("orders.fieldList.claimError")
          : "";

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {resolvedParams.claimed && (
          <CustomerToast message={t("orders.fieldList.claimed")} />
        )}

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900">{t("orders.fieldList.greeting", { name: user.name || t("orders.detail.roleTechnician") })}</h1>
            <p className="text-sm text-gray-600 font-medium">
              {t("orders.fieldList.subtitle")}
              {user.department ? ` • ${t("orders.fieldList.department", { name: user.department.name })}` : ` • ${t("orders.fieldList.noDepartment")}`}
            </p>
          </div>
          <LogoutButton className="min-h-11 bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap disabled:opacity-60">
            {t("orders.fieldList.logOut")}
          </LogoutButton>
        </div>

        {claimError && (
          <div
            role="alert"
            className="rounded-2xl border-2 border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"
          >
            {claimError}
          </div>
        )}

        {/* SØKEFELT */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-200">
          <form method="GET" action="/mine-oppdrag" className="flex gap-2 sm:gap-3 flex-wrap">
            <input
              type="text"
              name="q"
              aria-label={t("orders.fieldList.search")}
              defaultValue={searchQuery}
              placeholder={t("orders.fieldList.searchPlaceholder")}
              className="flex-1 min-w-[200px] border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            />
            <button type="submit" className="min-h-11 bg-blue-700 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap text-sm">
              {t("orders.fieldList.search")}
            </button>
            {searchQuery && (
              <Link href="/mine-oppdrag" className="min-h-11 bg-gray-100 text-gray-700 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center whitespace-nowrap text-sm">
                {t("orders.fieldList.reset")}
              </Link>
            )}
          </form>
        </div>

        {/* SEKSJON 1: KALENDER / KOMMENDE OPPRETTEDE OPPRAG (Tildelt deg) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-gray-900">{t("orders.fieldList.upcomingTitle", { count: assignedTotal })}</h2>
          </div>

          {activeAssigned.length === 0 ? (
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 text-center">
              <p className="text-sm text-gray-600 italic">{t("orders.fieldList.noActive")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeAssigned.map(wo => (
                <article
                  key={wo.id}
                  className="bg-white border-2 border-gray-200 p-3 sm:p-4 rounded-2xl transition shadow-sm hover:border-blue-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <Link href={`/mine-oppdrag/${wo.id}`} className="min-w-0 flex-1">
                      <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                    </Link>
                    <StatusBadge status={wo.status} />
                  </div>

                  <p className="text-xs text-gray-600 font-medium">
                    🏢 {wo.customer?.name}
                    {wo.orderNumber && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
                        {t("orders.list.orderNumber")} {wo.orderNumber}
                      </span>
                    )}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-xs text-gray-600 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
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

                  {contactShortcuts(wo.customer)}

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs pt-2 mt-2 border-t border-gray-100 text-gray-600 font-medium">
                    <span className="font-bold text-gray-700 bg-gray-100 px-2 py-1 rounded-lg">
                      📅 {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("orders.fieldList.noDate")}
                    </span>
                    <Link href={`/mine-oppdrag/${wo.id}`} className="inline-flex min-h-11 items-center font-black text-blue-700 hover:underline whitespace-nowrap">
                      {t("orders.fieldList.openWorkOrder")}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          {hasMoreAssigned && (
            <p className="text-center">
              <Link
                href={moreHref("a", assignedLimit, assignedTotal)}
                className="inline-flex min-h-11 items-center rounded-xl border-2 border-blue-200 bg-white px-5 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-50"
              >
                {t("orders.fieldList.loadMore", {
                  count: Math.min(
                    LIST_PAGE_SIZE,
                    assignedTotal - activeAssigned.length,
                  ),
                })}
              </Link>
            </p>
          )}
        </div>

        {/* SEKSJON 2: IKKE TILDELTE OPPDRAG */}
        {unassignedTotal > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900">{t("orders.fieldList.unassignedTitle", { count: unassignedTotal })}</h2>
              <span className="text-xs bg-amber-100 text-amber-900 font-bold px-2 py-1 rounded-full">{t("orders.fieldList.requiresAssignment")}</span>
            </div>

            <div className="space-y-3">
              {unassignedWorkOrders.map(wo => (
                <article
                  key={wo.id}
                  className="bg-amber-50/40 border-2 border-amber-200 p-3 sm:p-4 rounded-2xl transition shadow-sm hover:border-amber-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <Link href={`/mine-oppdrag/${wo.id}`} className="min-w-0 flex-1">
                      <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                    </Link>
                    <StatusBadge status={wo.status} />
                  </div>

                  <p className="text-xs text-gray-600 font-medium">
                    🏢 {wo.customer?.name}
                    {wo.orderNumber && (
                      <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-bold text-gray-700">
                        {t("orders.list.orderNumber")} {wo.orderNumber}
                      </span>
                    )}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-xs text-gray-600 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}

                  {contactShortcuts(wo.customer)}

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs pt-2 mt-2 border-t border-amber-200 text-gray-600 font-medium">
                    <span className="font-bold bg-white px-2 py-1 rounded-lg border border-amber-200">
                      📅 {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("orders.fieldList.noDate")}
                    </span>
                    {canClaim ? (
                      <form action={claimWorkOrder} className="sm:flex-none">
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <SubmitButton
                          pendingLabel={t("orders.fieldList.takingWorkOrder")}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-amber-800 sm:w-auto"
                        >
                          {t("orders.fieldList.takeWorkOrder")}
                        </SubmitButton>
                      </form>
                    ) : (
                      <Link
                        href={`/mine-oppdrag/${wo.id}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-amber-300 bg-white px-4 py-2 text-sm font-black text-amber-900 transition hover:bg-amber-50"
                      >
                        {t("orders.fieldList.openWorkOrder")}
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {hasMoreUnassigned && (
              <p className="text-center">
                <Link
                  href={moreHref("u", unassignedLimit, unassignedTotal)}
                  className="inline-flex min-h-11 items-center rounded-xl border-2 border-amber-300 bg-white px-5 py-2.5 text-sm font-bold text-amber-900 hover:bg-amber-50"
                >
                  {t("orders.fieldList.loadMore", {
                    count: Math.min(
                      LIST_PAGE_SIZE,
                      unassignedTotal - unassignedWorkOrders.length,
                    ),
                  })}
                </Link>
              </p>
            )}
          </div>
        )}

        {/* SEKSJON 3: HISTORIKK OVER FULLFØRTE OPPDRAG */}
        {completedTotal > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h2 className="text-lg font-black text-gray-900">{t("orders.fieldList.historyTitle", { count: completedTotal })}</h2>

            <div className="space-y-3">
              {completedAssigned.map(wo => (
                <article
                  key={wo.id}
                  className="bg-white border-2 border-gray-200 p-3 sm:p-4 rounded-2xl transition shadow-sm hover:border-gray-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                    <Link href={`/mine-oppdrag/${wo.id}`} className="min-w-0 flex-1">
                      <h3 className="font-bold text-gray-800 text-base">{wo.title}</h3>
                    </Link>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="text-xs text-gray-600 font-medium">
                    {t("orders.fieldList.archived", { customer: wo.customer?.name || t("orders.reportsPage.noCustomer") })}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-xs text-gray-600 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}

                  {contactShortcuts(wo.customer)}

                  <div className="mt-2 flex justify-end">
                    <Link href={`/mine-oppdrag/${wo.id}`} className="inline-flex min-h-11 items-center text-xs font-black text-blue-700 hover:underline whitespace-nowrap">
                      {t("orders.fieldList.openWorkOrder")}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
            {hasMoreHistory && (
              <p className="text-center">
                <Link
                  href={moreHref("h", historyLimit, completedTotal)}
                  className="inline-flex min-h-11 items-center rounded-xl border-2 border-gray-300 bg-white px-5 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50"
                >
                  {t("orders.fieldList.loadMore", {
                    count: Math.min(
                      LIST_PAGE_SIZE,
                      completedTotal - completedAssigned.length,
                    ),
                  })}
                </Link>
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
