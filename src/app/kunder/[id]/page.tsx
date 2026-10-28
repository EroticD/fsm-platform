import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { parsePage } from "@/lib/pagination";
import {
  CUSTOMER_ORDER_PAGE_SIZE,
  getCustomerDetail,
  resolveCustomerTab,
  type CustomerTab,
} from "@/server/customers";
import CustomerOverviewTab from "@/components/customer/CustomerOverviewTab";
import CustomerOrdersTab from "@/components/customer/CustomerOrdersTab";
import CustomerContractsTab from "@/components/customer/CustomerContractsTab";
import CustomerUnitsTab from "@/components/customer/CustomerUnitsTab";
import CustomerContactsTab from "@/components/customer/CustomerContactsTab";
import CustomerPortalTab from "@/components/customer/CustomerPortalTab";
import CustomerActivityTab from "@/components/customer/CustomerActivityTab";
import CustomerAttachments from "@/components/CustomerAttachments";
import CustomerSectionScroll from "@/components/customer/CustomerSectionScroll";
import CustomerToast from "@/components/customer/CustomerToast";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import {
  addContactAction,
  createContractAction,
  deleteContactAction,
  deleteContractAction,
  deleteCustomerAction,
  toggleContractAction,
  updateContactAction,
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
    side?: string;
    enhet?: string;
  }>;
}) {
  const resolvedParams = await params;
  const customerId = resolvedParams.id;
  const { error, status, tab, side, enhet } = await searchParams;
  const orderPage = parsePage(side);
  const unitQuery = enhet?.trim().slice(0, 120) ?? "";
  const t = await getTranslations("common");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  const canManageCustomers = hasPermission(user, "customers.manage");
  const canManageEquipment = hasPermission(user, "equipment.manage");
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
  const currentTab: CustomerTab = availableTabs.includes(resolvedTab.tab)
    ? resolvedTab.tab
    : "oversikt";
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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 sm:p-6">
        <EmptyState
          icon="🏢"
          title={t("customers.detail.notFound")}
          action={
            <Link href="/kunder" className="text-blue-600 font-bold hover:underline">
              {t("customers.detail.backToArchive")}
            </Link>
          }
        />
      </div>
    );
  }

  const data = result.data;
  const { customer } = data;

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
    count?: number;
  }> = [
    { key: "oversikt", label: t("customers.detail.tabs.overview") },
    {
      key: "oppdrag",
      label: t("customers.detail.tabs.orders"),
      count: data.totalOrders,
    },
    ...(canViewEquipment
      ? [
          {
            key: "utstyr" as CustomerTab,
            label: t("customers.detail.tabs.units"),
            count: customer._count.products,
          },
        ]
      : []),
    {
      key: "avtaler",
      label: t("customers.detail.tabs.contracts"),
      count: customer._count.contracts,
    },
    { key: "mer", label: t("customers.detail.tabs.more") },
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
  const toggleContract = toggleContractAction.bind(null, customerId);
  const deleteContract = deleteContractAction.bind(null, customerId);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader
          title={customer.name}
          subtitle={`${t("customers.detail.customerNumber", {
            number: customer.customerNumber || "–",
          })}${customer.orgNumber ? ` • ${t("customers.detail.orgNumber", { number: customer.orgNumber })}` : ""}`}
          actions={
            <div className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
              {canCreateWorkOrders && (
              <Link href={`/oppdrag/ny?customerId=${customer.id}`} className="flex-1 sm:flex-none justify-center bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition shadow-sm flex items-center gap-2 whitespace-nowrap">
                ➕ {t("customers.detail.newWorkOrder")}
              </Link>
            )}
            {office && (
              <Link href={`/kunder/${customerId}/rediger`} className="flex-1 sm:flex-none justify-center bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-200 transition shadow-sm flex items-center gap-2 whitespace-nowrap">
                ✏️ {t("customers.detail.edit")}
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
                  className="w-full bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-100 transition whitespace-nowrap"
                >
                  🗑️ {t("customers.detail.delete")}
                </button>
              </ConfirmSubmitForm>
            )}
              <Link href="/kunder" className="flex-1 sm:flex-none justify-center bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
                &larr; {t("customers.detail.backToCustomers")}
              </Link>
            </div>
          }
        />

        {statusKey && <CustomerToast message={t(statusKey)} tone="success" />}

        <ErrorBanner
          message={errorKey ? `⛔ ${t(errorKey)}` : undefined}
        />

        {/* FANER (TABS) */}
        <nav
          aria-label={t("customers.detail.tabs.label")}
          className="flex gap-1 bg-white border-2 border-gray-200 rounded-2xl p-1 shadow-sm overflow-x-auto"
          tabIndex={0}
        >
          {tabMeta.map((entry) => (
            <Link
              key={entry.key}
              href={tabHref(entry.key)}
              scroll={false}
              aria-current={currentTab === entry.key ? "page" : undefined}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
                currentTab === entry.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span>{entry.label}</span>
              {entry.count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                    currentTab === entry.key
                      ? "bg-white/20 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {entry.count}
                </span>
              )}
            </Link>
          ))}
        </nav>

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
            recentOrders={data.recentOrders}
            recentActivity={data.recentActivity}
          />
        )}

        {currentTab === "oppdrag" && (
          <CustomerOrdersTab
            customerId={customerId}
            canCreateWorkOrders={canCreateWorkOrders}
            totalOrders={data.totalOrders}
            visibleWorkOrders={data.visibleWorkOrders}
            orderTotalPages={data.orderTotalPages}
            orderPage={orderPage}
            pageSize={CUSTOMER_ORDER_PAGE_SIZE}
          />
        )}

        {currentTab === "avtaler" && (
          <CustomerContractsTab
            customer={customer}
            templates={data.templates}
            departments={data.departments}
            defaultDepartmentId={data.defaultDepartmentId}
            office={office}
            isAdmin={isAdmin}
            ownDepartmentId={ownDepartmentId}
            userDepartmentName={user.department?.name ?? null}
            createContract={createContract}
            toggleContract={toggleContract}
            deleteContract={deleteContract}
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
            <div id="vedlegg" className="scroll-mt-24">
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
