import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import Pagination, { paginationLabels } from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";
import { formatDateLocalized } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import {
  listBookingQueue,
  type BookingQueueFilter,
  type BookingQueueItem,
} from "@/server/bookings";
import {
  cancelBookingOfficeAction,
  confirmBookingAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("portal.bookingQueue.title") };
}

const FILTERS: BookingQueueFilter[] = [
  "all",
  "pending",
  "confirmed",
  "closed",
];

const STATUS_TONE: Record<BookingQueueItem["status"], string> = {
  PENDING: "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05]",
  CONFIRMED:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  CANCELLED: "border-[#e7b7a4] bg-[#fae8e0] text-[#a92a12]",
  EXPIRED: "border-[var(--line,#dedcd1)] bg-[#efede6] text-[var(--muted,#62685f)]",
};

function filterLabelKey(filter: BookingQueueFilter): string {
  return {
    all: "portal.bookingQueue.filterAll",
    pending: "portal.bookingQueue.filterPending",
    confirmed: "portal.bookingQueue.filterConfirmed",
    closed: "portal.bookingQueue.filterClosed",
  }[filter];
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; side?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const filter: BookingQueueFilter = (
    FILTERS as readonly string[]
  ).includes(params.status ?? "")
    ? (params.status as BookingQueueFilter)
    : "all";
  const page = Math.max(1, Number(params.side ?? "1") || 1);

  const result = await listBookingQueue(user, { filter, page });
  if (!result.ok) redirect("/");
  const queue = result.data;

  const hrefWith = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (filter !== "all") next.set("status", filter);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return `/bookinger${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={t("portal.bookingQueue.title")}
        subtitle={t("portal.bookingQueue.desc")}
        icon={<Icon name="clipboard" className="h-5 w-5" />}
      />

      <nav
        aria-label={t("portal.bookingQueue.title")}
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((value) => (
          <Link
            key={value}
            href={
              value === "all"
                ? "/bookinger"
                : `/bookinger?status=${value}`
            }
            aria-current={filter === value ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-bold ${
              filter === value
                ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)]"
            }`}
          >
            {t(filterLabelKey(value))}
          </Link>
        ))}
      </nav>

      {queue.items.length === 0 ? (
        <EmptyState
          title={t("portal.bookingQueue.empty")}
          description={t("portal.bookingQueue.desc")}
        />
      ) : (
        <div className="space-y-3">
          {queue.items.map((booking) => (
            <article
              key={booking.id}
              className="office-card space-y-3 rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
                    {booking.workOrder.title}
                  </h2>
                  <p className="text-xs font-bold text-[var(--muted,#62685f)]">
                    {t("portal.bookingQueue.reference")}: {booking.reference}
                  </p>
                </div>
                <span
                  className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_TONE[booking.status]}`}
                >
                  {t(`portal.bookingQueue.status.${booking.status}`)}
                </span>
              </div>

              <dl className="grid gap-1 text-xs leading-5 text-[var(--muted,#62685f)] sm:grid-cols-2">
                <div>
                  <dt className="inline font-bold text-[var(--ink,#101310)]">
                    {t("portal.bookingQueue.customer")}:{" "}
                  </dt>
                  <dd className="inline">{booking.customerName}</dd>
                </div>
                <div>
                  <dt className="inline font-bold text-[var(--ink,#101310)]">
                    {t("portal.bookingQueue.requested")}:{" "}
                  </dt>
                  <dd className="inline">
                    {formatDateLocalized(booking.requestedDate, locale)}{" "}
                    {booking.requestedFrom}–{booking.requestedTo}
                  </dd>
                </div>
                {booking.siteName && (
                  <div>
                    <dt className="inline font-bold text-[var(--ink,#101310)]">
                      {t("portal.bookingQueue.site")}:{" "}
                    </dt>
                    <dd className="inline">{booking.siteName}</dd>
                  </div>
                )}
                {booking.serviceType && (
                  <div>
                    <dt className="inline font-bold text-[var(--ink,#101310)]">
                      {t("portal.bookingQueue.service")}:{" "}
                    </dt>
                    <dd className="inline">
                      {t(
                        `portal.bookingWizard.services.${booking.serviceType}`,
                        { fallback: booking.serviceType },
                      )}
                    </dd>
                  </div>
                )}
                {booking.preferredTechnicianName && (
                  <div>
                    <dt className="inline font-bold text-[var(--ink,#101310)]">
                      {t("portal.bookingQueue.technician")}:{" "}
                    </dt>
                    <dd className="inline">{booking.preferredTechnicianName}</dd>
                  </div>
                )}
              </dl>

              {booking.status === "PENDING" && (
                <div className="flex flex-wrap items-end gap-2 border-t border-[var(--line,#dedcd1)] pt-3">
                  {booking.availableTechnicians.length === 0 ? (
                    <p className="text-xs font-bold text-[#8a3511]">
                      {t("portal.bookingQueue.noTechnician")}
                    </p>
                  ) : (
                    <form action={confirmBookingAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <label
                        htmlFor={`technician-${booking.id}`}
                        className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--ink,#101310)]"
                      >
                        {t("portal.bookingQueue.chooseTechnician")}
                        <select
                          id={`technician-${booking.id}`}
                          name="technicianId"
                          className="mt-1 block min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm font-normal text-[var(--ink,#101310)]"
                        >
                          {booking.availableTechnicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>
                              {technician.name ?? technician.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        className="inline-flex min-h-11 items-center rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-sm font-bold text-[var(--ink,#101310)]"
                      >
                        {t("portal.bookingQueue.confirm")}
                      </button>
                    </form>
                  )}
                  <form action={cancelBookingOfficeAction}>
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center rounded-full border border-[var(--risk,#f04427)] px-4 text-sm font-bold text-[#a92a12]"
                    >
                      {t("portal.bookingQueue.cancel")}
                    </button>
                  </form>
                </div>
              )}

              {booking.status === "CONFIRMED" && (
                <form
                  action={cancelBookingOfficeAction}
                  className="border-t border-[var(--line,#dedcd1)] pt-3"
                >
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center rounded-full border border-[var(--risk,#f04427)] px-4 text-sm font-bold text-[#a92a12]"
                  >
                    {t("portal.bookingQueue.cancel")}
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      <Pagination
        page={queue.page}
        totalPages={queue.totalPages}
        hrefFor={(targetPage) =>
          hrefWith({ side: targetPage > 1 ? String(targetPage) : null })
        }
        labels={paginationLabels(t)}
      />
    </div>
  );
}
