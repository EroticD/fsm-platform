import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import MarkdownView from "@/components/MarkdownView";
import { formatDateLocalized } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import StatusBadge from "@/components/StatusBadge";
import CustomerActivityList from "./CustomerActivityList";

type OverdueOrder = {
  id: string;
  title: string;
  scheduledFor: Date | null;
  status: string;
};

type OverviewProps = {
  customer: CustomerDetailData["customer"];
  customerId: string;
  office: boolean;
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  reportCount: number;
  nextOrder: CustomerDetailData["nextOrder"];
  portalUserCount: number;
  activePortalCount: number;
  overdueCount: number;
  overdueOrders: OverdueOrder[];
  recentOrders: CustomerDetailData["recentOrders"];
  recentActivity: CustomerDetailData["recentActivity"];
};

function SummaryStat({
  icon,
  label,
  value,
  sub,
  href,
  danger = false,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-2xl border-2 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:gap-3 ${
        danger
          ? "border-red-200 bg-red-50 hover:border-red-300"
          : "border-gray-200 bg-white hover:border-blue-300"
      }`}
    >
      <span className="text-lg sm:text-xl" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate text-base font-black leading-tight sm:text-lg ${
            danger ? "text-red-900" : "text-gray-900"
          }`}
        >
          {value}
        </span>
        <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-500 sm:text-xs">
          {label}
        </span>
        {sub ? (
          <span className="mt-0.5 block truncate text-[10px] text-gray-500">
            {sub}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export default async function CustomerOverviewTab({
  customer,
  customerId,
  office,
  totalOrders,
  activeOrders,
  completedOrders,
  reportCount,
  nextOrder,
  portalUserCount,
  activePortalCount,
  overdueCount,
  overdueOrders,
  recentOrders,
  recentActivity,
}: OverviewProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const inactivePortalUsers = Math.max(0, portalUserCount - activePortalCount);

  const attentionIds = new Set<string>([
    ...overdueOrders.map((order) => order.id),
    ...(nextOrder ? [nextOrder.id] : []),
  ]);
  const otherRecentOrders = recentOrders
    .filter((order) => !attentionIds.has(order.id))
    .slice(0, 3);

  const secondaryNumbers = [
    {
      key: "totalOrders",
      icon: "📂",
      label: t("customers.overview.totalOrders"),
      value: totalOrders,
      href: "?tab=oppdrag",
      show: totalOrders > 0,
    },
    {
      key: "completedOrders",
      icon: "✅",
      label: t("customers.overview.completedOrders"),
      value: completedOrders,
      href: "?tab=oppdrag",
      show: completedOrders > 0,
    },
    {
      key: "reports",
      icon: "📋",
      label: t("customers.overview.reports"),
      value: reportCount,
      href: "?tab=oppdrag&vis=rapporter",
      show: reportCount > 0,
    },
    {
      key: "contracts",
      icon: "📄",
      label: t("customers.overview.contracts"),
      value: customer._count.contracts,
      href: "?tab=avtaler",
      show: customer._count.contracts > 0,
    },
    {
      key: "contacts",
      icon: "👤",
      label: t("customers.overview.contacts"),
      value: customer._count.contacts,
      href: "?tab=kontakter",
      show: customer._count.contacts > 0,
    },
    {
      key: "attachments",
      icon: "📎",
      label: t("customers.overview.attachments"),
      value: customer._count.attachments,
      href: "?tab=vedlegg",
      show: customer._count.attachments > 0,
    },
    ...(office
      ? [
          {
            key: "portalUsers",
            icon: "🔐",
            label: t("customers.overview.portalUsers"),
            value: portalUserCount,
            href: "?tab=portal",
            show: portalUserCount > 0,
          },
        ]
      : []),
  ].filter((entry) => entry.show);

  return (
    <div className="space-y-6">
      {/* Fire nøkkeltall – resten er flyttet ned som sekundære tall. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <SummaryStat
          icon="📂"
          label={t("customers.overview.openOrders")}
          value={activeOrders}
          href="?tab=oppdrag"
        />
        <SummaryStat
          icon="⏰"
          label={t("customers.overview.overdue")}
          value={overdueCount}
          href="?tab=oppdrag"
          danger={overdueCount > 0}
        />
        <SummaryStat
          icon="🗓️"
          label={t("customers.overview.nextVisit")}
          value={
            nextOrder
              ? formatDateLocalized(
                  nextOrder.scheduledFor,
                  locale,
                  undefined,
                  t("customers.overview.noDate"),
                )
              : t("customers.overview.none")
          }
          sub={nextOrder?.title}
          href="?tab=oppdrag"
        />
        <SummaryStat
          icon="🔧"
          label={t("customers.overview.unitsDocs")}
          value={`${customer._count.products} / ${customer._count.attachments}`}
          href="?tab=utstyr"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Bedrift, kontaktpersoner og portalstatus */}
        <section className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="text-base font-black text-gray-900">
              🏢 {t("customers.overview.companyInfo")}
            </h2>
            {office && (
              <Link
                href={`/kunder/${customerId}/rediger`}
                className="text-xs font-bold text-blue-600 hover:underline"
              >
                {t("customers.overview.change")}
              </Link>
            )}
          </div>

          <div className="space-y-3 text-sm text-gray-800">
            <p>
              <strong>{t("customers.overview.address")}</strong>
              <br />
              <GoogleMapsLink
                address={customer.address}
                postalCode={customer.postalCode}
                city={customer.city}
                label={customer.address || t("customers.overview.notProvided")}
              />
              <br />
              {customer.postalCode || ""} {customer.city || ""}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <p>
                <strong>{t("customers.overview.phone")}</strong>
                <br />
                {customer.phone ? (
                  <a
                    href={`tel:${customer.phone}`}
                    className="font-bold text-blue-600 hover:underline"
                  >
                    {customer.phone}
                  </a>
                ) : (
                  t("customers.overview.notProvided")
                )}
              </p>
              <p>
                <strong>{t("customers.overview.email")}</strong>
                <br />
                {customer.email ? (
                  <a
                    href={`mailto:${customer.email}`}
                    className="break-all font-bold text-blue-600 hover:underline"
                  >
                    {customer.email}
                  </a>
                ) : (
                  t("customers.overview.notProvided")
                )}
              </p>
            </div>
            <p>
              <strong>{t("customers.overview.department")}</strong>
              <br />
              {customer.department?.name ||
                t("customers.overview.noDepartment")}
            </p>
            <p>
              <strong>{t("customers.overview.responsibleTechnician")}</strong>
              <br />
              {customer.responsibleTechnician?.name ||
                t("customers.overview.noResponsible")}
            </p>
            {customer.notes && (
              <div>
                <strong>{t("customers.overview.notes")}</strong>
                <div className="mt-0.5 text-gray-600">
                  <MarkdownView value={customer.notes} />
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-black uppercase tracking-wide text-gray-600">
                👤 {t("customers.overview.contactsTitle")}
              </h3>
              <Link
                href="?tab=kontakter"
                className="text-[11px] font-bold text-blue-600 hover:underline"
              >
                {t("customers.overview.manageContacts")}
              </Link>
            </div>
            {customer.contacts.length === 0 ? (
              <p className="mt-2 text-xs italic text-gray-500">
                {t("customers.overview.noContacts")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {customer.contacts.slice(0, 3).map((contact) => (
                  <li
                    key={contact.id}
                    className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5"
                  >
                    <p className="text-xs font-bold text-gray-900">
                      {contact.name}
                      {contact.role ? (
                        <span className="font-normal text-gray-500">
                          {" "}
                          · {contact.role}
                        </span>
                      ) : null}
                    </p>
                    {(contact.phone || contact.email) && (
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">
                        {contact.phone && (
                          <a
                            href={`tel:${contact.phone}`}
                            className="font-bold text-blue-600 hover:underline"
                          >
                            {contact.phone}
                          </a>
                        )}
                        {contact.phone && contact.email ? " · " : ""}
                        {contact.email && (
                          <a
                            href={`mailto:${contact.email}`}
                            className="font-bold text-blue-600 hover:underline"
                          >
                            {contact.email}
                          </a>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {office && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wide text-gray-600">
                  🔐 {t("customers.overview.portalStatus")}
                </h3>
                <Link
                  href="?tab=portal"
                  className="text-[11px] font-bold text-blue-600 hover:underline"
                >
                  {t("customers.overview.managePortal")}
                </Link>
              </div>
              <p className="mt-1 text-sm font-bold text-gray-900">
                {portalUserCount === 0
                  ? t("customers.overview.portalNone")
                  : t("customers.overview.portalActive", {
                      count: portalUserCount,
                    })}
              </p>
              {inactivePortalUsers > 0 && (
                <p className="text-xs text-gray-500">
                  {t("customers.overview.portalInactive", {
                    count: inactivePortalUsers,
                  })}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Forfalt og kommende arbeid */}
        <div className="space-y-4 lg:col-span-3">
          <section className="space-y-3 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
              <div>
                <h2 className="text-base font-black text-gray-900">
                  ⏰ {t("customers.overview.overdueWork")}
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {overdueCount > 0
                    ? t("customers.overview.overdueCount", {
                        count: overdueCount,
                      })
                    : t("customers.overview.noOverdue")}
                </p>
              </div>
              <Link
                href="?tab=oppdrag"
                className="text-xs font-bold text-blue-600 hover:underline"
              >
                {t("customers.overview.seeAll", { count: totalOrders })}
              </Link>
            </div>

            {overdueCount === 0 && !nextOrder ? (
              <p className="py-2 text-xs italic text-gray-500">
                {t("customers.overview.noOverdueOrUpcoming")}
              </p>
            ) : (
              <div className="space-y-2">
                {overdueOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/oppdrag/${order.id}`}
                    className="block rounded-xl border border-red-200 bg-red-50 p-3 transition hover:border-red-300 hover:bg-red-100/70"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-red-950">
                        {order.title}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 text-xs font-bold text-red-800">
                      ⏰{" "}
                      {t("customers.overview.overdueDate", {
                        date: formatDateLocalized(
                          order.scheduledFor,
                          locale,
                          undefined,
                          t("customers.overview.noDate"),
                        ),
                      })}
                    </p>
                  </Link>
                ))}

                {nextOrder && (
                  <Link
                    href={`/oppdrag/${nextOrder.id}`}
                    className="block rounded-xl border border-blue-200 bg-blue-50 p-3 transition hover:border-blue-300 hover:bg-blue-100/70"
                  >
                    <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">
                      {t("customers.overview.nextVisit")}
                    </p>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-blue-950">
                        {nextOrder.title}
                      </span>
                      <StatusBadge status={nextOrder.status} />
                    </div>
                    <p className="mt-1 text-xs font-bold text-blue-800">
                      🗓️{" "}
                      {t("customers.overview.nextVisitDate", {
                        date: formatDateLocalized(
                          nextOrder.scheduledFor,
                          locale,
                          undefined,
                          t("customers.overview.noDate"),
                        ),
                      })}
                    </p>
                  </Link>
                )}

                {overdueCount > overdueOrders.length && (
                  <Link
                    href="?tab=oppdrag"
                    className="block text-center text-xs font-bold text-blue-700 hover:underline"
                  >
                    {t("customers.overview.seeAll", {
                      count: overdueCount,
                    })}{" "}
                    →
                  </Link>
                )}
              </div>
            )}
          </section>

          {otherRecentOrders.length > 0 && (
            <section className="space-y-3 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-base font-black text-gray-900">
                  📂 {t("customers.overview.recentOrders")}
                </h2>
                <Link
                  href="?tab=oppdrag"
                  className="text-xs font-bold text-blue-600 hover:underline"
                >
                  {t("customers.overview.seeAll", { count: totalOrders })}
                </Link>
              </div>
              <div className="space-y-2">
                {otherRecentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/oppdrag/${order.id}`}
                    className="block rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-blue-300 hover:bg-blue-50/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-gray-900">
                        {order.title}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatDateLocalized(
                        order.scheduledFor,
                        locale,
                        undefined,
                        t("customers.overview.noDate"),
                      )}
                      {order._count.reports > 0
                        ? ` • 📋 ${t("customers.overview.checklists", {
                            count: order._count.reports,
                          })}`
                        : ""}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Aktivitetsstrømmen ligger over de sekundære tallene. */}
      <section className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex items-center justify-between border-b pb-2">
          <h2 className="text-base font-black text-gray-900">
            📋 {t("customers.overview.recentActivity")}
          </h2>
          <Link
            href="?tab=aktivitet"
            className="text-xs font-bold text-blue-600 hover:underline"
          >
            {t("customers.overview.seeAllActivity")}
          </Link>
        </div>
        <CustomerActivityList
          items={recentActivity}
          emptyLabel={t("customers.overview.noActivity")}
          showKind={false}
        />
      </section>

      {secondaryNumbers.length > 0 && (
        <section aria-label={t("customers.overview.moreNumbers")}>
          <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-gray-500">
            {t("customers.overview.moreNumbers")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {secondaryNumbers.map((entry) => (
              <Link
                key={entry.key}
                href={entry.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                <span aria-hidden="true">{entry.icon}</span>
                <span>{entry.label}</span>
                <span className="font-black text-gray-900">{entry.value}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
