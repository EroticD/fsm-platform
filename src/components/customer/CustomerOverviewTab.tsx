import Link from "next/link";
import Icon, { type IconName } from "@/components/icons";
import { getLocale, getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import MarkdownView from "@/components/MarkdownView";
import { formatDateLocalized } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import StatusBadge from "@/components/StatusBadge";
import CustomerActivityList from "./CustomerActivityList";
import {
  CUSTOMER_CARD,
  CUSTOMER_EYEBROW,
  CUSTOMER_INSET,
  CUSTOMER_MUTED,
} from "./customerStyles";

type OverdueOrder = {
  id: string;
  title: string;
  scheduledFor: Date | null;
  status: string;
};

type SecondaryNumber = {
  key: string;
  icon: IconName;
  label: string;
  value: number;
  href: string;
  show: boolean;
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
  icon: IconName;
  label: string;
  value: React.ReactNode;
  sub?: string;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-16 items-center gap-2.5 rounded-2xl border p-2.5 transition hover:-translate-y-px hover:border-[var(--ink,#101310)] sm:gap-3 sm:p-3 ${
        danger
          ? "border-[#e7b5ae] bg-[#fdf4f2] hover:bg-[#fbe9e7]"
          : `${CUSTOMER_CARD}`
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
          danger
            ? "border-[#e7b5ae] bg-[var(--surface,#fffdf8)] text-[var(--risk-text,#b42318)]"
            : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
        }`}
      >
        <Icon name={icon} className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate text-lg font-black leading-tight tabular-nums ${
            danger
              ? "text-[var(--risk-text,#b42318)]"
              : "text-[var(--ink,#101310)]"
          }`}
        >
          {value}
        </span>
        <span
          className={`mt-0.5 block truncate text-xs font-bold uppercase tracking-[0.06em] ${
            danger
              ? "text-[var(--risk-text,#b42318)]"
              : "text-[var(--muted,#62685f)]"
          }`}
        >
          {label}
        </span>
        {sub ? (
          <span
            className={`mt-0.5 block truncate text-xs ${CUSTOMER_MUTED}`}
          >
            {sub}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function PanelHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-[var(--ink,#101310)]">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
          />
          <Icon name={icon} className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="min-w-0">{title}</span>
        </h2>
        {description ? (
          <p className={`mt-0.5 text-xs ${CUSTOMER_MUTED}`}>{description}</p>
        ) : null}
      </div>
      {action}
    </div>
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

  const secondaryNumbers = ([
    {
      key: "totalOrders",
      icon: "folder",
      label: t("customers.overview.totalOrders"),
      value: totalOrders,
      href: "?tab=oppdrag",
      show: totalOrders > 0,
    },
    {
      key: "completedOrders",
      icon: "check",
      label: t("customers.overview.completedOrders"),
      value: completedOrders,
      href: "?tab=oppdrag",
      show: completedOrders > 0,
    },
    {
      key: "reports",
      icon: "clipboard",
      label: t("customers.overview.reports"),
      value: reportCount,
      href: "?tab=oppdrag&vis=rapporter",
      show: reportCount > 0,
    },
    {
      key: "contracts",
      icon: "file",
      label: t("customers.overview.contracts"),
      value: customer._count.contracts,
      href: "?tab=avtaler",
      show: customer._count.contracts > 0,
    },
    {
      key: "contacts",
      icon: "user",
      label: t("customers.overview.contacts"),
      value: customer._count.contacts,
      href: "?tab=kontakter",
      show: customer._count.contacts > 0,
    },
    {
      key: "attachments",
      icon: "image",
      label: t("customers.overview.attachments"),
      value: customer._count.attachments,
      href: "?tab=vedlegg",
      show: customer._count.attachments > 0,
    },
    ...(office
      ? ([
          {
            key: "portalUsers",
            icon: "shield",
            label: t("customers.overview.portalUsers"),
            value: portalUserCount,
            href: "?tab=portal",
            show: portalUserCount > 0,
          },
        ] satisfies SecondaryNumber[])
      : []),
  ] satisfies SecondaryNumber[]).filter((entry) => entry.show);

  return (
    <div className="space-y-4">
      {/* Kompakt nøkkeltallstripe – resten er sekundære tall nederst. */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <SummaryStat
          icon="folder"
          label={t("customers.overview.openOrders")}
          value={activeOrders}
          href="?tab=oppdrag"
        />
        <SummaryStat
          icon="clock"
          label={t("customers.overview.overdue")}
          value={overdueCount}
          href="?tab=oppdrag"
          danger={overdueCount > 0}
        />
        <SummaryStat
          icon="calendar"
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
          icon="wrench"
          label={t("customers.overview.unitsDocs")}
          value={`${customer._count.products} / ${customer._count.attachments}`}
          href="?tab=utstyr"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Bedrift, kontaktpersoner og portalstatus */}
        <section
          className={`${CUSTOMER_CARD} space-y-4 p-4 lg:col-span-2 sm:p-5`}
        >
          <PanelHeader
            icon="building"
            title={t("customers.overview.companyInfo")}
            action={
              office ? (
                <Link
                  href={`/kunder/${customerId}/rediger`}
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--ink,#101310)]"
                >
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  {t("customers.overview.change")}
                </Link>
              ) : undefined
            }
          />

          <dl className="grid grid-cols-1 gap-x-3 gap-y-2.5 text-xs sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className={CUSTOMER_EYEBROW}>
                {t("customers.overview.address")}
              </dt>
              <dd className="mt-0.5 text-[var(--ink,#101310)]">
                <GoogleMapsLink
                  address={customer.address}
                  postalCode={customer.postalCode}
                  city={customer.city}
                  label={customer.address || t("customers.overview.notProvided")}
                  className="text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                />
                <span className={`block ${CUSTOMER_MUTED}`}>
                  {customer.postalCode || ""} {customer.city || ""}
                </span>
              </dd>
            </div>
            <div>
              <dt className={CUSTOMER_EYEBROW}>
                {t("customers.overview.phone")}
              </dt>
              <dd className="mt-0.5">
                {customer.phone ? (
                  <a
                    href={`tel:${customer.phone}`}
                    className="inline-flex items-center gap-1 font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                  >
                    <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                    {customer.phone}
                  </a>
                ) : (
                  <span className={CUSTOMER_MUTED}>
                    {t("customers.overview.notProvided")}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className={CUSTOMER_EYEBROW}>
                {t("customers.overview.email")}
              </dt>
              <dd className="mt-0.5">
                {customer.email ? (
                  <a
                    href={`mailto:${customer.email}`}
                    className="inline-flex min-w-0 items-center gap-1 break-all font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                  >
                    <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                    {customer.email}
                  </a>
                ) : (
                  <span className={CUSTOMER_MUTED}>
                    {t("customers.overview.notProvided")}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className={CUSTOMER_EYEBROW}>
                {t("customers.overview.department")}
              </dt>
              <dd className="mt-0.5 text-[var(--ink,#101310)]">
                {customer.department?.name ||
                  t("customers.overview.noDepartment")}
              </dd>
            </div>
            <div>
              <dt className={CUSTOMER_EYEBROW}>
                {t("customers.overview.responsibleTechnician")}
              </dt>
              <dd className="mt-0.5 text-[var(--ink,#101310)]">
                {customer.responsibleTechnician?.name ||
                  t("customers.overview.noResponsible")}
              </dd>
            </div>
            {customer.notes && (
              <div className="sm:col-span-2">
                <dt className={CUSTOMER_EYEBROW}>
                  {t("customers.overview.notes")}
                </dt>
                <dd className={`mt-0.5 text-xs ${CUSTOMER_MUTED}`}>
                  <MarkdownView value={customer.notes} />
                </dd>
              </div>
            )}
          </dl>

          <div className="border-t border-[var(--line,#dedcd1)] pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                <Icon name="user" className="h-3.5 w-3.5 shrink-0" />
                {t("customers.overview.contactsTitle")}
              </h3>
              <Link
                href="?tab=kontakter"
                className="inline-flex min-h-11 items-center text-xs font-bold text-[var(--ink,#101310)]"
              >
                {t("customers.overview.manageContacts")}
              </Link>
            </div>
            {customer.contacts.length === 0 ? (
              <p className={`mt-2 text-xs italic ${CUSTOMER_MUTED}`}>
                {t("customers.overview.noContacts")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {customer.contacts.slice(0, 3).map((contact) => (
                  <li
                    key={contact.id}
                    className={`${CUSTOMER_INSET} px-2.5 py-1.5`}
                  >
                    <p className="text-xs font-bold text-[var(--ink,#101310)]">
                      {contact.name}
                      {contact.role ? (
                        <span className={`font-normal ${CUSTOMER_MUTED}`}>
                          {" "}
                          · {contact.role}
                        </span>
                      ) : null}
                    </p>
                    {(contact.phone || contact.email) && (
                      <p
                        className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate text-xs ${CUSTOMER_MUTED}`}
                      >
                        {contact.phone && (
                          <a
                            href={`tel:${contact.phone}`}
                            className="inline-flex items-center gap-1 font-bold text-[var(--ink,#101310)]"
                          >
                            <Icon
                              name="phone"
                              className="h-3 w-3 shrink-0"
                            />
                            {contact.phone}
                          </a>
                        )}
                        {contact.email && (
                          <a
                            href={`mailto:${contact.email}`}
                            className="inline-flex min-w-0 items-center gap-1 truncate font-bold text-[var(--ink,#101310)]"
                          >
                            <Icon name="mail" className="h-3 w-3 shrink-0" />
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
            <div className={`${CUSTOMER_INSET} p-3`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
                  {t("customers.overview.portalStatus")}
                </h3>
                <Link
                  href="?tab=portal"
                  className="inline-flex min-h-11 items-center text-xs font-bold text-[var(--ink,#101310)]"
                >
                  {t("customers.overview.managePortal")}
                </Link>
              </div>
              <p className="mt-1 text-xs font-bold text-[var(--ink,#101310)]">
                {portalUserCount === 0
                  ? t("customers.overview.portalNone")
                  : t("customers.overview.portalActive", {
                      count: portalUserCount,
                    })}
              </p>
              {inactivePortalUsers > 0 && (
                <p className={`text-xs ${CUSTOMER_MUTED}`}>
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
          <section className={`${CUSTOMER_CARD} space-y-3 p-4 sm:p-5`}>
            <PanelHeader
              icon="clock"
              title={t("customers.overview.overdueWork")}
              description={
                overdueCount > 0
                  ? t("customers.overview.overdueCount", {
                      count: overdueCount,
                    })
                  : t("customers.overview.noOverdue")
              }
              action={
                <Link
                  href="?tab=oppdrag"
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--ink,#101310)]"
                >
                  {t("customers.overview.seeAll", { count: totalOrders })}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
              }
            />

            {overdueCount === 0 && !nextOrder ? (
              <p className={`py-2 text-xs italic ${CUSTOMER_MUTED}`}>
                {t("customers.overview.noOverdueOrUpcoming")}
              </p>
            ) : (
              <div className="space-y-2">
                {overdueOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/oppdrag/${order.id}`}
                    className="block rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-2.5 transition hover:border-[var(--risk-text,#b42318)] hover:bg-[#fbe9e7]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-[var(--risk-text,#b42318)]">
                        {order.title}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--risk-text,#b42318)]">
                      <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
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
                    className="block rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--surface,#fffdf8)] p-2.5 transition hover:border-[var(--ink,#101310)] hover:border-l-[var(--signal,#d8ff3e)]"
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                      {t("customers.overview.nextVisit")}
                    </p>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-[var(--ink,#101310)]">
                        {nextOrder.title}
                      </span>
                      <StatusBadge status={nextOrder.status} />
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
                      <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
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
                    className="flex min-h-11 items-center justify-center gap-1 text-xs font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                  >
                    {t("customers.overview.seeAll", {
                      count: overdueCount,
                    })}
                    <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                )}
              </div>
            )}
          </section>

          {otherRecentOrders.length > 0 && (
            <section className={`${CUSTOMER_CARD} space-y-3 p-4 sm:p-5`}>
              <PanelHeader
                icon="folder"
                title={t("customers.overview.recentOrders")}
                action={
                  <Link
                    href="?tab=oppdrag"
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--ink,#101310)]"
                  >
                    {t("customers.overview.seeAll", { count: totalOrders })}
                    <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              <div className="space-y-2">
                {otherRecentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/oppdrag/${order.id}`}
                    className={`${CUSTOMER_INSET} block p-2.5 transition hover:border-[var(--ink,#101310)]`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-[var(--ink,#101310)]">
                        {order.title}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p
                      className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs ${CUSTOMER_MUTED}`}
                    >
                      {formatDateLocalized(
                        order.scheduledFor,
                        locale,
                        undefined,
                        t("customers.overview.noDate"),
                      )}
                      {order._count.reports > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon
                            name="clipboard"
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          {t("customers.overview.checklists", {
                            count: order._count.reports,
                          })}
                        </span>
                      ) : null}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Aktivitetsstrømmen ligger over de sekundære tallene. */}
      <section className={`${CUSTOMER_CARD} space-y-3 p-4 sm:p-5`}>
        <PanelHeader
          icon="clipboard"
          title={t("customers.overview.recentActivity")}
          action={
            <Link
              href="?tab=aktivitet"
              className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--ink,#101310)]"
            >
              {t("customers.overview.seeAllActivity")}
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <CustomerActivityList
          items={recentActivity}
          emptyLabel={t("customers.overview.noActivity")}
          showKind={false}
        />
      </section>

      {secondaryNumbers.length > 0 && (
        <section aria-label={t("customers.overview.moreNumbers")}>
          <h2 className={`mb-2 ${CUSTOMER_EYEBROW}`}>
            {t("customers.overview.moreNumbers")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {secondaryNumbers.map((entry) => (
              <Link
                key={entry.key}
                href={entry.href}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
              >
                <Icon
                  name={entry.icon}
                  className="h-3.5 w-3.5 shrink-0"
                  strokeWidth={2}
                />
                <span>{entry.label}</span>
                <span className="font-black tabular-nums">{entry.value}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
