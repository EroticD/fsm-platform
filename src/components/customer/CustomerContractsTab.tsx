import Link from "next/link";
import { getTranslations } from "next-intl/server";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { CONTRACT_INTERVAL_MONTHS } from "@/lib/contracts";
import { formatDate, toDateOnly } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";

type ContractsTabProps = {
  customer: CustomerDetailData["customer"];
  templates: CustomerDetailData["templates"];
  departments: CustomerDetailData["departments"];
  defaultDepartmentId: string | null;
  office: boolean;
  isAdmin: boolean;
  ownDepartmentId: string | null;
  userDepartmentName: string | null;
  createContract: (formData: FormData) => Promise<void>;
  toggleContract: (formData: FormData) => Promise<void>;
  deleteContract: (formData: FormData) => Promise<void>;
};

export default async function CustomerContractsTab({
  customer,
  templates,
  departments,
  defaultDepartmentId,
  office,
  isAdmin,
  ownDepartmentId,
  userDepartmentName,
  createContract,
  toggleContract,
  deleteContract,
}: ContractsTabProps) {
  const t = await getTranslations("common");

  return (
    <CustomerTabPanel
      title={`📄 ${t("customers.contracts.title")}`}
      description={t("customers.contracts.description")}
    >
      {office && (isAdmin || ownDepartmentId) && (
        <form
          action={createContract}
          className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t("customers.contracts.titleLabel")} *
              </label>
              <input
                type="text"
                name="title"
                required
                placeholder={t("customers.contracts.titlePlaceholder")}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t("customers.contracts.department")} *
              </label>
              {isAdmin ? (
                <select
                  name="departmentId"
                  required
                  defaultValue={defaultDepartmentId ?? ""}
                  className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.isDefault
                        ? ` ${t("customers.contracts.defaultDepartment")}`
                        : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="w-full border border-gray-200 bg-white p-2 rounded-xl text-sm text-gray-800 font-bold">
                  {userDepartmentName || t("customers.contracts.noDepartment")}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t("customers.contracts.startDate")} *
              </label>
              <input
                type="date"
                name="startDate"
                required
                defaultValue={toDateOnly(new Date())}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t("customers.contracts.interval")} *
              </label>
              <select
                name="intervalMonths"
                required
                defaultValue="12"
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              >
                {CONTRACT_INTERVAL_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {t("customers.contracts.intervalMonths", { months })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t("customers.contracts.contact")}
              </label>
              <select
                name="contactId"
                defaultValue=""
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              >
                <option value="">{t("customers.contracts.firstContact")}</option>
                {customer.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.role ? ` (${contact.role})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t("customers.contracts.template")}
              </label>
              <select
                name="templateId"
                defaultValue=""
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              >
                <option value="">{t("customers.contracts.noTemplate")}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            {t("customers.contracts.hint")}
          </p>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm"
          >
            {t("customers.contracts.create")}
          </button>
        </form>
      )}

      {office && !isAdmin && !ownDepartmentId && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 font-bold">
          {t("customers.contracts.missingDepartment")}
        </p>
      )}

      {customer._count.contracts === 0 ? (
        <p className="text-xs text-gray-500 italic">
          {t("customers.contracts.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {customer.contracts.map((contract) => {
            const latestOrder = contract.workOrders[0];
            return (
              <div
                key={contract.id}
                className="bg-gray-50 rounded-xl border border-gray-200 p-3 sm:p-4 space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-gray-900 text-sm">
                      {contract.title}
                    </p>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      {t("customers.contracts.startDateValue", {
                        date: formatDate(contract.startDate, "–"),
                      })}{" "}
                      •{" "}
                      {t("customers.contracts.intervalValue", {
                        interval: t("customers.contracts.intervalMonths", {
                          months: contract.intervalMonths,
                        }),
                      })}{" "}
                      •{" "}
                      {t("customers.contracts.nextService", {
                        date: formatDate(contract.nextServiceDate, "–"),
                      })}
                    </p>
                    <p className="text-[11px] text-gray-600">
                      {t("customers.contracts.checklist")}{" "}
                      <span className="font-bold text-blue-800">
                        {contract.template?.title || t("customers.contracts.none")}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-600">
                      🏷️ {t("customers.contracts.departmentValue")}{" "}
                      <span className="font-bold">{contract.department.name}</span>
                    </p>
                  </div>
                  <span
                    className={`self-start text-[10px] font-bold px-2 py-1 rounded-full border uppercase ${
                      contract.isActive
                        ? "bg-green-100 text-green-800 border-green-200"
                        : "bg-amber-100 text-amber-800 border-amber-200"
                    }`}
                  >
                    {contract.isActive
                      ? t("customers.contracts.active")
                      : t("customers.contracts.paused")}
                  </span>
                </div>

                {latestOrder && (
                  <Link
                    href={`/oppdrag/${latestOrder.id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline"
                  >
                    {t("customers.contracts.latestOrder", {
                      title: latestOrder.title,
                      date: formatDate(
                        latestOrder.scheduledFor,
                        t("customers.overview.noDate"),
                      ),
                    })}
                  </Link>
                )}

                {office && (isAdmin || contract.departmentId === ownDepartmentId) && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                    <form action={toggleContract}>
                      <input type="hidden" name="id" value={contract.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={contract.isActive ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                          contract.isActive
                            ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                            : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                        }`}
                      >
                        {contract.isActive
                          ? t("customers.contracts.pause")
                          : t("customers.contracts.activate")}
                      </button>
                    </form>
                    {isAdmin && (
                      <ConfirmSubmitForm
                        action={deleteContract}
                        confirmMessage={t("customers.contracts.deleteConfirm", {
                          title: contract.title,
                        })}
                      >
                        <input type="hidden" name="id" value={contract.id} />
                        <button
                          type="submit"
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition"
                        >
                          {t("customers.contracts.delete")}
                        </button>
                      </ConfirmSubmitForm>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CustomerTabPanel>
  );
}
