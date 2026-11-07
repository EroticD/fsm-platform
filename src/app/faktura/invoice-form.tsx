import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import SubmitButton from "@/components/SubmitButton";
import LineItemsEditor, { type EditableLine } from "@/components/billing/LineItemsEditor";

const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm";
const CARD = "office-card min-w-0 p-4 sm:p-5";

export type InvoiceFormDefaults = {
  id?: string;
  customerId: string;
  contactId: string;
  workOrderId: string;
  reportId: string;
  quoteId: string;
  departmentId: string;
  issueDate: string;
  dueDate: string;
  vatRate: string;
  notes: string;
  lines: EditableLine[];
};

export type InvoiceFormOptions = {
  customers: Array<{ id: string; name: string; customerNumber: string | null }>;
  contacts: Array<{ id: string; name: string; customerId: string; customerName: string }>;
  workOrders: Array<{ id: string; title: string; reference: string }>;
  reports: Array<{ id: string; name: string | null; reportNumber: string | null; workOrderTitle: string }>;
  quotes: Array<{ id: string; title: string; quoteNumber: string | null; customerName: string }>;
  departments: Array<{ id: string; name: string }>;
  isAdmin: boolean;
};

export default async function InvoiceForm({
  action,
  defaults,
  options,
  submitLabel,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  defaults: InvoiceFormDefaults;
  options: InvoiceFormOptions;
  submitLabel: string;
  cancelHref: string;
}) {
  const t = await getTranslations("common");

  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <section className={CARD}>
        <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
          {t("invoicing.form.details")}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={LABEL}>{t("invoicing.form.customer")}</span>
            <select name="customerId" defaultValue={defaults.customerId} required className={INPUT}>
              <option value="">{t("invoicing.form.chooseCustomer")}</option>
              {options.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.customerNumber ? ` · ${customer.customerNumber}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t("invoicing.form.contact")}</span>
            <select name="contactId" defaultValue={defaults.contactId} className={INPUT}>
              <option value="">{t("invoicing.form.noContact")}</option>
              {options.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} · {contact.customerName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t("invoicing.form.workOrder")}</span>
            <select name="workOrderId" defaultValue={defaults.workOrderId} className={INPUT}>
              <option value="">{t("invoicing.form.noWorkOrder")}</option>
              {options.workOrders.map((workOrder) => (
                <option key={workOrder.id} value={workOrder.id}>
                  {workOrder.reference} · {workOrder.title}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--muted,#62685f)]">
              {t("invoicing.form.workOrderHint")}
            </span>
          </label>
          <label>
            <span className={LABEL}>{t("invoicing.form.report")}</span>
            <select name="reportId" defaultValue={defaults.reportId} className={INPUT}>
              <option value="">{t("invoicing.form.noReport")}</option>
              {options.reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.reportNumber ?? report.name ?? report.id} · {report.workOrderTitle}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t("invoicing.form.quote")}</span>
            <select name="quoteId" defaultValue={defaults.quoteId} className={INPUT}>
              <option value="">{t("invoicing.form.noQuote")}</option>
              {options.quotes.map((quote) => (
                <option key={quote.id} value={quote.id}>
                  {quote.quoteNumber ?? quote.title} · {quote.customerName}
                </option>
              ))}
            </select>
          </label>
          {options.isAdmin ? (
            <label>
              <span className={LABEL}>{t("invoicing.form.department")}</span>
              <select name="departmentId" defaultValue={defaults.departmentId} className={INPUT}>
                <option value="">{t("invoicing.form.defaultDepartment")}</option>
                {options.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span className={LABEL}>{t("invoicing.form.issueDate")}</span>
            <input type="date" name="issueDate" defaultValue={defaults.issueDate} className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>{t("invoicing.form.dueDate")}</span>
            <input type="date" name="dueDate" defaultValue={defaults.dueDate} className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>{t("invoicing.form.vatRate")}</span>
            <input type="number" name="vatRate" min="0" max="100" step="0.01" defaultValue={defaults.vatRate} className={INPUT} />
          </label>
          <label className="sm:col-span-2">
            <span className={LABEL}>{t("invoicing.form.notes")}</span>
            <textarea name="notes" defaultValue={defaults.notes} rows={3} className={INPUT} />
          </label>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
          {t("invoicing.form.linesTitle")}
        </h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("invoicing.form.linesHint")}
        </p>
        <div className="mt-3">
          <LineItemsEditor
            initialLines={defaults.lines}
            vatRate={defaults.vatRate}
            labels={{
              lineFormat: t("invoicing.lines.line", { number: "§" }),
              description: t("invoicing.lines.description"),
              quantity: t("invoicing.lines.quantity"),
              unit: t("invoicing.lines.unit"),
              unitPrice: t("invoicing.lines.unitPrice"),
              vatRate: t("invoicing.lines.vatRate"),
              add: t("invoicing.lines.add"),
              remove: t("invoicing.lines.remove"),
            }}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-4 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
          pendingLabel={t("invoicing.form.saving")}
        >
          <Icon name="check" className="h-4 w-4" />
          {submitLabel}
        </SubmitButton>
        <Link
          href={cancelHref}
          className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] px-4 py-2 text-xs font-bold"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
