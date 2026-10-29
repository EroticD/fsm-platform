import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateRangeLocalized,
  parseDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { effectiveAddress } from "@/lib/geocode";
import { scheduledTodayWhere } from "@/lib/work-order-date-where";
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

/**
 * Felles utvalg for alle kortene. Kontaktpersonen hører med, slik at montøren
 * kan ringe oppdragskontakten – ikke bare kundens hovedtelefon. Kladden er
 * brukerens egen, og hentes bare for de oppdragene som faktisk vises.
 */
function listSelect(userId: string) {
  return {
    id: true,
    title: true,
    orderNumber: true,
    status: true,
    address: true,
    postalCode: true,
    city: true,
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
    contact: { select: { id: true, name: true, phone: true, email: true } },
    tags: { select: { id: true, name: true, color: true } },
    reportDrafts: {
      where: { userId },
      orderBy: { updatedAt: "desc" as const },
      take: 1,
      select: { templateId: true, updatedAt: true },
    },
  } as const;
}

type ListWorkOrder = Prisma.WorkOrderGetPayload<{
  select: ReturnType<typeof listSelect>;
}>;

type CardTone = "default" | "overdue" | "available" | "history";

const CARD_TONES: Record<CardTone, string> = {
  default: "border-gray-200 bg-white hover:border-blue-300",
  overdue: "border-red-200 bg-red-50/30 hover:border-red-300",
  available: "border-amber-200 bg-amber-50/40 hover:border-amber-300",
  history: "border-gray-200 bg-white hover:border-gray-300",
};

const BADGE_TONES: Record<string, string> = {
  red: "bg-red-100 text-red-900",
  amber: "bg-amber-100 text-amber-900",
  blue: "bg-blue-100 text-blue-900",
  gray: "bg-gray-100 text-gray-700",
};

const LOAD_MORE_TONES: Record<keyof typeof BADGE_TONES, string> = {
  red: "border-red-300 text-red-900 hover:bg-red-50",
  amber: "border-amber-300 text-amber-900 hover:bg-amber-50",
  blue: "border-blue-200 text-blue-800 hover:bg-blue-50",
  gray: "border-gray-300 text-gray-800 hover:bg-gray-50",
};

export async function generateMetadata(): Promise<Metadata> {
  const [t, user] = await Promise.all([
    getTranslations("common"),
    getCurrentUser(),
  ]);
  return {
    title:
      user?.role === "TECHNICIAN"
        ? t("nav.today")
        : t("metadata.routes.mineOppdrag"),
  };
}

function dayContext() {
  const startOfToday = parseDateOnly(todayInOslo()) ?? new Date();
  return { startOfToday, endOfToday: addDaysUtc(startOfToday, 1) };
}

/**
 * Én seksjon i prioritetsstakken. Antallet er totalen fra databasen, mens
 * listen kan være avkortet, slik at «vis flere» bare vises når det finnes mer.
 */
function PrioritySection({
  id,
  title,
  count,
  empty,
  tone,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  tone: keyof typeof BADGE_TONES;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          id={`${id}-title`}
          className="text-lg font-black text-gray-900"
        >
          {title}
        </h2>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-black ${BADGE_TONES[tone]}`}
        >
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600">
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
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
  const isFieldHome = user.role === "TECHNICIAN";
  const { startOfToday, endOfToday } = dayContext();

  const searchOr: Prisma.WorkOrderWhereInput = searchQuery
    ? {
        OR: [
          { title: { contains: searchQuery, mode: "insensitive" } },
          { orderNumber: { contains: searchQuery, mode: "insensitive" } },
          { description: { contains: searchQuery, mode: "insensitive" } },
          {
            customer: {
              name: { contains: searchQuery, mode: "insensitive" },
            },
          },
          {
            customer: {
              city: { contains: searchQuery, mode: "insensitive" },
            },
          },
          {
            customer: {
              address: { contains: searchQuery, mode: "insensitive" },
            },
          },
          {
            contact: {
              name: { contains: searchQuery, mode: "insensitive" },
            },
          },
        ],
      }
    : {};

  const openStatus: Prisma.WorkOrderWhereInput = {
    status: { notIn: ["COMPLETED", "CANCELLED"] },
  };
  const assignedBase: Prisma.WorkOrderWhereInput = {
    AND: [accessScope, searchOr],
    technicians: { some: { id: user.id } },
    ...openStatus,
  };

  // De fire seksjonene er gjensidig utelukkende: et oppdrag som er forfalt
  // havner aldri i «I dag» eller «Senere» samtidig. Ledige oppdrag er de som
  // fortsatt ikke har noen montør, og kan derfor aldri duplisere de tildelte.
  const overdueWhere: Prisma.WorkOrderWhereInput = {
    AND: [
      assignedBase,
      { scheduledFor: { lt: startOfToday } },
      { OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }] },
    ],
  };
  const todayWhere: Prisma.WorkOrderWhereInput = {
    AND: [assignedBase, scheduledTodayWhere(startOfToday, endOfToday)],
  };
  const laterWhere: Prisma.WorkOrderWhereInput = {
    AND: [
      assignedBase,
      {
        OR: [{ scheduledFor: { gte: endOfToday } }, { scheduledFor: null }],
      },
    ],
  };
  const unassignedWhere: Prisma.WorkOrderWhereInput = {
    AND: [accessScope, searchOr],
    technicians: { none: {} },
    ...openStatus,
  };
  const historyWhere: Prisma.WorkOrderWhereInput = {
    AND: [accessScope, searchOr],
    technicians: { some: { id: user.id } },
    status: "COMPLETED",
  };

  // Hent én rad mer enn vi viser, slik at «vis flere» bare dukker opp når det
  // faktisk finnes flere. Totalene vises i overskriftene.
  const [
    overdueRows,
    overdueTotal,
    todayRows,
    todayTotal,
    laterRows,
    laterTotal,
    unassignedRows,
    unassignedTotal,
    completedRows,
    completedTotal,
  ] = await Promise.all([
    prisma.workOrder.findMany({
      where: overdueWhere,
      select: listSelect(user.id),
      orderBy: { scheduledFor: "asc" },
      take: assignedLimit + 1,
    }),
    prisma.workOrder.count({ where: overdueWhere }),
    prisma.workOrder.findMany({
      where: todayWhere,
      select: listSelect(user.id),
      orderBy: { scheduledFor: "asc" },
      take: assignedLimit + 1,
    }),
    prisma.workOrder.count({ where: todayWhere }),
    prisma.workOrder.findMany({
      where: laterWhere,
      select: listSelect(user.id),
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: assignedLimit + 1,
    }),
    prisma.workOrder.count({ where: laterWhere }),
    prisma.workOrder.findMany({
      where: unassignedWhere,
      select: listSelect(user.id),
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: unassignedLimit + 1,
    }),
    prisma.workOrder.count({ where: unassignedWhere }),
    prisma.workOrder.findMany({
      where: historyWhere,
      select: listSelect(user.id),
      orderBy: { scheduledFor: "desc" },
      take: historyLimit + 1,
    }),
    prisma.workOrder.count({ where: historyWhere }),
  ]);

  const overdueVisible = overdueRows.slice(0, assignedLimit);
  const todayVisible = todayRows.slice(0, assignedLimit);
  const laterVisible = laterRows.slice(0, assignedLimit);
  const unassignedVisible = unassignedRows.slice(0, unassignedLimit);
  const completedAssigned = completedRows.slice(0, historyLimit);
  const assignedTotal = overdueTotal + todayTotal + laterTotal;

  const moreHref = (key: "a" | "u" | "h", current: number, total: number) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    const next = (limit: number) =>
      Math.min(total, limit + LIST_PAGE_SIZE);
    const a = key === "a" ? next(assignedLimit) : assignedLimit;
    const u = key === "u" ? next(unassignedLimit) : unassignedLimit;
    const h = key === "h" ? next(historyLimit) : historyLimit;
    if (a > LIST_PAGE_SIZE) params.set("a", String(a));
    if (u > LIST_PAGE_SIZE) params.set("u", String(u));
    if (h > LIST_PAGE_SIZE) params.set("h", String(h));
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

  const claimError =
    resolvedParams.error === "ikke-tilgang"
      ? t("orders.fieldList.claimDenied")
      : resolvedParams.error === "workorder-locked"
        ? t("orders.fieldList.claimLocked")
        : resolvedParams.error
          ? t("orders.fieldList.claimError")
          : "";

  const renderCard = (wo: ListWorkOrder, tone: CardTone = "default") => {
    const detailHref = `/mine-oppdrag/${wo.id}`;
    const address = effectiveAddress(wo);
    const contact = wo.contact;
    const phone = contact?.phone?.trim() || wo.customer?.phone?.trim() || "";
    const draft = wo.reportDrafts[0];
    const draftTime = draft
      ? formatDateLocalized(draft.updatedAt, locale, {
          timeStyle: "short",
        })
      : "";
    const dateLabel =
      formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) ||
      t("orders.fieldList.noDate");

    return (
      <article
        key={wo.id}
        className={`relative rounded-2xl border-2 p-3 shadow-sm transition focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 sm:p-4 ${CARD_TONES[tone]}`}
      >
        {/* Hele kortet er én lenke. Interaktive snarveier ligger over med
            pointer-events, slik at vi slipper lenker inne i lenker. */}
        <Link
          href={detailHref}
          aria-label={t("orders.fieldList.openWorkOrderAria", {
            title: wo.title,
          })}
          className="absolute inset-0 z-0 rounded-2xl"
        />
        <div className="pointer-events-none relative z-10 flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 min-w-0 flex-1 text-base font-black leading-snug text-gray-900">
              {wo.title}
            </h3>
            <span className="shrink-0 self-start">
              <StatusBadge status={wo.status} />
            </span>
          </div>

          <p className="text-xs font-medium text-gray-600">
            🏢 {wo.customer?.name || t("orders.reportsPage.noCustomer")}
            {wo.orderNumber && (
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
                {t("orders.list.orderNumber")} {wo.orderNumber}
              </span>
            )}
          </p>

          {contact && (
            <p className="text-xs font-medium text-gray-600">
              👤 {contact.name}
              {contact.phone ? ` · 📞 ${contact.phone}` : ""}
            </p>
          )}

          {address.query && (
            <p className="text-xs font-medium text-gray-600">
              📍 {address.query}
            </p>
          )}

          {wo.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {wo.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full px-2 py-0.5 text-xs font-bold shadow-sm"
                  suppressHydrationWarning
                  style={{
                    backgroundColor: tag.color || "#3b82f6",
                    color: readableTextColor(tag.color || "#3b82f6"),
                  }}
                >
                  🏷️ {tag.name}
                </span>
              ))}
            </div>
          )}

          {draft && (
            <Link
              href={`/mine-oppdrag/${wo.id}/skjema/${draft.templateId}`}
              className="pointer-events-auto relative z-20 inline-flex w-fit items-center gap-1 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-900 transition hover:bg-blue-100"
            >
              {t("orders.fieldList.draftBadge", { time: draftTime })}
              <span aria-hidden>·</span>
              {t("orders.fieldList.draftContinue")}
            </Link>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {phone && (
              <a
                href={`tel:${phone}`}
                aria-label={t("orders.fieldList.callPhone", { phone })}
                className="pointer-events-auto relative z-20 inline-flex min-h-11 items-center gap-1 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800 transition hover:bg-blue-100"
              >
                📞 {t("orders.fieldList.call")}
              </a>
            )}
            {address.query && (
              <GoogleMapsLink
                address={address.address}
                postalCode={address.postalCode}
                city={address.city}
                label={t("orders.fieldList.showMap")}
                newTabLabel={t("orders.fieldList.newTab")}
                className="pointer-events-auto relative z-20 inline-flex min-h-11 items-center rounded-xl border-2 border-gray-200 bg-white px-3 text-xs font-bold no-underline hover:bg-gray-50"
              />
            )}
            {tone === "available" && canClaim && (
              <form
                action={claimWorkOrder}
                className="pointer-events-auto relative z-20"
              >
                <input type="hidden" name="workOrderId" value={wo.id} />
                <SubmitButton
                  pendingLabel={t("orders.fieldList.takingWorkOrder")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-amber-800"
                >
                  {t("orders.fieldList.takeWorkOrder")}
                </SubmitButton>
              </form>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs font-medium text-gray-600">
            <span className="rounded-lg bg-gray-100 px-2 py-1 font-bold text-gray-700">
              📅 {dateLabel}
            </span>
            <span className="font-black text-blue-700">
              {t("orders.fieldList.openWorkOrder")}
            </span>
          </div>
        </div>
      </article>
    );
  };

  const loadMore = (
    key: "a" | "u" | "h",
    current: number,
    total: number,
    tone: keyof typeof BADGE_TONES,
  ) => {
    if (total <= current) return null;
    return (
      <p className="text-center">
        <Link
          href={moreHref(key, current, total)}
          className={`inline-flex min-h-11 items-center rounded-xl border-2 bg-white px-5 py-2.5 text-sm font-bold ${LOAD_MORE_TONES[tone]}`}
        >
          {t("orders.fieldList.loadMore", {
            count: Math.min(LIST_PAGE_SIZE, total - current),
          })}
        </Link>
      </p>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {resolvedParams.claimed && (
          <CustomerToast message={t("orders.fieldList.claimed")} />
        )}

        {/* HEADER */}
        <div className="flex flex-col justify-between gap-3 border-b border-gray-300 pb-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-xl font-black text-gray-900 sm:text-2xl">
              {isFieldHome
                ? t("orders.fieldList.todayPageTitle")
                : t("nav.myWorkOrders")}
            </h1>
            <p className="text-sm font-medium text-gray-600">
              {t("orders.fieldList.greeting", {
                name: user.name || t("orders.detail.roleTechnician"),
              })}
              {user.department
                ? ` • ${t("orders.fieldList.department", { name: user.department.name })}`
                : ` • ${t("orders.fieldList.noDepartment")}`}
            </p>
          </div>
          <LogoutButton className="min-h-11 whitespace-nowrap rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-100 disabled:opacity-60">
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
        <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
          <form
            method="GET"
            action="/mine-oppdrag"
            className="flex flex-wrap gap-2 sm:gap-3"
          >
            <input
              type="text"
              name="q"
              aria-label={t("orders.fieldList.search")}
              defaultValue={searchQuery}
              placeholder={t("orders.fieldList.searchPlaceholder")}
              className="min-w-[200px] flex-1 rounded-xl border-2 border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-900 outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              className="min-h-11 whitespace-nowrap rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
            >
              {t("orders.fieldList.search")}
            </button>
            {searchQuery && (
              <Link
                href="/mine-oppdrag"
                className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-200"
              >
                {t("orders.fieldList.reset")}
              </Link>
            )}
          </form>
        </div>

        {/* Tomtilstanden skal aldri påstå at det ikke finnes jobb når det
            ligger ledige oppdrag og venter på en montør. */}
        {assignedTotal === 0 && unassignedTotal > 0 && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-950">
              {t("orders.fieldList.assignedEmptyWithAvailable")}
            </p>
            {canClaim && (
              <a
                href="#ledige"
                className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-amber-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-amber-800"
              >
                {t("orders.fieldList.takeWorkOrderCta")}
              </a>
            )}
          </div>
        )}

        {assignedTotal === 0 && unassignedTotal === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
            <p className="text-sm italic text-gray-600">
              {t("orders.fieldList.noActive")}
            </p>
          </div>
        )}

        {/* PRIORITETSSTAKK: forfalt først, deretter dagens, ledige og senere. */}
        <div className="space-y-6">
          <PrioritySection
            id="forfalt"
            title={t("orders.fieldList.priorityOverdue")}
            count={overdueTotal}
            empty={t("orders.fieldList.overdueEmpty")}
            tone="red"
          >
            <div className="space-y-3">
              {overdueVisible.map((wo) => renderCard(wo, "overdue"))}
            </div>
            {loadMore("a", assignedLimit, overdueTotal, "red")}
          </PrioritySection>

          <PrioritySection
            id="idag"
            title={t("orders.fieldList.priorityToday")}
            count={todayTotal}
            empty={t("orders.fieldList.todayEmpty")}
            tone="blue"
          >
            <div className="space-y-3">
              {todayVisible.map((wo) => renderCard(wo, "default"))}
            </div>
            {loadMore("a", assignedLimit, todayTotal, "blue")}
          </PrioritySection>

          <PrioritySection
            id="ledige"
            title={t("orders.fieldList.priorityAvailable")}
            count={unassignedTotal}
            empty={t("orders.fieldList.availableEmpty")}
            tone="amber"
          >
            <p className="text-xs font-medium text-gray-600">
              {t("orders.fieldList.availableDescription")}
            </p>
            <div className="space-y-3">
              {unassignedVisible.map((wo) => renderCard(wo, "available"))}
            </div>
            {loadMore("u", unassignedLimit, unassignedTotal, "amber")}
          </PrioritySection>

          <PrioritySection
            id="senere"
            title={t("orders.fieldList.priorityLater")}
            count={laterTotal}
            empty={t("orders.fieldList.laterEmpty")}
            tone="gray"
          >
            <div className="space-y-3">
              {laterVisible.map((wo) => renderCard(wo, "default"))}
            </div>
            {loadMore("a", assignedLimit, laterTotal, "gray")}
          </PrioritySection>
        </div>

        {/* HISTORIKK: fullførte oppdrag holdes utenfor prioritetsstakken. */}
        {completedTotal > 0 && (
          <div className="space-y-4 border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-gray-900">
                {t("orders.fieldList.historyTitle", { count: completedTotal })}
              </h2>
            </div>
            <div className="space-y-3">
              {completedAssigned.map((wo) => renderCard(wo, "history"))}
            </div>
            {loadMore("h", historyLimit, completedTotal, "gray")}
          </div>
        )}
      </div>
    </div>
  );
}
