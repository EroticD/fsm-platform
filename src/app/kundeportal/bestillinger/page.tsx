import { getTranslations } from "next-intl/server";
import { addDaysUtc, parseDateOnly, toDateOnly, todayInOslo } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard } from "@/components/ui/brandStyles";
import prisma from "@/lib/prisma";
import {
  BOOKING_MIN_LEAD_HOURS,
  PORTAL_BOOKING_PAGE_SIZE,
  getPortalBookingRequests,
  type PortalBookingPage,
} from "@/server/portal";
import { getPortalSites } from "@/server/portal-expansion";
import BookingForm from "../BookingForm";
import BookingRequests from "../BookingRequests";
import { minimumBookingStart } from "../booking-window";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const params = await searchParams;
  const page = parsePage(params.side);

  const [bookingsResult, sitesResult, products] = await Promise.all([
    getPortalBookingRequests(context.user, { page }),
    getPortalSites(context.user),
    context.access.capabilities.canViewEquipment
      ? prisma.product.findMany({
          where: { customerId: context.access.customerId },
          orderBy: { model: "asc" },
          take: 100,
          select: { id: true, model: true, serialNumber: true },
        })
      : Promise.resolve([]),
  ]);

  const bookingHistory: PortalBookingPage = bookingsResult.ok
    ? bookingsResult.data
    : { items: [], total: 0, page: 1, totalPages: 1 };
  const sites = sitesResult.ok ? sitesResult.data : [];
  const minimumStart = minimumBookingStart(BOOKING_MIN_LEAD_HOURS);
  const today = todayInOslo();
  const horizonEnd = toDateOnly(
    addDaysUtc(parseDateOnly(today) ?? new Date(), 60),
  );
  const summary =
    bookingHistory.total > 0
      ? t("portal.pagination.showing", {
          from: (bookingHistory.page - 1) * PORTAL_BOOKING_PAGE_SIZE + 1,
          to: Math.min(
            bookingHistory.page * PORTAL_BOOKING_PAGE_SIZE,
            bookingHistory.total,
          ),
          total: bookingHistory.total,
        })
      : undefined;

  return (
    <PortalShell
      active="bestillinger"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.booking.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {context.access.capabilities.canBook
            ? t("portal.booking.desc")
            : t("portal.expansion.booking.forbidden")}
        </p>

        {context.access.capabilities.canBook ? (
          <div className="mt-4">
            <BookingForm
              minDate={minimumStart.date}
              horizonEnd={horizonEnd}
              minLeadHours={BOOKING_MIN_LEAD_HOURS}
              defaultContactName={context.user.name ?? ""}
              defaultContactPhone={context.customer.phone ?? ""}
              equipment={products.map((product) => ({
                id: product.id,
                label: product.serialNumber
                  ? `${product.model} · SN ${product.serialNumber}`
                  : product.model,
              }))}
              sites={sites}
            />
          </div>
        ) : null}

        <div className="mt-6">
          <BookingRequests
            bookings={bookingHistory.items}
            minDate={minimumStart.date}
            minFromTime={minimumStart.from}
            minLeadHours={BOOKING_MIN_LEAD_HOURS}
            horizonEnd={horizonEnd}
            sites={sites}
            summary={summary}
          />
        </div>
        <Pagination
          page={bookingHistory.page}
          totalPages={bookingHistory.totalPages}
          hrefFor={(target) =>
            `/kundeportal/bestillinger${target > 1 ? `?side=${target}` : ""}`
          }
          labels={paginationLabels(t)}
          className="pt-3"
        />
      </section>
    </PortalShell>
  );
}
