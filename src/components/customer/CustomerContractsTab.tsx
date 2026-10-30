import Link from "next/link";
import Icon from "@/components/icons";
import { getLocale, getTranslations } from "next-intl/server";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { CONTRACT_INTERVAL_MONTHS } from "@/lib/contracts";
import { formatDateLocalized, toDateOnly } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";
import {
  CUSTOMER_CONTROL,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_INSET,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_RISK_BUTTON,
  CUSTOMER_SIGNAL_BUTTON,
} from "./customerStyles";

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
  const locale = await getLocale();

  return (
    <CustomerTabPanel
      title={
        <>
          <Icon name="file" className="h-4 w-4 shrink-0" />
          {t("customers.contracts.title")}
        </>
      }
      description={t("customers.contracts.description")}
    >
      {office && (isAdmin || ownDepartmentId) && (
        <form
          action={createContract}
          className={`${CUSTOMER_INSET} space-y-3 p-3 sm:p-4`}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="contract-title" className={CUSTOMER_LABEL}>
                {t("customers.contracts.titleLabel")} *
              </label>
              <input
                id="contract-title"
                type="text"
                name="title"
                required
                placeholder={t("customers.contracts.titlePlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="contract-department" className={CUSTOMER_LABEL}>
                {t("customers.contracts.department")} *
              </label>
              {isAdmin ? (
                <select
                  id="contract-department"
                  name="departmentId"
                  required
                  defaultValue={defaultDepartmentId ?? ""}
                  className={CUSTOMER_CONTROL}
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
                <div className="w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2 text-sm font-bold text-[var(--ink,#101310)]">
                  {userDepartmentName || t("customers.contracts.noDepartment")}
                </div>
              )}
            </div>
            <div>
              <label
                htmlFor="contract-start-date"
                className={CUSTOMER_LABEL}
              >
                {t("customers.contracts.startDate")} *
              </label>
              <input
                id="contract-start-date"
                type="date"
                name="startDate"
                required
                defaultValue={toDateOnly(new Date())}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="contract-interval" className={CUSTOMER_LABEL}>
                {t("customers.contracts.interval")} *
              </label>
              <select
                id="contract-interval"
                name="intervalMonths"
                required
                defaultValue="12"
                className={CUSTOMER_CONTROL}
              >
                {CONTRACT_INTERVAL_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {t("customers.contracts.intervalMonths", { months })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-contact" className={CUSTOMER_LABEL}>
                {t("customers.contracts.contact")}
              </label>
              <select
                id="contract-contact"
                name="contactId"
                defaultValue=""
                className={CUSTOMER_CONTROL}
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
              <label htmlFor="contract-template" className={CUSTOMER_LABEL}>
                {t("customers.contracts.template")}
              </label>
              <select
                id="contract-template"
                name="templateId"
                defaultValue=""
                className={CUSTOMER_CONTROL}
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
          <p className={`text-xs leading-5 ${CUSTOMER_MUTED}`}>
            {t("customers.contracts.hint")}
          </p>
          <button type="submit" className={`${CUSTOMER_SIGNAL_BUTTON} w-full`}>
            {t("customers.contracts.create")}
          </button>
        </form>
      )}

      {office && !isAdmin && !ownDepartmentId && (
        <p className="rounded-xl border border-[#e4c98f] bg-[#fdf5e4] p-3 text-xs font-bold text-[#6b4808]">
          {t("customers.contracts.missingDepartment")}
        </p>
      )}

      {customer._count.contracts === 0 ? (
        <p className={`text-xs italic ${CUSTOMER_MUTED}`}>
          {t("customers.contracts.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {customer.contracts.map((contract) => {
            const latestOrder = contract.workOrders[0];
            return (
              <article
                key={contract.id}
                className={`${CUSTOMER_INSET} space-y-2 p-3 sm:p-4`}
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--ink,#101310)]">
                      {contract.title}
                    </p>
                    <p
                      className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${CUSTOMER_MUTED}`}
                    >
                      <span>
                        {t("customers.contracts.startDateValue", {
                          date: formatDateLocalized(
                            contract.startDate,
                            locale,
                            undefined,
                            "–",
                          ),
                        })}
                      </span>
                      <span aria-hidden>•</span>
                      <span>
                        {t("customers.contracts.intervalValue", {
                          interval: t("customers.contracts.intervalMonths", {
                            months: contract.intervalMonths,
                          }),
                        })}
                      </span>
                      <span aria-hidden>•</span>
                      <span>
                        {t("customers.contracts.nextService", {
                          date: formatDateLocalized(
                            contract.nextServiceDate,
                            locale,
                            undefined,
                            "–",
                          ),
                        })}
                      </span>
                    </p>
                    <p className={`text-xs ${CUSTOMER_MUTED}`}>
                      {t("customers.contracts.checklist")}{" "}
                      <span className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4">
                        {contract.template?.title ||
                          t("customers.contracts.none")}
                      </span>
                    </p>
                    <p
                      className={`flex flex-wrap items-center gap-x-1.5 text-xs ${CUSTOMER_MUTED}`}
                    >
                      <Icon name="flag" className="h-3.5 w-3.5 shrink-0" />
                      {t("customers.contracts.departmentValue")}{" "}
                      <span className="font-bold text-[var(--ink,#101310)]">
                        {contract.department.name}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`self-start rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                      contract.isActive
                        ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                        : "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]"
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
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                  >
                    {t("customers.contracts.latestOrder", {
                      title: latestOrder.title,
                      date: formatDateLocalized(
                        latestOrder.scheduledFor,
                        locale,
                        undefined,
                        t("customers.overview.noDate"),
                      ),
                    })}
                    <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                )}

                {office &&
                  (isAdmin || contract.departmentId === ownDepartmentId) && (
                    <div className="flex flex-wrap gap-2 border-t border-[var(--line,#dedcd1)] pt-2">
                      <form action={toggleContract}>
                        <input type="hidden" name="id" value={contract.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={contract.isActive ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className={
                            contract.isActive
                              ? CUSTOMER_INK_BUTTON
                              : CUSTOMER_SIGNAL_BUTTON
                          }
                        >
                          {contract.isActive
                            ? t("customers.contracts.pause")
                            : t("customers.contracts.activate")}
                        </button>
                      </form>
                      {isAdmin && (
                        <ConfirmSubmitForm
                          action={deleteContract}
                          confirmMessage={t(
                            "customers.contracts.deleteConfirm",
                            { title: contract.title },
                          )}
                          confirmLabel={t("delete")}
                          danger
                          className="inline-flex"
                        >
                          <input type="hidden" name="id" value={contract.id} />
                          <button
                            type="submit"
                            className={CUSTOMER_RISK_BUTTON}
                          >
                            <Icon
                              name="trash"
                              className="h-4 w-4 shrink-0"
                            />
                            {t("customers.contracts.delete")}
                          </button>
                        </ConfirmSubmitForm>
                      )}
                    </div>
                  )}
              </article>
            );
          })}
        </div>
      )}
    </CustomerTabPanel>
  );
}
