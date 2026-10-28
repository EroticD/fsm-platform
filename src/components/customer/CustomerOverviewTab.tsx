import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import KpiCard from "@/components/KpiCard";
import MarkdownView from "@/components/MarkdownView";
import { formatDateLocalized } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import StatusBadge from "@/components/StatusBadge";
import CustomerActivityList from "./CustomerActivityList";

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
  recentOrders: CustomerDetailData["recentOrders"];
  recentActivity: CustomerDetailData["recentActivity"];
};

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
  recentOrders,
  recentActivity,
}: OverviewProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="📂" label={t("customers.overview.totalOrders")} value={totalOrders} tone="gray" href="?tab=oppdrag" />
        <KpiCard icon="🔄" label={t("customers.overview.activeOrders")} value={activeOrders} tone="blue" href="?tab=oppdrag" />
        <KpiCard icon="✅" label={t("customers.overview.completedOrders")} value={completedOrders} tone="green" href="?tab=oppdrag" />
        <KpiCard icon="📋" label={t("customers.overview.reports")} value={reportCount} tone="amber" href="?tab=mer#aktivitet" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="🔧" label={t("customers.overview.units")} value={customer._count.products} tone="gray" href="?tab=utstyr" />
        <KpiCard icon="👤" label={t("customers.overview.contacts")} value={customer._count.contacts} tone="gray" href="?tab=mer#kontakter" />
        <KpiCard icon="📄" label={t("customers.overview.contracts")} value={customer._count.contracts} tone="blue" href="?tab=avtaler" />
        <KpiCard icon="📎" label={t("customers.overview.attachments")} value={customer._count.attachments} tone="gray" href="?tab=mer#vedlegg" />
        {office && (
          <KpiCard icon="🔐" label={t("customers.overview.portalUsers")} value={portalUserCount} tone="gray" href="?tab=mer#kontakter" />
        )}
        <KpiCard
          icon="🗓️"
          label={t("customers.overview.nextOrder")}
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
          tone="blue"
          href="?tab=oppdrag"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bedriftsinformasjon */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4 lg:col-span-1">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">🏢 {t("customers.overview.companyInfo")}</h2>
            {office && (
              <Link href={`/kunder/${customerId}/rediger`} className="text-xs font-bold text-blue-600 hover:underline">
                {t("customers.overview.change")}
              </Link>
            )}
          </div>
          <div className="text-sm space-y-3 text-gray-800">
            <p><strong>{t("customers.overview.address")}</strong><br />
              <GoogleMapsLink
                address={customer.address}
                postalCode={customer.postalCode}
                city={customer.city}
                label={customer.address || t("customers.overview.notProvided")}
              />
              <br />
              {customer.postalCode || ""} {customer.city || ""}
            </p>
            <p><strong>{t("customers.overview.phone")}</strong><br />{customer.phone ? <a href={`tel:${customer.phone}`} className="text-blue-600 font-bold hover:underline">{customer.phone}</a> : t("customers.overview.notProvided")}</p>
            <p><strong>{t("customers.overview.email")}</strong><br />{customer.email ? <a href={`mailto:${customer.email}`} className="text-blue-600 font-bold hover:underline">{customer.email}</a> : t("customers.overview.notProvided")}</p>
            <p><strong>{t("customers.overview.department")}</strong><br />{customer.department?.name || t("customers.overview.noDepartment")}</p>
            <p><strong>{t("customers.overview.responsibleTechnician")}</strong><br />{customer.responsibleTechnician?.name || t("customers.overview.noResponsible")}</p>
            {customer.notes && (
              <div>
                <strong>{t("customers.overview.notes")}</strong>
                <div className="text-gray-600 mt-0.5">
                  <MarkdownView value={customer.notes} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Siste oppdrag */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">📂 {t("customers.overview.recentOrders")}</h2>
            <Link href="?tab=oppdrag" className="text-xs font-bold text-blue-600 hover:underline">
              {t("customers.overview.seeAll", { count: totalOrders })}
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="text-xs text-gray-500 italic">{t("customers.overview.noOrders")}</p>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((wo) => (
                <Link
                  key={wo.id}
                  href={`/oppdrag/${wo.id}`}
                  className="block bg-gray-50 hover:bg-blue-50/60 border border-gray-200 hover:border-blue-300 p-3 rounded-xl transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-gray-900 text-sm truncate">{wo.title}</span>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDateLocalized(
                      wo.scheduledFor,
                      locale,
                      undefined,
                      t("customers.overview.noDate"),
                    )}
                    {wo._count.reports > 0
                      ? ` • 📋 ${t("customers.overview.checklists", { count: wo._count.reports })}`
                      : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Siste aktivitet */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
        <div className="flex items-center justify-between border-b pb-2 mb-3">
          <h2 className="font-black text-gray-900 text-base">📋 {t("customers.overview.recentActivity")}</h2>
          <Link href="?tab=mer#aktivitet" className="text-xs font-bold text-blue-600 hover:underline">
            {t("customers.overview.seeAllActivity")}
          </Link>
        </div>
        <CustomerActivityList
          items={recentActivity}
          emptyLabel={t("customers.overview.noActivity")}
          showKind={false}
        />
      </div>
    </div>
  );
}
