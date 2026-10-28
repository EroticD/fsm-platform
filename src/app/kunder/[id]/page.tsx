import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { parsePage } from "@/lib/pagination";
import {
  CUSTOMER_ORDER_PAGE_SIZE,
  getCustomerDetail,
} from "@/server/customers";
import CustomerOverviewTab from "@/components/customer/CustomerOverviewTab";
import CustomerOrdersTab from "@/components/customer/CustomerOrdersTab";
import CustomerContractsTab from "@/components/customer/CustomerContractsTab";
import CustomerUnitsTab from "@/components/customer/CustomerUnitsTab";
import CustomerContactsTab from "@/components/customer/CustomerContactsTab";
import CustomerPortalTab from "@/components/customer/CustomerPortalTab";
import CustomerActivityTab from "@/components/customer/CustomerActivityTab";
import CustomerAttachments from "@/components/CustomerAttachments";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import ErrorBanner from "@/components/ErrorBanner";
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

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    tab?: string;
    side?: string;
  }>;
}) {
  const resolvedParams = await params;
  const customerId = resolvedParams.id;
  const { error, tab, side } = await searchParams;
  const orderPage = parsePage(side);
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

  const tabs = [
    { key: "oversikt", label: t("customers.detail.tabs.overview") },
    { key: "oppdrag", label: t("customers.detail.tabs.orders") },
    { key: "avtaler", label: t("customers.detail.tabs.contracts") },
    { key: "vedlegg", label: t("customers.detail.tabs.attachments") },
    ...(canViewEquipment
      ? [{ key: "enheter", label: t("customers.detail.tabs.units") }]
      : []),
    {
      key: "kontakter",
      label: office
        ? t("customers.detail.tabs.contactsPortal")
        : t("customers.detail.tabs.contacts"),
    },
    { key: "aktivitet", label: t("customers.detail.tabs.activity") },
  ];
  // Den gamle portal-fanen er slått sammen med kontaktene. Behold ?tab=portal
  // som alias, slik at gamle lenker og handlinger fortsatt lander riktig.
  const requestedTab = tab === "portal" ? "kontakter" : tab;
  const currentTab = tabs.some((entry) => entry.key === requestedTab)
    ? (requestedTab as string)
    : "oversikt";

  const result = await getCustomerDetail(user, customerId, {
    tab: currentTab,
    orderPage,
  });

  if (!result.ok) {
    if (result.reason === "forbidden") redirect("/");
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("customers.detail.notFound")}</h1>
        <Link href="/kunder" className="text-blue-600 font-bold hover:underline">
          {t("customers.detail.backToArchive")}
        </Link>
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

  const addContact = addContactAction.bind(null, customerId);
  const updateContact = updateContactAction.bind(null, customerId);
  const deleteContact = deleteContactAction.bind(null, customerId);
  const createContract = createContractAction.bind(null, customerId);
  const toggleContract = toggleContractAction.bind(null, customerId);
  const deleteContract = deleteContractAction.bind(null, customerId);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-black text-gray-900">{customer.name}</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              {t("customers.detail.customerNumber", {
                number: customer.customerNumber || "–",
              })}
              {customer.orgNumber
                ? ` • ${t("customers.detail.orgNumber", { number: customer.orgNumber })}`
                : ""}
            </p>
          </div>
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
        </div>

        {/* FANER (TABS) */}
        <nav className="flex gap-1 bg-white border-2 border-gray-200 rounded-2xl p-1 shadow-sm overflow-x-auto" tabIndex={0}>
          {tabs.map((entry) => (
            <Link
              key={entry.key}
              href={`?tab=${entry.key}`}
              scroll={false}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
                currentTab === entry.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        {error === "ugyldig-data" && (
          <ErrorBanner message={`⛔ ${t("customers.detail.editError")}`} />
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
            recentOrders={data.recentOrders}
            recentLogs={data.recentLogs}
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

        {currentTab === "vedlegg" && (
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
        )}

        {currentTab === "enheter" && (
          <CustomerUnitsTab
            customerId={customerId}
            products={data.products}
            canManageEquipment={canManageEquipment}
            canViewReports={canViewReports}
            isAdmin={isAdmin}
            createUnit={createUnit}
            updateUnit={updateUnit}
            deleteUnit={deleteUnit}
          />
        )}

        {currentTab === "kontakter" && (
          <div className="space-y-6">
            <CustomerContactsTab
              customerId={customerId}
              contacts={customer.contacts}
              office={office}
              isAdmin={isAdmin}
              addContact={addContact}
              updateContact={updateContact}
              deleteContact={deleteContact}
            />
            {office && (
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
            )}
          </div>
        )}

        {currentTab === "aktivitet" && (
          <CustomerActivityTab
            customerId={customerId}
            auditLogs={data.customerAuditLogs}
            comments={data.customerComments}
            workOrders={data.activityWorkOrders}
            reports={data.activityReports}
            currentUserName={user.name || null}
            canManageCustomers={canManageCustomers}
            canViewReports={canViewReports}
          />
        )}
      </div>
    </div>
  );
}
