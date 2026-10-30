import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { markdownToPlainText } from "@/lib/markdown";
import {
  addDaysUtc,
  formatDateLocalized,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { portalBranding } from "@/lib/portal-branding";
import { resolvePortalAccess } from "@/server/portal-access";
import { pageWindow, parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import Icon from "@/components/icons";
import ReportHistory from "@/components/portal/ReportHistory";
import ContactUpdateForm from "@/components/portal/ContactUpdateForm";
import PortalSectionNav from "@/components/portal/PortalSectionNav";
import PortalTabs from "@/components/portal/PortalTabs";
import StatusBadge from "@/components/StatusBadge";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import {
  BOOKING_MIN_LEAD_HOURS,
  PORTAL_BOOKING_PAGE_SIZE,
  getPortalBookingRequests,
  portalUpcomingWhere,
  type PortalBookingPage,
} from "@/server/portal";
import BookingForm from "./BookingForm";
import BookingRequests from "./BookingRequests";

/** Listene i kundeportalen lastes i små biter, ikke hele historikken. */
const UPCOMING_PAGE_SIZE = 20;
/** Valgene i booking-skjemaet går fra 07:00 til 18:00, i halvtimer. */
const FIRST_BOOKING_MINUTES = 7 * 60;
const LAST_BOOKING_START_MINUTES = 17 * 60 + 30;

const WORK_ORDER_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  scheduledFor: true,
  description: true,
  technicians: { select: { name: true }, take: 10 },
} as const;

// Formaterer en dato til YYYY-MM-DD. Kalenderdatoer er UTC-midnatt i
// databasen, så vi bruker UTC og er uavhengige av serverens tidssone.
function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Tidligste starttiden skjemaet kan tilby, regnet i Oslo-tid og rundet opp
 * til neste halvtime. Serveren håndhever den eksakte 24-timersgrensen.
 */
function minimumBookingStart(now = new Date()) {
  const threshold = new Date(
    now.getTime() + BOOKING_MIN_LEAD_HOURS * 60 * 60_000 + 60_000,
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(threshold);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);

  let date = `${part("year")}-${pad2(part("month"))}-${pad2(part("day"))}`;
  let minutes = Math.max(
    FIRST_BOOKING_MINUTES,
    Math.ceil((part("hour") * 60 + part("minute")) / 30) * 30,
  );
  if (minutes > LAST_BOOKING_START_MINUTES) {
    const nextDay = parseDateOnly(date);
    date = nextDay ? toDateOnly(addDaysUtc(nextDay, 1)) : date;
    minutes = FIRST_BOOKING_MINUTES;
  }

  return {
    date,
    from: `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`,
  };
}

export default async function KundeportalPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; h?: string; r?: string; b?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const listParams = await searchParams;
  const requestedUpcomingPage = parsePage(listParams.u);
  const historyPage = parsePage(listParams.h);
  const reportPage = parsePage(listParams.r);
  const requestedBookingPage = parsePage(listParams.b);

  const portalAccess = await resolvePortalAccess(user);
  if (!portalAccess.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas,#f4f5f2)] p-4 text-[var(--ink,#101310)]">
        <div className="w-full max-w-md rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-8 text-center shadow-[0_1px_2px_rgba(20,17,11,0.05)]">
          <span
            aria-hidden="true"
            className="mx-auto mb-4 block h-1 w-10 rounded-full bg-[var(--risk,#f04427)]"
          />
          <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-[#a92a12]">
            {t("portal.noAccessTitle")}
          </h1>
          <p className="text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("portal.noAccessDesc")}
          </p>
        </div>
      </div>
    );
  }

  const customer = await prisma.customer.findFirst({
    where: { id: portalAccess.data.customerId, deletedAt: null },
    include: {
      department: true,
      responsibleTechnician: true,
      products: { orderBy: { model: "asc" }, take: 100 },
      contracts: { orderBy: { startDate: "desc" }, take: 50 },
      sites: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        take: 50,
        select: { id: true, name: true, address: true },
      },
    },
  });

  if (!customer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas,#f4f5f2)] p-4 text-[var(--ink,#101310)]">
        <div className="w-full max-w-md rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-8 text-center shadow-[0_1px_2px_rgba(20,17,11,0.05)]">
          <span
            aria-hidden="true"
            className="mx-auto mb-4 block h-1 w-10 rounded-full bg-[var(--risk,#f04427)]"
          />
          <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-[#a92a12]">
            {t("portal.noAccessTitle")}
          </h1>
          <p className="text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("portal.noAccessDesc")}
          </p>
        </div>
      </div>
    );
  }

  const branding = portalBranding(customer);
  const brandColor = branding.color;
  const customerLogo = branding.logo;
  const canBook = portalAccess.data.capabilities.canBook;
  const canViewDocuments = portalAccess.data.capabilities.canViewDocuments;
  const canViewEquipment = portalAccess.data.capabilities.canViewEquipment;
  const canViewContracts = portalAccess.data.capabilities.canViewContracts;

  const todayText = todayInOslo();
  const today = parseDateOnly(todayText) ?? new Date();
  const minimumStart = minimumBookingStart();
  const horizonEnd = toDateOnly(
    addDaysUtc(parseDateOnly(todayText) ?? today, 60),
  );

  const bookingsResult = await getPortalBookingRequests(user, {
    page: requestedBookingPage,
  });
  const bookingHistory: PortalBookingPage = bookingsResult.ok
    ? bookingsResult.data
    : { items: [], total: 0, page: 1, totalPages: 1 };
  const bookings = bookingHistory.items;
  const bookingPage = bookingHistory.page;
  const bookingSummary =
    bookingHistory.total > 0
      ? t("portal.pagination.showing", {
          from: (bookingPage - 1) * PORTAL_BOOKING_PAGE_SIZE + 1,
          to: Math.min(
            bookingPage * PORTAL_BOOKING_PAGE_SIZE,
            bookingHistory.total,
          ),
          total: bookingHistory.total,
        })
      : undefined;

  // Kommende oppdrag er bare bekreftede oppdrag som ikke er datoen forbi.
  // Ubekreftede forespørsler ligger under «Dine bestillinger».
  const upcomingWhere = portalUpcomingWhere(customer.id, today);

  // Kortene øverst skal være sanne for hele kontoen, ikke bare siden som
  // tilfeldigvis vises. Derfor egne tellespørringer og en egen «neste»-sak.
  const [upcomingTotal, nextAppointment, pendingRequestCount, reportsAwaitingAck] =
    await Promise.all([
      prisma.workOrder.count({ where: upcomingWhere }),
      prisma.workOrder.findFirst({
        where: upcomingWhere,
        orderBy: [
          { scheduledFor: { sort: "asc", nulls: "last" } },
          { scheduledTo: "asc" },
        ],
        select: {
          id: true,
          title: true,
          scheduledFor: true,
          scheduledTo: true,
        },
      }),
      prisma.bookingRequest.count({
        where: {
          customerId: customer.id,
          status: "PENDING",
          // Kontoret bekrefter ved å flytte selve oppdraget. En bestilling kan
          // derfor fortsatt stå som PENDING etter at avtalen er bekreftet.
          workOrder: {
            deletedAt: null,
            status: { in: ["OPEN", "PENDING"] },
          },
        },
      }),
      prisma.report.count({
        where: {
          deletedAt: null,
          isLocked: true,
          customerAcknowledgedAt: null,
          workOrder: { customerId: customer.id, deletedAt: null },
        },
      }),
    ]);
  // Klem en gammel `?u=999` til siste side før listen hentes.
  const upcomingWindow = pageWindow(
    requestedUpcomingPage,
    upcomingTotal,
    UPCOMING_PAGE_SIZE,
  );
  const upcomingPage = upcomingWindow.page;
  const upcomingTotalPages = upcomingWindow.totalPages;

  const upcomingWorkOrders = await prisma.workOrder.findMany({
    where: upcomingWhere,
    orderBy: { scheduledFor: "desc" },
    take: upcomingWindow.take,
    skip: upcomingWindow.skip,
    select: WORK_ORDER_LIST_SELECT,
  });

  // Beholder motpartens side når man blar i én av listene.
  const listLink = (
    next: { u?: number; h?: number; b?: number },
    hash: string,
  ) => {
    const params = new URLSearchParams();
    const u = next.u ?? upcomingPage;
    const h = next.h ?? historyPage;
    const b = next.b ?? bookingPage;
    if (u > 1) params.set("u", String(u));
    if (h > 1) params.set("h", String(h));
    if (b > 1) params.set("b", String(b));
    if (reportPage > 1) params.set("r", String(reportPage));
    const qs = params.toString();
    return `/kundeportal${qs ? `?${qs}` : ""}${hash}`;
  };

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] px-4 py-5 text-[var(--ink,#101310)] [--focus-ring:var(--ink,#101310)] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* HEADER */}
        <header className="relative overflow-hidden rounded-[20px] border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] px-5 py-6 text-[var(--paper,#f2efe6)] shadow-[4px_4px_0_var(--signal,#d8ff3e)] [--focus-ring:var(--signal,#d8ff3e)] sm:px-7 sm:py-7">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ backgroundColor: brandColor }}
          />
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {customerLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={customerLogo}
                  alt={t("portal.expansion.branding.logoAlt", {
                    customerName: customer.name,
                  })}
                  className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold text-[var(--ink,#101310)]"
                  style={{ backgroundColor: brandColor }}
                >
                  {customer.name.trim().charAt(0).toUpperCase() || "?"}
                </span>
              )}
              <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cfc8b9]">
                {t("portal.headerEyebrow")}
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--paper,#f2efe6)] md:text-3xl">
                {t("portal.headerTitle", { customerName: customer.name })}
              </h1>
              <p className="mt-1 text-sm leading-6 text-[#ded8ca]">
                {t("portal.headerWelcome", {
                  userName: user.name ?? user.email ?? "",
                })}
              </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#5a5348] px-4 text-sm font-bold text-[var(--paper,#f2efe6)] transition hover:border-[#cfc8b9] hover:bg-[#2a261f]"
              >
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("portal.home")}
              </Link>
              <Link
                href="/innstillinger?tab=sikkerhet"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#5a5348] px-4 text-sm font-bold text-[var(--paper,#f2efe6)] transition hover:border-[#cfc8b9] hover:bg-[#2a261f]"
              >
                <Icon name="shield" className="h-4 w-4 shrink-0" />
                {t("nav.accountSecurity")}
              </Link>
              <Link
                href="/kundeportal"
                className="col-span-2 inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--signal,#d8ff3e)] bg-[var(--signal,#d8ff3e)] px-4 text-sm font-bold text-[var(--ink,#101310)] shadow-[2px_2px_0_#f2efe6] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_#f2efe6] sm:col-span-1"
              >
                {t("portal.refresh")}
              </Link>
            </div>
          </div>
        </header>

        <PortalTabs active="oversikt" />

        {/* OVERSIKT: neste avtale, ventende saker og rapportkvitteringer */}
        <section
          id="oversikt"
          aria-labelledby="oversikt-title"
          className="scroll-mt-24 pt-1"
        >
          <h2
            id="oversikt-title"
            className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted,#62685f)]"
          >
            {t("portal.summary.title")}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link
              href="#kommende"
              className={`${brandCard} group relative col-span-2 flex min-h-32 min-w-0 flex-col overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-[#b9ae98] hover:shadow-[0_4px_14px_rgba(20,17,11,0.08)] lg:col-span-1`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
              />
              <p className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-[var(--muted,#62685f)]">
                {t("portal.summary.nextAppointment")}
              </p>
              {nextAppointment ? (
                <>
                  <p className="mt-1 truncate text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                    {formatDateLocalized(
                      nextAppointment.scheduledFor ??
                        nextAppointment.scheduledTo,
                      locale,
                      undefined,
                      t("portal.summary.noDate"),
                    )}
                  </p>
                  <p className="truncate text-xs font-semibold text-[var(--muted,#62685f)]">
                    {nextAppointment.title}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                  {t("portal.summary.noConfirmed")}
                </p>
              )}
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-bold text-[var(--ink,#101310)] group-hover:underline group-hover:decoration-[var(--signal,#d8ff3e)] group-hover:decoration-2 group-hover:underline-offset-4">
                {t("portal.summary.seeUpcoming")}
                <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
              </span>
            </Link>

            <Link
              href="#bestillinger"
              className={`${brandCard} group relative flex min-h-32 min-w-0 flex-col overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-[#b9ae98] hover:shadow-[0_4px_14px_rgba(20,17,11,0.08)]`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-[#d97706]"
              />
              <p className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-[var(--muted,#62685f)]">
                {t("portal.summary.pending")}
              </p>
              <p className="mt-1 text-3xl font-extrabold leading-none tracking-tight text-[var(--ink,#101310)] tabular-nums">
                {pendingRequestCount}
              </p>
              <p className="text-xs font-semibold text-[var(--muted,#62685f)]">
                {pendingRequestCount > 0
                  ? t("portal.summary.pendingHint")
                  : t("portal.summary.pendingNone")}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-bold text-[var(--ink,#101310)] group-hover:underline group-hover:decoration-[var(--signal,#d8ff3e)] group-hover:decoration-2 group-hover:underline-offset-4">
                {t("portal.summary.seeBookings")}
                <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
              </span>
            </Link>

            <Link
              href="#rapporter"
              className={`${brandCard} group relative flex min-h-32 min-w-0 flex-col overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-[#b9ae98] hover:shadow-[0_4px_14px_rgba(20,17,11,0.08)]`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-[var(--ink,#101310)]"
              />
              <p className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-[var(--muted,#62685f)]">
                {t("portal.summary.reports")}
              </p>
              <p className="mt-1 text-3xl font-extrabold leading-none tracking-tight text-[var(--ink,#101310)] tabular-nums">
                {reportsAwaitingAck}
              </p>
              <p className="text-xs font-semibold text-[var(--muted,#62685f)]">
                {reportsAwaitingAck > 0
                  ? t("portal.summary.reportsHint")
                  : t("portal.summary.reportsNone")}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-bold text-[var(--ink,#101310)] group-hover:underline group-hover:decoration-[var(--signal,#d8ff3e)] group-hover:decoration-2 group-hover:underline-offset-4">
                {t("portal.summary.seeReports")}
                <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
              </span>
            </Link>

            <Link
              href="#bestillinger"
              className="col-span-2 flex min-h-20 items-center justify-between gap-3 rounded-card border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 py-4 text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)] lg:col-span-1"
            >
              <span className="text-base font-extrabold">
                {t("portal.summary.cta")}
              </span>
              <span aria-hidden="true" className="text-xl">
                <Icon name="arrowRight" className="h-5 w-5" />
              </span>
            </Link>
          </div>
        </section>

        <PortalSectionNav />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* VENSTRE: Utstyr & Avtaler */}
          <div className="space-y-6 lg:col-span-1">
            {/* Registrert utstyr */}
            {canViewEquipment && (
            <section className={`${brandCard} space-y-4 p-4 sm:p-5`}>
              <h2 className="flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
                />
                <span>{t("portal.equipment.title")}</span>
              </h2>
              <div className="space-y-3">
                {customer.products.length === 0 ? (
                  <p className="text-sm italic text-[var(--muted,#62685f)]">
                    {t("portal.equipment.empty")}
                  </p>
                ) : (
                  customer.products.map((product) => (
                    <div
                      key={product.id}
                      className={`${brandInset} flex items-center justify-between gap-3 p-3`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[var(--ink,#101310)]">
                          {product.model}
                        </p>
                        <p className="text-xs text-[var(--muted,#62685f)]">
                          {t("portal.equipment.serial", {
                            serial: product.serialNumber || "–",
                          })}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-semibold text-[var(--muted,#62685f)]">
                        {product.location ||
                          t("portal.equipment.unknownBuilding")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
            )}

            {/* Serviceavtaler */}
            {canViewContracts && (
            <section className={`${brandCard} space-y-4 p-4 sm:p-5`}>
              <h2 className="flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
                />
                <span>{t("portal.contracts.title")}</span>
              </h2>
              <div className="space-y-3">
                {customer.contracts.length === 0 ? (
                  <p className="text-sm italic text-[var(--muted,#62685f)]">
                    {t("portal.contracts.empty")}
                  </p>
                ) : (
                  customer.contracts.map((contract) => (
                    <div key={contract.id} className={`${brandInset} p-3`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-[var(--ink,#101310)]">
                          {contract.title}
                        </p>
                        {!contract.isActive && (
                          <span className="inline-flex min-h-6 items-center rounded-full border border-[#e2cf9b] bg-[#fbf1d2] px-2 py-0.5 text-xs font-bold uppercase text-[#6b4a05]">
                            {t("portal.contracts.paused")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                        {t("portal.contracts.start", {
                          date: formatDateLocalized(
                            contract.startDate,
                            locale,
                            undefined,
                            "–",
                          ),
                        })}{" "}
                        •{" "}
                        {t("portal.contracts.interval", {
                          interval: t("portal.contracts.months", {
                            count: contract.intervalMonths,
                          }),
                        })}
                      </p>
                      <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
                        {t("portal.contracts.next", {
                          date: formatDateLocalized(
                            contract.nextServiceDate,
                            locale,
                            undefined,
                            "–",
                          ),
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
            )}
          </div>

          {/* HOYRE: Oppdrag & Booking */}
          <div className="space-y-6 lg:col-span-2">
            {/* SEND NY FORESPØRSEL */}
            <section
              id="bestillinger"
              className={`${brandCard} scroll-mt-24 p-4 sm:p-5`}
            >
              <h2 className="flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
                />
                <span>{t("portal.booking.title")}</span>
              </h2>
              <p className="mb-4 mt-2 text-sm leading-6 text-[var(--muted,#62685f)]">
                {t("portal.booking.desc")}
              </p>
              {canBook ? (
              <BookingForm
                minDate={minimumStart.date}
                horizonEnd={horizonEnd}
                minLeadHours={BOOKING_MIN_LEAD_HOURS}
                defaultContactName={user.name ?? ""}
                defaultContactPhone={customer.phone ?? ""}
                equipment={customer.products.map((product) => ({
                  id: product.id,
                  label: product.serialNumber
                    ? `${product.model} · SN ${product.serialNumber}`
                    : product.model,
                }))}
                sites={customer.sites}
              />
              ) : (
                <p className="mb-4 rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] px-3 py-2 text-sm leading-5 text-[#6b4a05]">
                  {t("portal.expansion.booking.forbidden")}
                </p>
              )}
              <BookingRequests
                bookings={bookings}
                minDate={minimumStart.date}
                minFromTime={minimumStart.from}
                minLeadHours={BOOKING_MIN_LEAD_HOURS}
                horizonEnd={horizonEnd}
                sites={customer.sites}
                summary={bookingSummary}
              />
              <Pagination
                page={bookingPage}
                totalPages={bookingHistory.totalPages}
                hrefFor={(targetPage) =>
                  listLink({ b: targetPage }, "#bestillinger")
                }
                labels={paginationLabels(t)}
                className="pt-3"
              />
            </section>

            {/* KOMMENDE OPPDRAG */}
            <section
              id="kommende"
              className={`${brandCard} scroll-mt-24 p-4 sm:p-5`}
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
                    />
                    <span>{t("portal.upcoming.title")}</span>
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                    {t("portal.upcoming.desc")}
                  </p>
                </div>
                <a
                  href="/api/kundeportal/export"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--ink,#101310)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                >
                  <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-90" />
                  {t("portal.upcoming.export")}
                </a>
              </div>

              {upcomingTotal === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-6 text-center">
                  <p className="text-sm italic text-[var(--muted,#62685f)]">
                    {t("portal.upcoming.empty")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingWorkOrders.map((wo) => (
                    <article key={wo.id} className={`${brandInset} p-3`}>
                      <div className="mb-2 flex flex-wrap justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[var(--ink,#101310)]">
                            {wo.title}
                          </p>
                          <p className="flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                            <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
                            {formatDateLocalized(
                              wo.scheduledFor,
                              locale,
                              undefined,
                              t("portal.upcoming.noDate"),
                            )}
                          </p>
                        </div>
                        <StatusBadge status={wo.status} />
                      </div>
                      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--muted,#62685f)]">
                        <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                        {customer.name}
                        {wo.technicians.length > 0 && (
                          <span className="font-bold text-[var(--ink,#101310)]">
                            • {wo.technicians.map((tech) => tech.name).join(", ")}
                          </span>
                        )}
                      </p>
                      {wo.description && (
                        <p className="mt-1 text-xs italic leading-5 text-[var(--muted,#62685f)]">
                          {markdownToPlainText(wo.description)}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}

              <Pagination
                page={upcomingPage}
                totalPages={upcomingTotalPages}
                hrefFor={(targetPage) =>
                  listLink({ u: targetPage }, "#kommende")
                }
                labels={paginationLabels(t)}
                summary={t("portal.pagination.showing", {
                  from: (upcomingPage - 1) * UPCOMING_PAGE_SIZE + 1,
                  to: Math.min(upcomingPage * UPCOMING_PAGE_SIZE, upcomingTotal),
                  total: upcomingTotal,
                })}
                className="pt-3"
              />
            </section>
          </div>
        </div>

        {canViewDocuments && (
        <ReportHistory
          page={reportPage}
          upcomingPage={upcomingPage}
          historyPage={historyPage}
        />
        )}

        {/* KONTAKTINFO: avdeling, ansvarlig montør og oppdateringsskjema */}
        <section
          id="kontakt"
          aria-labelledby="kontakt-title"
          className={`${brandCard} scroll-mt-24 p-4 sm:p-5`}
        >
          <h2
            id="kontakt-title"
            className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
            />
            <span>{t("portal.contact.title")}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Avdeling / lokasjon */}
            <div className={`${brandInset} p-3`}>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
                {customer.department
                  ? t("portal.contact.department")
                  : t("portal.contact.company")}
              </p>
              <p className="text-sm font-bold text-[var(--ink,#101310)]">
                {customer.department?.name || customer.name}
              </p>
              {customer.department ? (
                <>
                  {(customer.department.address ||
                    customer.department.city) && (
                    <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
                      {customer.department.address || ""}
                      {customer.department.postalCode
                        ? `, ${customer.department.postalCode}`
                        : ""}
                      {customer.department.city
                        ? ` ${customer.department.city}`
                        : ""}
                    </p>
                  )}
                  {customer.department.phone && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm">
                      <Icon name="phone" className="h-4 w-4 shrink-0" />
                      <a
                        href={`tel:${customer.department.phone}`}
                        className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {customer.department.phone}
                      </a>
                    </p>
                  )}
                  {customer.department.email && (
                    <p className="flex items-center gap-1.5 text-sm">
                      <Icon name="mail" className="h-4 w-4 shrink-0" />
                      <a
                        href={`mailto:${customer.department.email}`}
                        className="min-w-0 break-words font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {customer.department.email}
                      </a>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
                    {customer.address || t("portal.contact.notProvided")}{" "}
                    {customer.postalCode || ""} {customer.city || ""}
                  </p>
                  {customer.phone && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm">
                      <Icon name="phone" className="h-4 w-4 shrink-0" />
                      <a
                        href={`tel:${customer.phone}`}
                        className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {customer.phone}
                      </a>
                    </p>
                  )}
                  {customer.email && (
                    <p className="flex items-center gap-1.5 text-sm">
                      <Icon name="mail" className="h-4 w-4 shrink-0" />
                      <a
                        href={`mailto:${customer.email}`}
                        className="min-w-0 break-words font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {customer.email}
                      </a>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Ansvarlig montør */}
            <div className={`${brandInset} p-3`}>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
                {t("portal.contact.responsible")}
              </p>
              {customer.responsibleTechnician ? (
                <>
                  <p className="text-sm font-bold text-[var(--ink,#101310)]">
                    {customer.responsibleTechnician.name}
                  </p>
                  {customer.responsibleTechnician.phone && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm">
                      <Icon name="phone" className="h-4 w-4 shrink-0" />
                      <a
                        href={`tel:${customer.responsibleTechnician.phone}`}
                        className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {customer.responsibleTechnician.phone}
                      </a>
                    </p>
                  )}
                  {customer.responsibleTechnician.email && (
                    <p className="flex items-center gap-1.5 text-sm">
                      <Icon name="mail" className="h-4 w-4 shrink-0" />
                      <a
                        href={`mailto:${customer.responsibleTechnician.email}`}
                        className="min-w-0 break-words font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {customer.responsibleTechnician.email}
                      </a>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-[var(--muted,#62685f)]">
                  {t("portal.contact.noResponsible")}
                </p>
              )}
            </div>
          </div>

          <ContactUpdateForm />
        </section>
      </div>
    </div>
  );
}
