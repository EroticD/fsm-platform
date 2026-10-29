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
    templates: {
      select: { id: true, title: true },
      orderBy: { title: "asc" as const },
    },
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
type CardSurface = "dark" | "paper";

/** Field Pulse-flatene. */
const DARK_APP = "field-app";

const CARD_TONES: Record<CardTone, string> = {
  default: "field-card transition hover:brightness-110",
  overdue: "field-card ring-1 ring-risk/30 transition hover:brightness-110",
  available:
    "field-card ring-1 ring-signal/25 transition hover:brightness-110",
  history: "field-sheet transition hover:brightness-105",
};

const PAPER_CARD_TONES: Record<CardTone, string> = {
  default: "field-sheet transition hover:brightness-105",
  overdue: "field-sheet ring-1 ring-risk/25 transition hover:brightness-105",
  available:
    "field-sheet ring-1 ring-signal/25 transition hover:brightness-105",
  history: "field-sheet transition hover:brightness-105",
};

const BADGE_TONES = {
  risk: "bg-risk text-ink",
  signal: "bg-signal text-ink",
  neutral: "bg-white/10 text-paper/85",
} as const;

function jobTimeLabel(value: Date | null, locale: string): string {
  if (!value) return "09:00";
  const hours = value.getUTCHours();
  const minutes = value.getUTCMinutes();
  // Datoene i feltportalen er rene kalenderdatoer. Da viser vi feltets faste
  // oppmøtetid i stedet for en misvisende 00:00.
  if (hours === 0 && minutes === 0) return "09:00";
  return (
    formatDateLocalized(value, locale, { timeStyle: "short" }) || "09:00"
  );
}

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
      <div className="flex items-center justify-between gap-2 px-1">
        <h2
          id={`${id}-title`}
          className="text-sm font-black uppercase tracking-[0.18em] text-paper/80"
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
        <p className="field-card px-4 py-3 text-sm font-medium text-paper/70">
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  );
}

function PaperSheet({
  id,
  title,
  count,
  hint,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="field-sheet p-4 shadow-[0_22px_50px_rgba(0,0,0,0.22)] sm:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={id ? `${id}-title` : undefined}
          className="text-lg font-black tracking-tight text-ink"
        >
          {title}
        </h2>
        {typeof count === "number" && (
          <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-black text-ink">
            {count}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs font-medium text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
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

  const hero = todayVisible[0] ?? laterVisible[0] ?? null;
  const heroIsToday = Boolean(hero && todayVisible[0]?.id === hero.id);
  const todayAfterHero = todayVisible.slice(heroIsToday ? 1 : 0);
  const laterAfterHero =
    hero && !heroIsToday ? laterVisible.slice(1) : laterVisible;
  const laterSheetCount =
    Math.max(0, todayTotal - (heroIsToday ? 1 : 0)) +
    Math.max(0, laterTotal - (hero && !heroIsToday ? 1 : 0));
  const heroAddress = hero ? effectiveAddress(hero) : null;
  const heroPhone =
    hero?.contact?.phone?.trim() || hero?.customer?.phone?.trim() || "";
  const heroDraft = hero?.reportDrafts[0];
  const heroTemplateId = heroDraft?.templateId ?? hero?.templates[0]?.id;
  const heroHref = hero
    ? heroTemplateId
      ? `/mine-oppdrag/${hero.id}/skjema/${heroTemplateId}`
      : `/mine-oppdrag/${hero.id}`
    : "";
  const heroDateLabel = hero
    ? formatDateLocalized(hero.scheduledFor, locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }) || t("orders.fieldList.noDate")
    : "";
  const heroTime = jobTimeLabel(hero?.scheduledFor ?? null, locale);
  const heroDraftTime = heroDraft
    ? formatDateLocalized(heroDraft.updatedAt, locale, { timeStyle: "short" })
    : "";

  const renderCard = (
    wo: ListWorkOrder,
    tone: CardTone = "default",
    surface: CardSurface = "dark",
  ) => {
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
    const onPaper = surface === "paper";
    const titleClass = onPaper ? "text-ink" : "text-paper";
    const mutedClass = onPaper ? "text-muted" : "text-paper/70";
    const metaChip = onPaper
      ? "bg-white/60 text-ink"
      : "bg-white/[0.07] text-paper/80";
    const phoneClass = onPaper
      ? "border-line bg-white text-success hover:bg-signal/15"
      : "border-signal/35 bg-signal/10 text-signal hover:bg-signal/20";
    const mapClass = onPaper
      ? "border-line bg-white text-ink hover:bg-white/70"
      : "border-[#2a3328] bg-white/5 text-paper/90 hover:border-signal/60";
    const footerClass = onPaper ? "border-line" : "border-[#2a3328]";
    const openClass = onPaper ? "text-success" : "text-signal";
    const cardTone = onPaper ? PAPER_CARD_TONES[tone] : CARD_TONES[tone];
    const focusOffset = onPaper
      ? "focus-within:ring-success"
      : "focus-within:ring-signal";

    return (
      <article
        key={wo.id}
        className={`relative rounded-2xl border-2 p-3 shadow-sm transition focus-within:ring-2 focus-within:ring-offset-2 ${focusOffset} ${cardTone}`}
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
            <h3
              className={`line-clamp-2 min-w-0 flex-1 text-[15px] font-black leading-snug ${titleClass}`}
            >
              {wo.title}
            </h3>
            <span className="shrink-0 self-start">
              <StatusBadge status={wo.status} />
            </span>
          </div>

          <p className={`text-xs font-medium ${mutedClass}`}>
            🏢 {wo.customer?.name || t("orders.reportsPage.noCustomer")}
            {wo.orderNumber && (
              <span className={`ml-2 rounded px-1.5 py-0.5 font-bold ${metaChip}`}>
                {t("orders.list.orderNumber")} {wo.orderNumber}
              </span>
            )}
          </p>

          {contact && (
            <p className={`text-xs font-medium ${mutedClass}`}>
              👤 {contact.name}
              {contact.phone ? ` · 📞 ${contact.phone}` : ""}
            </p>
          )}

          {address.query && (
            <p className={`text-xs font-medium ${mutedClass}`}>
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
              className="signal-button pointer-events-auto relative z-20 w-fit text-xs shadow-sm"
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
                className={`pointer-events-auto relative z-20 inline-flex min-h-11 items-center gap-1 rounded-xl border-2 px-3 text-xs font-bold transition ${phoneClass}`}
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
                className={`pointer-events-auto relative z-20 inline-flex min-h-11 items-center rounded-xl border-2 px-3 text-xs font-bold no-underline transition ${mapClass}`}
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
                  className="signal-button text-sm shadow-sm"
                >
                  {t("orders.fieldList.takeWorkOrder")}
                </SubmitButton>
              </form>
            )}
          </div>

          <div
            className={`mt-1 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs font-medium ${footerClass} ${mutedClass}`}
          >
            <span className={`rounded-lg px-2 py-1 font-bold ${metaChip}`}>
              📅 {dateLabel}
            </span>
            <span className={`font-black ${openClass}`}>
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
    surface: CardSurface = "dark",
  ) => {
    if (total <= current) return null;
    return (
      <p className="text-center">
        <Link
          href={moreHref(key, current, total)}
          className={`inline-flex min-h-11 items-center px-5 py-2.5 text-sm font-bold transition hover:brightness-105 ${
            surface === "paper" ? "field-sheet" : "field-card"
          }`}
        >
          {t("orders.fieldList.loadMore", {
            count: Math.min(LIST_PAGE_SIZE, total - current),
          })}
        </Link>
      </p>
    );
  };

  const todayLabel =
    formatDateLocalized(startOfToday, locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }) || "";

  return (
    <div
      className={`min-h-screen ${DARK_APP} p-4 pb-32 sm:p-6 sm:pb-12`}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {resolvedParams.claimed && (
          <CustomerToast message={t("orders.fieldList.claimed")} />
        )}

        {/* STATUSLINJE */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-black uppercase tracking-[0.22em] text-paper/60">
              <span className="inline-flex h-2 w-2 rounded-full bg-signal shadow-[0_0_0_4px_rgba(217,255,67,0.12)]" />
              {isFieldHome
                ? t("orders.fieldList.fieldMode")
                : t("nav.myWorkOrders")}
              <span aria-hidden className="text-paper/30">·</span>
              <span className="normal-case tracking-normal text-paper/80">
                {todayLabel}
              </span>
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-paper sm:text-3xl">
              {t("orders.fieldList.greeting", {
                name: user.name || t("orders.detail.roleTechnician"),
              })}
            </h1>
            <p className="mt-1 text-xs font-bold text-paper/70">
              {user.department
                ? t("orders.fieldList.department", {
                    name: user.department.name,
                  })
                : t("orders.fieldList.noDepartment")}
            </p>
          </div>
          <LogoutButton className="min-h-11 shrink-0 rounded-xl border border-[#2a3328] bg-field-card px-3 py-2 text-xs font-bold text-paper/85 shadow-sm transition hover:bg-white/10 disabled:opacity-60">
            {t("orders.fieldList.logOut")}
          </LogoutButton>
        </header>

        {claimError && (
          <div
            role="alert"
            className="rounded-2xl border-2 border-risk/50 bg-risk/10 p-3 text-sm font-bold text-risk"
          >
            {claimError}
          </div>
        )}

        {/* NESTE JOBB – det viktigste valget på hele skjermen. */}
        {hero ? (
          <section className="field-hero relative overflow-hidden p-5 shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:p-6">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-signal/15 blur-3xl"
            />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-signal">
                    {t("orders.fieldList.nextJob")}
                  </p>
                  <p className="mt-1 text-xs font-bold text-paper/70">
                    {heroDateLabel}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-xl border border-signal/25 bg-field px-3 py-1.5 text-lg font-black leading-none text-signal">
                    {heroTime}
                  </span>
                  <span
                    aria-label={t("orders.fieldList.jobPosition", {
                      current: 1,
                      total: Math.max(assignedTotal, 1),
                    })}
                    className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-black text-paper/80"
                  >
                    1/{Math.max(assignedTotal, 1)}
                  </span>
                </div>
              </div>

              <h2 className="mt-4 text-2xl font-black leading-tight tracking-tight text-paper sm:text-3xl">
                {hero.title}
              </h2>
              <p className="mt-2 text-sm font-bold text-paper/90">
                🏢 {hero.customer?.name || t("orders.reportsPage.noCustomer")}
              </p>
              {heroAddress?.query && (
                <p className="mt-1 text-sm font-medium text-paper/70">
                  📍 {heroAddress.query}
                </p>
              )}
              {hero.contact && (
                <p className="mt-1 text-xs font-medium text-paper/55">
                  👤 {hero.contact.name}
                </p>
              )}

              {heroDraft && (
                <Link
                  href={`/mine-oppdrag/${hero.id}/skjema/${heroDraft.templateId}`}
                  className="signal-button mt-3 w-fit text-xs shadow-sm"
                >
                  {t("orders.fieldList.draftBadge", { time: heroDraftTime })}
                  <span aria-hidden>·</span>
                  {t("orders.fieldList.draftContinue")}
                </Link>
              )}

              <div className="mt-5 space-y-2">
                <Link
                  href={heroHref}
                  className="field-cta w-full justify-between px-5 text-lg shadow-[0_16px_36px_rgba(217,255,67,0.16)]"
                >
                  <span>
                    {!heroTemplateId
                      ? t("orders.fieldList.openJob")
                      : heroDraft
                        ? t("orders.fieldList.continueForm")
                        : t("orders.fieldList.startForm")}
                  </span>
                  <span aria-hidden className="text-2xl">→</span>
                </Link>

                <div className="flex gap-2">
                  {heroPhone && (
                    <a
                      href={`tel:${heroPhone}`}
                      aria-label={t("orders.fieldList.callPhone", {
                        phone: heroPhone,
                      })}
                      className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#2a3328] bg-white/5 px-4 text-sm font-black text-paper transition hover:border-signal/60 hover:bg-white/10"
                    >
                      📞 {t("orders.fieldList.call")}
                    </a>
                  )}
                  {heroAddress?.query && (
                    <GoogleMapsLink
                      address={heroAddress.address}
                      postalCode={heroAddress.postalCode}
                      city={heroAddress.city}
                      label={`🗺️ ${t("orders.fieldList.showMap")}`}
                      newTabLabel={t("orders.fieldList.newTab")}
                      className="inline-flex min-h-14 flex-1 items-center justify-center rounded-2xl border border-[#2a3328] bg-white/5 px-4 text-sm font-black text-paper no-underline transition hover:border-signal/60 hover:bg-white/10"
                    />
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="field-card p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-signal">
              {t("orders.fieldList.nextJob")}
            </p>
            <p className="mt-2 text-xl font-black text-paper">
              {t("orders.fieldList.heroEmpty")}
            </p>
            <p className="mt-1 text-sm font-medium text-paper/70">
              {t("orders.fieldList.heroEmptyHint")}
            </p>
          </section>
        )}

        {/* SØKEFELT */}
        <div className="field-card p-2">
          <form
            method="GET"
            action="/mine-oppdrag"
            className="flex flex-wrap gap-2"
          >
            <input
              type="text"
              name="q"
              aria-label={t("orders.fieldList.search")}
              defaultValue={searchQuery}
              placeholder={t("orders.fieldList.searchPlaceholder")}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#2a3328] bg-field px-3 text-sm font-bold text-paper outline-none transition placeholder:text-paper/65! focus:border-signal"
            />
            <button
              type="submit"
              className="min-h-11 whitespace-nowrap rounded-xl bg-white/10 px-5 text-sm font-bold text-paper transition hover:bg-white/15"
            >
              {t("orders.fieldList.search")}
            </button>
            {searchQuery && (
              <Link
                href="/mine-oppdrag"
                className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl border border-[#2a3328] px-4 text-sm font-bold text-paper/80 transition hover:bg-white/10"
              >
                {t("orders.fieldList.reset")}
              </Link>
            )}
          </form>
        </div>

        {/* Tomtilstanden skal aldri påstå at det ikke finnes jobb når det
            ligger ledige oppdrag og venter på en montør. */}
        {assignedTotal === 0 && unassignedTotal > 0 && (
          <div className="field-card ring-1 ring-signal/40 p-4">
            <p className="text-sm font-bold text-signal">
              {t("orders.fieldList.assignedEmptyWithAvailable")}
            </p>
            {canClaim && (
              <a
                href="#ledige"
                className="signal-button mt-2 text-sm shadow-sm"
              >
                {t("orders.fieldList.takeWorkOrderCta")}
              </a>
            )}
          </div>
        )}

        {assignedTotal === 0 && unassignedTotal === 0 && (
          <div className="field-card p-4 text-center">
            <p className="text-sm italic text-paper/70">
              {t("orders.fieldList.noActive")}
            </p>
          </div>
        )}

        {/* PRIORITETSSTAKK: forfalt og ledige er kompakte mørke kort. */}
        <div className="space-y-6">
          <PrioritySection
            id="forfalt"
            title={t("orders.fieldList.priorityOverdueShort")}
            count={overdueTotal}
            empty={t("orders.fieldList.overdueEmpty")}
            tone="risk"
          >
            <div className="space-y-2">
              {overdueVisible.map((wo) => renderCard(wo, "overdue"))}
            </div>
            {loadMore("a", assignedLimit, overdueTotal)}
          </PrioritySection>

          <PrioritySection
            id="ledige"
            title={t("orders.fieldList.priorityAvailableShort")}
            count={unassignedTotal}
            empty={t("orders.fieldList.availableEmpty")}
            tone="signal"
          >
            <p className="px-1 text-xs font-medium text-paper/70">
              {t("orders.fieldList.availableDescription")}
            </p>
            <div className="space-y-2">
              {unassignedVisible.map((wo) => renderCard(wo, "available"))}
            </div>
            {loadMore("u", unassignedLimit, unassignedTotal)}
          </PrioritySection>
        </div>

        {/* SENERE I DAG – papirark med resten av dagen og kommende jobber. */}
        <PaperSheet
          id="senere"
          title={t("orders.fieldList.laterToday")}
          count={laterSheetCount}
          hint={t("orders.fieldList.laterTodayHint")}
        >
          {laterSheetCount === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm font-medium text-muted">
              {t("orders.fieldList.laterEmpty")}
            </p>
          ) : (
            <div className="space-y-2">
              {todayAfterHero.map((wo) =>
                renderCard(wo, "default", "paper"),
              )}
              {laterAfterHero.map((wo) =>
                renderCard(wo, "default", "paper"),
              )}
            </div>
          )}
          {loadMore("a", assignedLimit, laterTotal, "paper")}
        </PaperSheet>

        {/* HISTORIKK: fullførte oppdrag holdes utenfor prioritetsstakken. */}
        {completedTotal > 0 && (
          <PaperSheet
            id="historikk"
            title={t("orders.fieldList.historyTitle", {
              count: completedTotal,
            })}
          >
            <div className="space-y-2">
              {completedAssigned.map((wo) =>
                renderCard(wo, "history", "paper"),
              )}
            </div>
            {loadMore("h", historyLimit, completedTotal, "paper")}
          </PaperSheet>
        )}
      </div>
    </div>
  );
}
