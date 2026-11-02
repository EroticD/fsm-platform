import { getTranslations } from "next-intl/server";
import { addDaysUtc, parseDateOnly, toDateOnly, todayInOslo } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import PortalShell from "@/components/portal/PortalShell";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
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
import {
  createPortalSiteAction,
  deletePortalSiteAction,
  setPortalPrimarySiteAction,
  updatePortalSiteAction,
} from "../portal-expansion-actions";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; feil?: string; lagret?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const params = await searchParams;
  const page = parsePage(params.side);
  const canManageSites = context.access.capabilities.canBook;

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

      {canManageSites && (
        <section
          id="steder"
          className={`${brandCard} scroll-mt-24 space-y-4 p-4 sm:p-5`}
        >
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">
              {t("portal.expansion.sites.title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
              {t("portal.expansion.sites.description")}
            </p>
          </div>

          {params.feil && (
            <p className="rounded-xl border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-sm font-bold text-[#a92a12]">
              {t("portal.expansion.sites.error")}
            </p>
          )}
          {params.lagret && (
            <p className="rounded-xl border border-[#b9cdb4] bg-[#eaf3e4] px-3 py-2 text-sm font-bold text-[#24502f]">
              {t("portal.expansion.sites.saved")}
            </p>
          )}

          <form
            action={createPortalSiteAction}
            className={`${brandInset} space-y-3 p-3`}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-site-name" className="text-xs font-bold uppercase tracking-[0.12em]">
                  {t("portal.expansion.sites.name")} *
                </label>
                <input
                  id="portal-site-name"
                  name="name"
                  required
                  maxLength={200}
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="portal-site-address" className="text-xs font-bold uppercase tracking-[0.12em]">
                  {t("portal.expansion.sites.address")}
                </label>
                <input
                  id="portal-site-address"
                  name="address"
                  maxLength={200}
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="portal-site-postal" className="text-xs font-bold uppercase tracking-[0.12em]">
                  {t("portal.expansion.sites.postalCode")}
                </label>
                <input
                  id="portal-site-postal"
                  name="postalCode"
                  maxLength={20}
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="portal-site-city" className="text-xs font-bold uppercase tracking-[0.12em]">
                  {t("portal.expansion.sites.city")}
                </label>
                <input
                  id="portal-site-city"
                  name="city"
                  maxLength={100}
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                />
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input type="checkbox" name="isPrimary" value="true" className="h-4 w-4" />
              {t("portal.expansion.sites.setPrimary")}
            </label>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-sm font-bold"
            >
              {t("portal.expansion.sites.add")}
            </button>
          </form>

          {sites.length === 0 ? (
            <p className="text-sm italic text-[var(--muted,#62685f)]">
              {t("portal.expansion.sites.empty")}
            </p>
          ) : (
            <div className="space-y-2">
              {sites.map((site) => {
                const addressLine = [site.address, site.postalCode, site.city]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div key={site.id} className={`${brandInset} p-3`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold">
                          {site.name}
                          {site.isPrimary ? ` · ${t("portal.expansion.sites.primary")}` : ""}
                        </p>
                        <p className="text-xs text-[var(--muted,#62685f)]">
                          {addressLine || t("portal.expansion.sites.noAddress")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {!site.isPrimary && (
                          <form action={setPortalPrimarySiteAction}>
                            <input type="hidden" name="id" value={site.id} />
                            <button
                              type="submit"
                              className="inline-flex min-h-11 items-center rounded-full border border-[var(--ink,#101310)] px-3 text-xs font-bold"
                            >
                              {t("portal.expansion.sites.makePrimary")}
                            </button>
                          </form>
                        )}
                        <ConfirmSubmitForm
                          action={deletePortalSiteAction}
                          confirmMessage={t("portal.expansion.sites.deleteConfirm", {
                            name: site.name,
                          })}
                          confirmLabel={t("delete")}
                          danger
                          className="inline-flex"
                        >
                          <input type="hidden" name="id" value={site.id} />
                          <button
                            type="submit"
                            className="inline-flex min-h-11 items-center rounded-full border border-[#b42318] px-3 text-xs font-bold text-[#b42318]"
                          >
                            {t("portal.expansion.sites.delete")}
                          </button>
                        </ConfirmSubmitForm>
                      </div>
                    </div>
                    <details className="mt-2 border-t border-[var(--line,#dedcd1)] pt-2">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-bold uppercase tracking-[0.08em]">
                        {t("portal.expansion.sites.edit")}
                      </summary>
                      <form action={updatePortalSiteAction} className="mt-2 space-y-3">
                        <input type="hidden" name="id" value={site.id} />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor={`portal-site-${site.id}-name`} className="text-xs font-bold uppercase tracking-[0.12em]">
                              {t("portal.expansion.sites.name")} *
                            </label>
                            <input
                              id={`portal-site-${site.id}-name`}
                              name="name"
                              required
                              maxLength={200}
                              defaultValue={site.name}
                              className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`portal-site-${site.id}-address`} className="text-xs font-bold uppercase tracking-[0.12em]">
                              {t("portal.expansion.sites.address")}
                            </label>
                            <input
                              id={`portal-site-${site.id}-address`}
                              name="address"
                              maxLength={200}
                              defaultValue={site.address ?? ""}
                              className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`portal-site-${site.id}-postal`} className="text-xs font-bold uppercase tracking-[0.12em]">
                              {t("portal.expansion.sites.postalCode")}
                            </label>
                            <input
                              id={`portal-site-${site.id}-postal`}
                              name="postalCode"
                              maxLength={20}
                              defaultValue={site.postalCode ?? ""}
                              className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`portal-site-${site.id}-city`} className="text-xs font-bold uppercase tracking-[0.12em]">
                              {t("portal.expansion.sites.city")}
                            </label>
                            <input
                              id={`portal-site-${site.id}-city`}
                              name="city"
                              maxLength={100}
                              defaultValue={site.city ?? ""}
                              className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ink,#101310)] px-4 text-sm font-bold"
                        >
                          {t("portal.expansion.sites.save")}
                        </button>
                      </form>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </PortalShell>
  );
}
