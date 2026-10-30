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

type CustomerContract = CustomerDetailData["customer"]["contracts"][number];
type Department = CustomerDetailData["departments"][number];
type Template = CustomerDetailData["templates"][number];
type SlaPolicy = CustomerDetailData["slaPolicies"][number];
type PriceList = CustomerDetailData["priceLists"][number];
type ContractProduct = CustomerDetailData["contractProducts"][number];

type ContractsTabProps = {
  customer: CustomerDetailData["customer"];
  templates: Template[];
  departments: Department[];
  defaultDepartmentId: string | null;
  slaPolicies: SlaPolicy[];
  priceLists: PriceList[];
  contractProducts: ContractProduct[];
  office: boolean;
  isAdmin: boolean;
  ownDepartmentId: string | null;
  userDepartmentName: string | null;
  createContract: (formData: FormData) => Promise<void>;
  deleteContract: (formData: FormData) => Promise<void>;
  updateContract: (formData: FormData) => Promise<void>;
  pauseContract: (formData: FormData) => Promise<void>;
  resumeContract: (formData: FormData) => Promise<void>;
  terminateContract: (formData: FormData) => Promise<void>;
  renewContract: (formData: FormData) => Promise<void>;
  addContractLine: (formData: FormData) => Promise<void>;
  deleteContractLine: (formData: FormData) => Promise<void>;
};

const STATUS_TONE: Record<string, string> = {
  DRAFT:
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  ACTIVE:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  PAUSED: "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]",
  EXPIRED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  TERMINATED: "border-[#c9c0ac] bg-[#efeee8] text-[#4a473e]",
};

function productLabel(product: CustomerContract["lines"][number]["product"]) {
  if (!product) return "";
  return [product.model, product.serialNumber].filter(Boolean).join(" · ");
}

export default async function CustomerContractsTab({
  customer,
  templates,
  departments,
  defaultDepartmentId,
  slaPolicies,
  priceLists,
  contractProducts,
  office,
  isAdmin,
  ownDepartmentId,
  userDepartmentName,
  createContract,
  deleteContract,
  updateContract,
  pauseContract,
  resumeContract,
  terminateContract,
  renewContract,
  addContractLine,
  deleteContractLine,
}: ContractsTabProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  const statusLabel = (status: string) => {
    switch (status) {
      case "DRAFT":
        return t("customers.contracts.status.draft");
      case "ACTIVE":
        return t("customers.contracts.status.active");
      case "PAUSED":
        return t("customers.contracts.status.paused");
      case "EXPIRED":
        return t("customers.contracts.status.expired");
      case "TERMINATED":
        return t("customers.contracts.status.terminated");
      default:
        return status;
    }
  };

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
            <div>
              <label htmlFor="contract-number" className={CUSTOMER_LABEL}>
                {t("customers.contracts.contractNumber")}
              </label>
              <input
                id="contract-number"
                type="text"
                name="contractNumber"
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
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
              <label htmlFor="contract-end-date" className={CUSTOMER_LABEL}>
                {t("customers.contracts.endDate")}
              </label>
              <input
                id="contract-end-date"
                type="date"
                name="endDate"
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
              <label htmlFor="contract-status" className={CUSTOMER_LABEL}>
                {t("customers.contracts.statusLabel")}
              </label>
              <select
                id="contract-status"
                name="status"
                defaultValue="ACTIVE"
                className={CUSTOMER_CONTROL}
              >
                <option value="DRAFT">
                  {t("customers.contracts.status.draft")}
                </option>
                <option value="ACTIVE">
                  {t("customers.contracts.status.active")}
                </option>
              </select>
            </div>
            <div>
              <label htmlFor="contract-renewal" className={CUSTOMER_LABEL}>
                {t("customers.contracts.renewalMode")}
              </label>
              <select
                id="contract-renewal"
                name="renewalMode"
                defaultValue="MANUAL"
                className={CUSTOMER_CONTROL}
              >
                <option value="MANUAL">
                  {t("customers.contracts.renewal.manual")}
                </option>
                <option value="AUTO">
                  {t("customers.contracts.renewal.auto")}
                </option>
              </select>
            </div>
            <div>
              <label htmlFor="contract-notice" className={CUSTOMER_LABEL}>
                {t("customers.contracts.noticeDays")}
              </label>
              <input
                id="contract-notice"
                type="number"
                name="noticeDays"
                min={0}
                max={3650}
                defaultValue={30}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="contract-indexation" className={CUSTOMER_LABEL}>
                {t("customers.contracts.indexationPercent")}
              </label>
              <input
                id="contract-indexation"
                type="number"
                name="indexationPercent"
                step="0.01"
                min={-100}
                max={100}
                className={CUSTOMER_CONTROL}
              />
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
            <div>
              <label htmlFor="contract-sla" className={CUSTOMER_LABEL}>
                {t("customers.contracts.slaPolicy")}
              </label>
              <select
                id="contract-sla"
                name="slaPolicyId"
                defaultValue=""
                className={CUSTOMER_CONTROL}
              >
                <option value="">{t("customers.contracts.noSlaPolicy")}</option>
                {slaPolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-price-list" className={CUSTOMER_LABEL}>
                {t("customers.contracts.priceList")}
              </label>
              <select
                id="contract-price-list"
                name="priceListId"
                defaultValue=""
                className={CUSTOMER_CONTROL}
              >
                <option value="">{t("customers.contracts.noPriceList")}</option>
                {priceLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-line-product" className={CUSTOMER_LABEL}>
                {t("customers.contracts.lineEquipment")}
              </label>
              <select
                id="contract-line-product"
                name="lineProductId"
                defaultValue=""
                className={CUSTOMER_CONTROL}
              >
                <option value="">
                  {t("customers.contracts.lineAllEquipment")}
                </option>
                {contractProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.model}
                    {product.serialNumber ? ` · ${product.serialNumber}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contract-line-scope" className={CUSTOMER_LABEL}>
                {t("customers.contracts.lineScope")}
              </label>
              <input
                id="contract-line-scope"
                type="text"
                name="lineScope"
                className={CUSTOMER_CONTROL}
              />
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
        <div className="space-y-3">
          {customer.contracts.map((contract) => {
            const latestOrder = contract.workOrders[0];
            const status = contract.status ?? (contract.isActive ? "ACTIVE" : "PAUSED");
            const canEdit =
              office &&
              (isAdmin || contract.departmentId === ownDepartmentId);
            return (
              <article
                key={contract.id}
                className={`${CUSTOMER_INSET} space-y-3 p-3 sm:p-4`}
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--ink,#101310)]">
                      {contract.title}
                    </p>
                    <p
                      className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${CUSTOMER_MUTED}`}
                    >
                      {contract.contractNumber ? (
                        <>
                          <span>
                            {t("customers.contracts.contractNumberValue", {
                              number: contract.contractNumber,
                            })}
                          </span>
                          <span aria-hidden>•</span>
                        </>
                      ) : null}
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
                        {t("customers.contracts.endDateValue", {
                          date: contract.endDate
                            ? formatDateLocalized(
                                contract.endDate,
                                locale,
                                undefined,
                                "–",
                              )
                            : t("customers.contracts.noEndDate"),
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
                    <p className={`text-xs ${CUSTOMER_MUTED}`}>
                      {t("customers.contracts.renewalValue", {
                        mode:
                          contract.renewalMode === "AUTO"
                            ? t("customers.contracts.renewal.auto")
                            : t("customers.contracts.renewal.manual"),
                        days: contract.noticeDays,
                      })}
                      {contract.indexationPercent !== null
                        ? ` • ${t("customers.contracts.indexationValue", {
                            percent: Number(contract.indexationPercent),
                          })}`
                        : ""}
                    </p>
                    <p className={`text-xs ${CUSTOMER_MUTED}`}>
                      {t("customers.contracts.slaValue", {
                        name:
                          contract.slaPolicy?.name ??
                          t("customers.contracts.noSlaPolicy"),
                        response:
                          contract.slaPolicy?.responseMinutes ??
                          t("customers.contracts.notSet"),
                        resolution:
                          contract.slaPolicy?.resolutionMinutes ??
                          t("customers.contracts.notSet"),
                      })}
                    </p>
                    {contract.priceList ? (
                      <p className={`text-xs ${CUSTOMER_MUTED}`}>
                        {t("customers.contracts.priceListValue", {
                          name: contract.priceList.name,
                          count: contract.priceList.items.length,
                        })}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`self-start rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                      STATUS_TONE[status] ?? STATUS_TONE.PAUSED
                    }`}
                  >
                    {statusLabel(status)}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-black uppercase tracking-wide text-[var(--muted,#62685f)]">
                    {t("customers.contracts.linesTitle", {
                      count: contract.lines.length,
                    })}
                  </p>
                  {contract.lines.length === 0 ? (
                    <p className={`text-xs italic ${CUSTOMER_MUTED}`}>
                      {t("customers.contracts.linesEmpty")}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {contract.lines.map((line) => (
                        <li
                          key={line.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 py-1.5 text-xs"
                        >
                          <span className="font-bold">
                            {productLabel(line.product) ||
                              t("customers.contracts.lineAllEquipment")}
                            {line.scope ? ` · ${line.scope}` : ""}
                          </span>
                          <span className={`flex items-center gap-2 ${CUSTOMER_MUTED}`}>
                            {line.visitsPerYear !== null
                              ? t("customers.contracts.visitsPerYearValue", {
                                  count: line.visitsPerYear,
                                })
                              : null}
                            {line.responseMinutes !== null
                              ? t("customers.contracts.minutesValue", {
                                  count: line.responseMinutes,
                                })
                              : null}
                            {canEdit ? (
                              <form action={deleteContractLine}>
                                <input
                                  type="hidden"
                                  name="id"
                                  value={line.id}
                                />
                                <input
                                  type="hidden"
                                  name="contractId"
                                  value={contract.id}
                                />
                                <button
                                  type="submit"
                                  className="min-h-11 px-2 font-bold text-[var(--risk-text,#b42318)]"
                                >
                                  {t("delete")}
                                </button>
                              </form>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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

                <div className="flex flex-wrap gap-2 border-t border-[var(--line,#dedcd1)] pt-2">
                  <a
                    href={`/api/avtaler/${contract.id}/pdf?locale=${locale}`}
                    className={CUSTOMER_INK_BUTTON}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="file" className="h-4 w-4 shrink-0" />
                    {t("customers.contracts.pdf")}
                  </a>
                  {canEdit && contract.status === "ACTIVE" ? (
                    <form action={pauseContract}>
                      <input type="hidden" name="id" value={contract.id} />
                      <button type="submit" className={CUSTOMER_INK_BUTTON}>
                        {t("customers.contracts.pause")}
                      </button>
                    </form>
                  ) : null}
                  {canEdit &&
                  (contract.status === "PAUSED" ||
                    contract.status === "DRAFT") ? (
                    <form action={resumeContract}>
                      <input type="hidden" name="id" value={contract.id} />
                      <button type="submit" className={CUSTOMER_SIGNAL_BUTTON}>
                        {t("customers.contracts.activate")}
                      </button>
                    </form>
                  ) : null}
                  {canEdit &&
                  contract.status !== "TERMINATED" &&
                  contract.status !== "EXPIRED" ? (
                    <form action={renewContract}>
                      <input type="hidden" name="id" value={contract.id} />
                      <button type="submit" className={CUSTOMER_INK_BUTTON}>
                        {t("customers.contracts.renew")}
                      </button>
                    </form>
                  ) : null}
                  {canEdit &&
                  contract.status !== "TERMINATED" ? (
                    <ConfirmSubmitForm
                      action={terminateContract}
                      confirmMessage={t("customers.contracts.terminateConfirm", {
                        title: contract.title,
                      })}
                      confirmLabel={t("customers.contracts.terminate")}
                      danger
                      className="inline-flex"
                    >
                      <input type="hidden" name="id" value={contract.id} />
                      <button type="submit" className={CUSTOMER_RISK_BUTTON}>
                        {t("customers.contracts.terminate")}
                      </button>
                    </ConfirmSubmitForm>
                  ) : null}
                  {isAdmin && (
                    <ConfirmSubmitForm
                      action={deleteContract}
                      confirmMessage={t("customers.contracts.deleteConfirm", {
                        title: contract.title,
                      })}
                      confirmLabel={t("delete")}
                      danger
                      className="inline-flex"
                    >
                      <input type="hidden" name="id" value={contract.id} />
                      <button type="submit" className={CUSTOMER_RISK_BUTTON}>
                        <Icon name="trash" className="h-4 w-4 shrink-0" />
                        {t("customers.contracts.delete")}
                      </button>
                    </ConfirmSubmitForm>
                  )}
                </div>

                {canEdit && (
                  <>
                    <form action={updateContract} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-3">
                      <input type="hidden" name="id" value={contract.id} />
                      <p className="text-xs font-black uppercase tracking-wide text-[var(--muted,#62685f)]">
                        {t("customers.contracts.editTitle")}
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label
                            htmlFor={`contract-title-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.titleLabel")}
                          </label>
                          <input
                            id={`contract-title-${contract.id}`}
                            name="title"
                            required
                            defaultValue={contract.title}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-number-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.contractNumber")}
                          </label>
                          <input
                            id={`contract-number-${contract.id}`}
                            name="contractNumber"
                            defaultValue={contract.contractNumber ?? ""}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-status-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.statusLabel")}
                          </label>
                          <select
                            id={`contract-status-${contract.id}`}
                            name="status"
                            defaultValue={status}
                            className={CUSTOMER_CONTROL}
                          >
                            <option value="DRAFT">
                              {t("customers.contracts.status.draft")}
                            </option>
                            <option value="ACTIVE">
                              {t("customers.contracts.status.active")}
                            </option>
                            <option value="PAUSED">
                              {t("customers.contracts.status.paused")}
                            </option>
                            <option value="EXPIRED">
                              {t("customers.contracts.status.expired")}
                            </option>
                            <option value="TERMINATED">
                              {t("customers.contracts.status.terminated")}
                            </option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-start-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.startDate")}
                          </label>
                          <input
                            id={`contract-start-${contract.id}`}
                            type="date"
                            name="startDate"
                            required
                            defaultValue={toDateOnly(contract.startDate)}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-end-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.endDate")}
                          </label>
                          <input
                            id={`contract-end-${contract.id}`}
                            type="date"
                            name="endDate"
                            defaultValue={
                              contract.endDate ? toDateOnly(contract.endDate) : ""
                            }
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-interval-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.interval")}
                          </label>
                          <select
                            id={`contract-interval-${contract.id}`}
                            name="intervalMonths"
                            defaultValue={contract.intervalMonths}
                            className={CUSTOMER_CONTROL}
                          >
                            {CONTRACT_INTERVAL_MONTHS.map((months) => (
                              <option key={months} value={months}>
                                {t("customers.contracts.intervalMonths", {
                                  months,
                                })}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-renewal-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.renewalMode")}
                          </label>
                          <select
                            id={`contract-renewal-${contract.id}`}
                            name="renewalMode"
                            defaultValue={contract.renewalMode}
                            className={CUSTOMER_CONTROL}
                          >
                            <option value="MANUAL">
                              {t("customers.contracts.renewal.manual")}
                            </option>
                            <option value="AUTO">
                              {t("customers.contracts.renewal.auto")}
                            </option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-notice-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.noticeDays")}
                          </label>
                          <input
                            id={`contract-notice-${contract.id}`}
                            type="number"
                            name="noticeDays"
                            min={0}
                            max={3650}
                            defaultValue={contract.noticeDays}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-indexation-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.indexationPercent")}
                          </label>
                          <input
                            id={`contract-indexation-${contract.id}`}
                            type="number"
                            step="0.01"
                            min={-100}
                            max={100}
                            name="indexationPercent"
                            defaultValue={
                              contract.indexationPercent !== null
                                ? Number(contract.indexationPercent)
                                : ""
                            }
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        {isAdmin ? (
                          <div>
                            <label
                              htmlFor={`contract-department-${contract.id}`}
                              className={CUSTOMER_LABEL}
                            >
                              {t("customers.contracts.department")}
                            </label>
                            <select
                              id={`contract-department-${contract.id}`}
                              name="departmentId"
                              defaultValue={contract.departmentId}
                              className={CUSTOMER_CONTROL}
                            >
                              {departments.map((department) => (
                                <option key={department.id} value={department.id}>
                                  {department.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        <div>
                          <label
                            htmlFor={`contract-contact-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.contact")}
                          </label>
                          <select
                            id={`contract-contact-${contract.id}`}
                            name="contactId"
                            defaultValue={contract.contactId ?? ""}
                            className={CUSTOMER_CONTROL}
                          >
                            <option value="">
                              {t("customers.contracts.firstContact")}
                            </option>
                            {customer.contacts.map((contact) => (
                              <option key={contact.id} value={contact.id}>
                                {contact.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-template-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.template")}
                          </label>
                          <select
                            id={`contract-template-${contract.id}`}
                            name="templateId"
                            defaultValue={contract.templateId ?? ""}
                            className={CUSTOMER_CONTROL}
                          >
                            <option value="">
                              {t("customers.contracts.noTemplate")}
                            </option>
                            {templates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.title}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-sla-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.slaPolicy")}
                          </label>
                          <select
                            id={`contract-sla-${contract.id}`}
                            name="slaPolicyId"
                            defaultValue={contract.slaPolicyId ?? ""}
                            className={CUSTOMER_CONTROL}
                          >
                            <option value="">
                              {t("customers.contracts.noSlaPolicy")}
                            </option>
                            {slaPolicies.map((policy) => (
                              <option key={policy.id} value={policy.id}>
                                {policy.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`contract-price-list-${contract.id}`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.contracts.priceList")}
                          </label>
                          <select
                            id={`contract-price-list-${contract.id}`}
                            name="priceListId"
                            defaultValue={contract.priceListId ?? ""}
                            className={CUSTOMER_CONTROL}
                          >
                            <option value="">
                              {t("customers.contracts.noPriceList")}
                            </option>
                            {priceLists.map((list) => (
                              <option key={list.id} value={list.id}>
                                {list.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button type="submit" className={CUSTOMER_SIGNAL_BUTTON}>
                        {t("customers.contracts.saveChanges")}
                      </button>
                    </form>

                    <form
                      action={addContractLine}
                      className="grid grid-cols-1 gap-2 border-t border-[var(--line,#dedcd1)] pt-3 sm:grid-cols-[1.3fr_1.3fr_0.6fr_0.6fr_0.6fr_auto]"
                    >
                      <input type="hidden" name="contractId" value={contract.id} />
                      <div>
                        <label
                          htmlFor={`line-product-${contract.id}`}
                          className={CUSTOMER_LABEL}
                        >
                          {t("customers.contracts.lineEquipment")}
                        </label>
                        <select
                          id={`line-product-${contract.id}`}
                          name="productId"
                          defaultValue=""
                          className={CUSTOMER_CONTROL}
                        >
                          <option value="">
                            {t("customers.contracts.lineAllEquipment")}
                          </option>
                          {contractProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.model}
                              {product.serialNumber
                                ? ` · ${product.serialNumber}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor={`line-scope-${contract.id}`}
                          className={CUSTOMER_LABEL}
                        >
                          {t("customers.contracts.lineScope")}
                        </label>
                        <input
                          id={`line-scope-${contract.id}`}
                          name="scope"
                          className={CUSTOMER_CONTROL}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`line-visits-${contract.id}`}
                          className={CUSTOMER_LABEL}
                        >
                          {t("customers.contracts.visitsPerYear")}
                        </label>
                        <input
                          id={`line-visits-${contract.id}`}
                          name="visitsPerYear"
                          type="number"
                          min={0}
                          max={1000}
                          className={CUSTOMER_CONTROL}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`line-response-${contract.id}`}
                          className={CUSTOMER_LABEL}
                        >
                          {t("customers.contracts.responseMinutes")}
                        </label>
                        <input
                          id={`line-response-${contract.id}`}
                          name="responseMinutes"
                          type="number"
                          min={0}
                          className={CUSTOMER_CONTROL}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`line-resolution-${contract.id}`}
                          className={CUSTOMER_LABEL}
                        >
                          {t("customers.contracts.resolutionMinutes")}
                        </label>
                        <input
                          id={`line-resolution-${contract.id}`}
                          name="resolutionMinutes"
                          type="number"
                          min={0}
                          className={CUSTOMER_CONTROL}
                        />
                      </div>
                      <div className="flex items-end">
                        <button type="submit" className={CUSTOMER_INK_BUTTON}>
                          <Icon name="plus" className="h-4 w-4" />
                          {t("customers.contracts.addLine")}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </CustomerTabPanel>
  );
}
