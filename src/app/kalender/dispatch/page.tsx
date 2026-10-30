import { redirect } from "next/navigation";
import type { Prisma, VisitStatus } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import CalendarShell from "@/app/kalender/CalendarShell";
import Icon from "@/components/icons";
import DispatchBoard from "@/app/kalender/dispatch/DispatchBoard";
import type {
  DispatchAttentionItem,
  DispatchDay,
  DispatchVisit,
} from "@/app/kalender/dispatch/types";
import {
  dispatchAttentionConditions,
  dispatchAttentionWhere,
  dispatchBaseFilters,
  dispatchDateWhere,
} from "@/app/kalender/dispatch/query";
import { markdownToPlainText } from "@/lib/markdown";
import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  dateOnlyInOslo,
  formatDateLocalized,
  formatDateRangeLocalized,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { resolveDateRange } from "@/lib/date-range";
import { parsePage, pageWindow } from "@/lib/pagination";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope } from "@/lib/access";
import {
  allowedVisitTransitions,
} from "@/lib/visit-status";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Sikkerhets tak for varselseksjonen; ufordelte/forfalte vises først. */
const ATTENTION_LIMIT = 200;

type DispatchWorkOrderRow = Prisma.WorkOrderGetPayload<{
  include: { customer: true; technicians: true; product: true };
}>;

type DispatchVisitRow = Prisma.VisitGetPayload<{
  include: {
    technicians: {
      include: { user: { select: { id: true; name: true; email: true } } };
    };
    workOrder: { include: { customer: true; product: true } };
  };
}>;

/**
 * Dispatch-tavla: planlagte visiter gruppert per startdag, med én kolonne per
 * montør. Hver visitt er en tidsblokk og viser start–slutt, dato og
 * visittstatus. Alle handlinger går via server actions som kontrollerer
 * rettighetene på nytt.
 *
 * Forfalte og ufordelte oppdrag hentes utenfor visittperioden og vises i en
 * egen varselseksjon. De fjernes fra datoperioden med `NOT`, slik at samme
 * oppdrag aldri dukker opp to steder.
 */
export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{
    fra?: string | string[];
    til?: string | string[];
    q?: string | string[];
    side?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.assign")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const canReports = hasPermission(user, "reports.view");
  const canCreate = hasPermission(user, "workorders.create");
  const canUpdateStatus = hasPermission(user, "workorders.update");

  const query = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const today = parseDateOnly(todayInOslo());
  const defaultFrom = today ? toDateOnly(today) : todayInOslo();
  const defaultTo = today
    ? toDateOnly(addDaysUtc(today, 7))
    : todayInOslo();
  const range = resolveDateRange({
    params: {
      from: firstParam(params.fra),
      to: firstParam(params.til),
    },
    defaultFrom,
    defaultTo,
  });

  const baseFilters = dispatchBaseFilters(user, query);
  const attentionConditions = dispatchAttentionConditions(today);
  const attentionWhere = dispatchAttentionWhere(
    baseFilters,
    attentionConditions,
  );
  const dateWhere = dispatchDateWhere(baseFilters, range, attentionConditions);

  const [attentionRows, dateTotal, technicians] = await Promise.all([
    prisma.workOrder.findMany({
      where: attentionWhere,
      include: {
        customer: true,
        technicians: true,
        product: true,
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      take: ATTENTION_LIMIT,
    }),
    prisma.visit.count({ where: dateWhere }),
    prisma.user.findMany({
      where: staffScope(user),
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  const pagination = pageWindow(
    parsePage(firstParam(params.side)),
    dateTotal,
    80,
  );

  // Planlagte blokker er visiter. De hentes med oppdrag, kunde og visittens
  // egne montører, slik at kortet kan vises uten flere oppslag.
  const dateVisits = await prisma.visit.findMany({
    where: dateWhere,
    include: {
      technicians: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      workOrder: { include: { customer: true, product: true } },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    skip: pagination.skip,
    take: pagination.take,
  });

  function formatTime(value: Date): string {
    return formatDateLocalized(value, locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function toDispatchAttention(
    workOrder: DispatchWorkOrderRow,
  ): DispatchAttentionItem {
    return {
      id: workOrder.id,
      title: workOrder.title,
      customerName:
        workOrder.customer?.name || t("calendar.common.noCustomer"),
      dateRange: formatDateRangeLocalized(
        workOrder.scheduledFor,
        workOrder.scheduledTo,
        locale,
      ),
      isOverdue: Boolean(
        today && workOrder.scheduledFor && workOrder.scheduledFor < today,
      ),
      technicians: workOrder.technicians.map((technician) => ({
        id: technician.id,
        name: technician.name ?? technician.email ?? technician.id,
      })),
    };
  }

  function toDispatchVisit(visit: DispatchVisitRow): DispatchVisit {
    const status = visit.status as VisitStatus;
    const statusOptions = canUpdateStatus
      ? allowedVisitTransitions(status)
      : [];

    return {
      id: visit.id,
      workOrderId: visit.workOrderId,
      title: visit.workOrder.title,
      workOrderStatus: visit.workOrder.status,
      visitStatus: visit.status,
      customerName:
        visit.workOrder.customer?.name || t("calendar.common.noCustomer"),
      address: formatAddress(visit.workOrder.customer),
      productModel: visit.workOrder.product?.model ?? null,
      description: visit.workOrder.description
        ? markdownToPlainText(visit.workOrder.description).slice(0, 240)
        : "",
      dateLabel: formatDateLocalized(visit.startsAt, locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      timeLabel: visit.allDay
        ? t("calendar.visit.allDay")
        : t("calendar.visit.timeRange", {
            start: formatTime(visit.startsAt),
            end: formatTime(visit.endsAt),
          }),
      technicians: visit.technicians.map((technician) => ({
        id: technician.user.id,
        name:
          technician.user.name ??
          technician.user.email ??
          technician.user.id,
      })),
      statusOptions,
    };
  }

  const attentionItems = attentionRows.map(toDispatchAttention);

  const groups = new Map<string, DispatchDay>();

  for (const visit of dateVisits) {
    // Grupper på startdagen i Oslo, ikke UTC: en visitt kl. 00:30 norsk tid
    // hører til den norske dagen, selv om UTC fortsatt viser gårsdagen.
    const date = dateOnlyInOslo(visit.startsAt);
    const group = groups.get(date) ?? {
      date,
      label: formatDateLocalized(date, locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
      visits: [],
    };

    group.visits.push(toDispatchVisit(visit));
    groups.set(date, group);
  }

  const days: DispatchDay[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group);

  // Tellingen skal vise det som faktisk står i tavla. Ufordelte oppdrag ligger
  // alltid i varselseksjonen, også når de faller utenfor valgt datoperiode.
  const unassignedCount = attentionRows.filter(
    (workOrder) => workOrder.technicians.length === 0,
  ).length;
  const total = attentionRows.length + dateTotal;
  const shownOnPage = attentionRows.length + dateVisits.length;
  const resultFrom = total === 0 ? 0 : Math.min(total, pagination.skip + 1);
  const resultTo =
    total === 0 ? 0 : Math.min(total, pagination.skip + shownOnPage);

  function hrefFor(page: number): string {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    search.set("fra", range.fromText);
    search.set("til", range.toText);
    if (page > 1) search.set("side", String(page));
    const queryString = search.toString();
    return queryString
      ? `/kalender/dispatch?${queryString}`
      : "/kalender/dispatch";
  }

  const baseHref = hrefFor(1);
  const legacyError = firstParam(params.error);

  const periodLabel = formatDateRangeLocalized(
    range.fromText,
    range.toText,
    locale,
  );

  return (
    <CalendarShell
      active="dispatch"
      canDispatch
      canReports={canReports}
      subtitle={t("calendar.dispatch.subtitle")}
      periodLabel={periodLabel}
      canCreate={canCreate}
      newWorkOrderHref="/oppdrag/ny"
    >
      {legacyError && (
        <div
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-4 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {legacyError === "ugyldig-status"
            ? t("calendar.dispatch.invalidStatus")
            : t("calendar.dispatch.genericError")}
        </div>
      )}

      <form
        action="/kalender/dispatch"
        method="get"
        className="office-card grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-5"
        aria-label={t("calendar.dispatch.filters.search")}
      >
        <label className="flex min-w-0 flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
          {t("calendar.dispatch.filters.dateFrom")}
          <input
            type="date"
            name="fra"
            defaultValue={range.fromText}
            className="min-h-10 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
          {t("calendar.dispatch.filters.dateTo")}
          <input
            type="date"
            name="til"
            defaultValue={range.toText}
            className="min-h-10 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)] sm:col-span-2">
          {t("calendar.dispatch.filters.search")}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("calendar.dispatch.filters.searchPlaceholder")}
            className="min-h-10 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition placeholder:text-[var(--muted,#62685f)] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
        </label>
        <div className="flex min-w-0 items-end gap-2">
          <button
            type="submit"
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--ink,#101310)] px-4 py-2 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85"
          >
            <Icon name="check" className="h-4 w-4" />
            {t("calendar.dispatch.filters.apply")}
          </button>
          <Link
            href="/kalender/dispatch"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-white px-4 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("calendar.dispatch.filters.clear")}
          </Link>
        </div>
      </form>

      {range.invalid && (
        <div
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-4 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {range.invalidOrder
            ? t("calendar.dispatch.filters.rangeError")
            : t("calendar.dispatch.filters.dateError")}
        </div>
      )}

      {unassignedCount > 0 && (
        <div className="office-card min-w-0 border-l-4 border-l-[var(--risk,#f04427)] p-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"
              >
                <Icon name="alert" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-black tracking-tight text-[var(--ink,#101310)]">
                  {t("calendar.dispatch.unassignedCount", {
                    count: unassignedCount,
                  })}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  {t("calendar.dispatch.unassignedWarning")}
                </p>
              </div>
            </div>
            <Link
              href={baseHref}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:opacity-85"
            >
              <Icon name="sync" className="h-4 w-4" />
              {t("calendar.dispatch.refresh")}
            </Link>
          </div>
        </div>
      )}

      {attentionItems.length > 0 && (
        <section
          aria-labelledby="dispatch-attention-title"
          className="office-card min-w-0 border-l-4 border-l-[var(--risk,#f04427)] p-4"
        >
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
            <div className="min-w-0">
              <h2
                id="dispatch-attention-title"
                className="flex items-center gap-2 text-base font-black tracking-tight text-[var(--ink,#101310)]"
              >
                <Icon
                  name="alert"
                  className="h-4 w-4 shrink-0 text-[var(--risk-text,#b42318)]"
                />
                {t("calendar.dispatch.attentionTitle")}
              </h2>
              <p className="mt-1 text-xs font-medium text-[#7a4f0c]">
                {t("calendar.dispatch.attentionHint")}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--muted,#62685f)]">
              {t("calendar.dispatch.attentionCount", {
                count: attentionItems.length,
              })}
            </span>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {attentionItems.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/oppdrag/${item.id}`}
                  className="flex h-full flex-col rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 transition hover:border-[var(--ink,#101310)] hover:shadow-[2px_2px_0_var(--signal,#d8ff3e)]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-bold leading-tight text-[var(--ink,#101310)]">
                      {item.title}
                    </span>
                    {item.isOverdue && (
                      <span className="shrink-0 rounded bg-[#fdf5e4] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#7a4f0c]">
                        {t("calendar.dispatch.overdue")}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                    <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.customerName}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                    <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {item.dateRange || t("calendar.common.noDate")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted,#62685f)]">
        <span className="min-w-0 break-words font-semibold">
          {t("calendar.dispatch.resultRangeVisits", {
            from: resultFrom,
            to: resultTo,
            total,
          })}
        </span>
        {pagination.totalPages > 1 && (
          <nav
            aria-label={t("calendar.dispatch.pages")}
            className="flex flex-wrap items-center gap-2"
          >
            {pagination.page > 1 ? (
              <Link
                href={hrefFor(pagination.page - 1)}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
              >
                {t("calendar.dispatch.pagePrevious")}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 font-bold text-[var(--muted,#62685f)] opacity-60"
              >
                {t("calendar.dispatch.pagePrevious")}
              </span>
            )}
            <span className="text-xs font-bold tabular-nums">
              {t("calendar.dispatch.pageOf", {
                page: pagination.page,
                total: pagination.totalPages,
              })}
            </span>
            {pagination.page < pagination.totalPages ? (
              <Link
                href={hrefFor(pagination.page + 1)}
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
              >
                {t("calendar.dispatch.pageNext")}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex min-h-9 items-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 font-bold text-[var(--muted,#62685f)] opacity-60"
              >
                {t("calendar.dispatch.pageNext")}
              </span>
            )}
          </nav>
        )}
      </div>

      <DispatchBoard
        days={days}
        technicians={technicians.map((technician) => ({
          id: technician.id,
          name: technician.name ?? technician.id,
        }))}
      />
    </CalendarShell>
  );
}
