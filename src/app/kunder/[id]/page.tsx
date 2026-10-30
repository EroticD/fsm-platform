import { redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { workOrderScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { parsePage } from "@/lib/pagination";
import {
  CUSTOMER_ACTIVE_STATUSES,
  CUSTOMER_ORDER_PAGE_SIZE,
  getCustomerDetail,
  resolveCustomerTab,
  type CustomerTab,
} from "@/server/customers";
import CustomerOverviewTab from "@/components/customer/CustomerOverviewTab";
import CustomerOrdersTab from "@/components/customer/CustomerOrdersTab";
import CustomerReportsTab from "@/components/customer/CustomerReportsTab";
import CustomerContractsTab from "@/components/customer/CustomerContractsTab";
import CustomerUnitsTab from "@/components/customer/CustomerUnitsTab";
import CustomerContactsTab from "@/components/customer/CustomerContactsTab";
import CustomerPortalTab from "@/components/customer/CustomerPortalTab";
import CustomerActivityTab from "@/components/customer/CustomerActivityTab";
import CustomerAttachments from "@/components/CustomerAttachments";
import CustomerSectionScroll from "@/components/customer/CustomerSectionScroll";
import CustomerTabs from "@/components/customer/CustomerTabs";
import CustomerOrdersReportsSwitch from "@/components/customer/CustomerOrdersReportsSwitch";
import CustomerToast from "@/components/customer/CustomerToast";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/icons";
import type { IconName } from "@/components/icons";
import {
  CUSTOMER_CARD,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_RISK_BUTTON,
  CUSTOMER_SIGNAL_BUTTON,
  LEGACY_SURFACE,
} from "@/components/customer/customerStyles";
import {
  addContactAction,
  addContractLineAction,
  createContractAction,
  deleteContactAction,
  deleteContractAction,
  deleteContractLineAction,
  deleteCustomerAction,
  pauseContractAction,
  renewContractAction,
  resumeContractAction,
  terminateContractAction,
  updateContactAction,
  updateContractAction,
} from "./actions";
import { createUnit, deleteUnit, updateUnit } from "./unit-actions";
import {
  createPortalUser,
  resendPortalInvite,
  setPortalUserActive,
} from "./portal-actions";
import {
  customerErrorMessageKey,
  customerStatusMessageKey,
} from "../feedback";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    status?: string;
    tab?: string;
    vis?: string;
    side?: string;
    enhet?: string;
  }>;
}) {
  const resolvedParams = await params;
  const customerId = resolvedParams.id;
  const { error, status, tab, vis, side, enhet } = await searchParams;
  const orderPage = parsePage(side);
  const unitQuery = enhet?.trim().slice(0, 120) ?? "";
  const t = await getTranslations("common");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  const canManageCustomers = hasPermission(user, "customers.manage");
  const canManageEquipment = hasPermission(user, "equipment.manage");
  const canViewContracts =
    hasPermission(user, "contracts.view") ||
    hasPermission(user, "contracts.manage");
  const canManageContracts = hasPermission(user, "contracts.manage");
  const canCreateWorkOrders = hasPermission(user, "workorders.create");
  const canViewEquipment = hasPermission(user, "equipment.view");
  const canViewReports = hasPermission(user, "reports.view");
  const isAdmin = user.role === "ADMIN";
  const office = canManageCustomers;
  const ownDepartmentId = user.departmentId;

  // Fem toppnivåfaner. Utstyr skjules for aktører uten equipment.view.
  // Gamle ?tab=-verdier løses til den nye fanen i tjenestelaget, slik at
  // ?tab=vedlegg, ?tab=kontakter, ?tab=portal og ?tab=aktivitet fortsatt
  // lander på Mer.
  const availableTabs: CustomerTab[] = [
    "oversikt",
    "oppdrag",
    ...(canViewEquipment ? (["utstyr"] as CustomerTab[]) : []),
    "avtaler",
    "mer",
  ];
  const resolvedTab = resolveCustomerTab(tab);
  // «?tab=rapporter» er en eldre/alternativ inngang til rapportvisningen.
  // Den løses til Oppdrag-fanen med rapportsegmentet valgt.
  const reportsAlias = (tab ?? "").trim().toLowerCase() === "rapporter";
  const currentTab: CustomerTab = reportsAlias
    ? "oppdrag"
    : availableTabs.includes(resolvedTab.tab)
      ? resolvedTab.tab
      : "oversikt";
  const showCustomerReports =
    currentTab === "oppdrag" &&
    canViewReports &&
    (reportsAlias || vis === "rapporter");
  const merSection =
    currentTab === "mer" && resolvedTab.section !== "portal"
      ? resolvedTab.section
      : currentTab === "mer"
        ? "portal"
        : null;

  const result = await getCustomerDetail(user, customerId, {
    tab: currentTab,
    orderPage,
    unitQuery,
  });

  if (!result.ok) {
    if (result.reason === "forbidden") redirect("/");
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center p-4 sm:p-6">
        <div className={`${CUSTOMER_CARD} w-full max-w-lg p-6 ${LEGACY_SURFACE}`}>
          <EmptyState
            icon={<Icon name="building" className="h-8 w-8" />}
            title={t("customers.detail.notFound")}
            action={
              <Link href="/kunder" className={CUSTOMER_INK_BUTTON}>
                <Icon
                  name="arrowRight"
                  className="h-4 w-4 rotate-180 shrink-0"
                />
                {t("customers.detail.backToArchive")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const data = result.data;
  const { customer } = data;

  // Forfalte oppdrag hentes bare på oversikten. Spørringen bruker samme
  // oppdragsomfang som kundekortet, slik at avdelingssperren gjelder også
  // «forfalt»-tallet.
  let overdueCount = 0;
  let overdueOrders: Array<{
    id: string;
    title: string;
    scheduledFor: Date | null;
    status: string;
  }> = [];
  if (currentTab === "oversikt") {
    const overdueWhere: Prisma.WorkOrderWhereInput = {
      AND: [
        { customerId },
        workOrderScope(user),
        { status: { in: CUSTOMER_ACTIVE_STATUSES } },
        { scheduledFor: { lt: new Date() } },
      ],
    };
    [overdueCount, overdueOrders] = await Promise.all([
      prisma.workOrder.count({ where: overdueWhere }),
      prisma.workOrder.findMany({
        where: overdueWhere,
        orderBy: { scheduledFor: "asc" },
        take: 3,
        select: {
          id: true,
          title: true,
          scheduledFor: true,
          status: true,
        },
      }),
    ]);
  }
  const activePortalCount = data.portalUsers.filter(
    (portalUser) => portalUser.isActive,
  ).length;

  // Nøkkelen lagres som hash. Den rå invitasjonslenken vises bare i
  // sideinnholdet rett etter at handlingen er utført.
  const portalError =
    error === "mangler_felt"
      ? t("customers.portal.errorMissingFields")
      : error === "ugyldig_kontakt"
        ? t("customers.portal.errorInvalidContact")
        : error === "epost_finnes"
          ? t("customers.portal.errorDuplicateEmail")
          : null;

  const statusKey = customerStatusMessageKey(status);
  const errorKey = customerErrorMessageKey(error);

  const tabMeta: Array<{
    key: CustomerTab;
    label: string;
    icon: IconName;
    count?: number;
  }> = [
    {
      key: "oversikt",
      label: t("customers.detail.tabs.overview"),
      icon: "chart",
    },
    {
      key: "oppdrag",
      label: t("customers.detail.tabs.orders"),
      icon: "folder",
      count: data.totalOrders,
    },
    ...(canViewEquipment
      ? [
          {
            key: "utstyr" as CustomerTab,
            label: t("customers.detail.tabs.units"),
            icon: "wrench" as IconName,
            count: customer._count.products,
          },
        ]
      : []),
    ...(canViewContracts
      ? [
          {
            key: "avtaler" as CustomerTab,
            label: t("customers.detail.tabs.contracts"),
            icon: "file" as IconName,
            count: customer._count.contracts,
          },
        ]
      : []),
    {
      key: "mer",
      label: t("customers.detail.tabs.more"),
      icon: "dots",
    },
  ];

  const tabHref = (key: CustomerTab) => {
    const params = new URLSearchParams({ tab: key });
    if (key === "oppdrag" && orderPage > 1) {
      params.set("side", String(orderPage));
    }
    if (key === "utstyr" && unitQuery) {
      params.set("enhet", unitQuery);
    }
    return `?${params.toString()}`;
  };

  const addContact = addContactAction.bind(null, customerId);
  const updateContact = updateContactAction.bind(null, customerId);
  const deleteContact = deleteContactAction.bind(null, customerId);
  const createContract = createContractAction.bind(null, customerId);
  const deleteContract = deleteContractAction.bind(null, customerId);
  const updateContract = updateContractAction.bind(null, customerId);
  const pauseContract = pauseContractAction.bind(null, customerId);
  const resumeContract = resumeContractAction.bind(null, customerId);
  const terminateContract = terminateContractAction.bind(null, customerId);
  const renewContract = renewContractAction.bind(null, customerId);
  const addContractLine = addContractLineAction.bind(null, customerId);
  const deleteContractLine = deleteContractLineAction.bind(null, customerId);

  return (
    <div className={`office-app min-h-screen p-3 sm:p-6 lg:p-8 ${LEGACY_SURFACE}`}>
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          title={customer.name}
          icon={<Icon name="building" className="h-5 w-5" />}
          subtitle={`${t("customers.detail.customerNumber", {
            number: customer.customerNumber || "–",
          })}${customer.orgNumber ? ` • ${t("customers.detail.orgNumber", { number: customer.orgNumber })}` : ""}`}
          actions={
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {canCreateWorkOrders && (
                <Link
                  href={`/oppdrag/ny?customerId=${customer.id}`}
                  className={`${CUSTOMER_SIGNAL_BUTTON} flex-1 sm:flex-none`}
                >
                  <Icon name="plus" className="h-4 w-4 shrink-0" />
                  {t("customers.detail.newWorkOrder")}
                </Link>
              )}
              {office && (
                <Link
                  href={`/meldinger?kunde=${customer.id}`}
                  className={`${CUSTOMER_INK_BUTTON} flex-1 sm:flex-none`}
                >
                  <Icon name="mail" className="h-4 w-4 shrink-0" />
                  {t("sms.nav")}
                </Link>
              )}
              {office && (
                <Link
                  href={`/kunder/${customerId}/rediger`}
                  className={`${CUSTOMER_INK_BUTTON} flex-1 sm:flex-none`}
                >
                  <Icon name="edit" className="h-4 w-4 shrink-0" />
                  {t("customers.detail.edit")}
                </Link>
              )}
              {isAdmin && (
                <ConfirmSubmitForm
                  action={deleteCustomerAction.bind(null, customerId)}
                  confirmMessage={t("customers.detail.deleteConfirm", {
                    name: customer.name,
                  })}
                  confirmLabel={t("delete")}
                  danger
                  className="flex-1 sm:flex-none"
                >
                  <button
                    type="submit"
                    className={`${CUSTOMER_RISK_BUTTON} w-full`}
                  >
                    <Icon name="trash" className="h-4 w-4 shrink-0" />
                    {t("customers.detail.delete")}
                  </button>
                </ConfirmSubmitForm>
              )}
              <Link
                href="/kunder"
                className={`${CUSTOMER_INK_BUTTON} flex-1 sm:flex-none`}
              >
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("customers.detail.backToCustomers")}
              </Link>
            </div>
          }
        />

        {statusKey && <CustomerToast message={t(statusKey)} tone="success" />}

        <ErrorBanner
          message={errorKey ? t(errorKey) : undefined}
        />

        {/* FANER (TABS) */}
        <CustomerTabs
          tabs={tabMeta.map((entry) => ({
            ...entry,
            href: tabHref(entry.key),
          }))}
          currentKey={currentTab}
          label={t("customers.detail.tabs.label")}
        />

        {currentTab === "oppdrag" && canViewReports && (
          <CustomerOrdersReportsSwitch
            active={showCustomerReports ? "reports" : "orders"}
            ordersHref={tabHref("oppdrag")}
            reportsHref="?tab=oppdrag&vis=rapporter"
            reportCount={data.reportCount}
          />
        )}

        {currentTab === "oversikt" && (
          <CustomerOverviewTab
            customer={customer}
            customerId={customerId}
            office={office}
            totalOrders={data.totalOrders}
            activeOrders={data.activeOrders}
            completedOrders={data.completedOrders}
            reportCount={data.reportCount}
            nextOrder={data.nextOrder}
            portalUserCount={data.portalUsers.length}
            activePortalCount={activePortalCount}
            overdueCount={overdueCount}
            overdueOrders={overdueOrders}
            recentOrders={data.recentOrders}
            recentActivity={data.recentActivity}
          />
        )}

        {currentTab === "oppdrag" &&
          (showCustomerReports ? (
            <CustomerReportsTab
              customerId={customerId}
              user={user}
            />
          ) : (
            <CustomerOrdersTab
              customerId={customerId}
              canCreateWorkOrders={canCreateWorkOrders}
              totalOrders={data.totalOrders}
              visibleWorkOrders={data.visibleWorkOrders}
              orderTotalPages={data.orderTotalPages}
              orderPage={orderPage}
              pageSize={CUSTOMER_ORDER_PAGE_SIZE}
            />
          ))}

        {currentTab === "avtaler" && canViewContracts && (
          <CustomerContractsTab
            customer={customer}
            templates={data.templates}
            departments={data.departments}
            defaultDepartmentId={data.defaultDepartmentId}
            slaPolicies={data.slaPolicies}
            priceLists={data.priceLists}
            contractProducts={data.contractProducts}
            office={canManageContracts}
            isAdmin={isAdmin}
            ownDepartmentId={ownDepartmentId}
            userDepartmentName={user.department?.name ?? null}
            createContract={createContract}
            deleteContract={deleteContract}
            updateContract={updateContract}
            pauseContract={pauseContract}
            resumeContract={resumeContract}
            terminateContract={terminateContract}
            renewContract={renewContract}
            addContractLine={addContractLine}
            deleteContractLine={deleteContractLine}
          />
        )}

        {currentTab === "utstyr" && (
          <CustomerUnitsTab
            customerId={customerId}
            products={data.products}
            unitQuery={unitQuery}
            unitTotal={customer._count.products}
            canManageEquipment={canManageEquipment}
            canViewReports={canViewReports}
            isAdmin={isAdmin}
            createUnit={createUnit}
            updateUnit={updateUnit}
            deleteUnit={deleteUnit}
          />
        )}

        {currentTab === "mer" && (
          <div className="space-y-6">
            <CustomerSectionScroll target={merSection} />
            <div id="kontakter" className="scroll-mt-24">
              <CustomerContactsTab
                customerId={customerId}
                contacts={customer.contacts}
                office={office}
                isAdmin={isAdmin}
                addContact={addContact}
                updateContact={updateContact}
                deleteContact={deleteContact}
              />
            </div>
            {office && (
              <div id="portal" className="scroll-mt-24">
                <CustomerPortalTab
                  customerId={customerId}
                  contacts={customer.contacts}
                  portalUsers={data.portalUsers}
                  office={office}
                  portalError={portalError}
                  createPortalUser={createPortalUser}
                  setPortalUserActive={setPortalUserActive}
                  resendPortalInvite={resendPortalInvite}
                />
              </div>
            )}
            <div
              id="vedlegg"
              className={`scroll-mt-24 ${LEGACY_SURFACE}`}
            >
              <CustomerAttachments
                customerId={customerId}
                attachments={customer.attachments.map((attachment) => ({
                  id: attachment.id,
                  fileName: attachment.fileName,
                  dataUrl: attachment.dataUrl,
                }))}
                canUpload={canManageCustomers}
                canDelete={isAdmin}
              />
            </div>
            <div id="aktivitet" className="scroll-mt-24">
              <CustomerActivityTab
                customerId={customerId}
                activity={data.activityFeed}
                auditLogs={data.customerAuditLogs}
                comments={data.customerComments}
                currentUserName={user.name || null}
                canManageCustomers={canManageCustomers}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
