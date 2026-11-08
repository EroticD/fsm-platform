import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import SubmitButton from "@/components/SubmitButton";
import LineItemsEditor, { type EditableLine } from "@/components/billing/LineItemsEditor";
import CustomerContactSelect from "@/components/billing/CustomerContactSelect";

const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm";
const CARD = "office-card min-w-0 p-4 sm:p-5";

export type QuoteFormDefaults = {
  id?: string;
  title: string;
  customerId: string;
  contactId: string;
  workOrderId: string;
  contractId: string;
  productId: string;
  departmentId: string;
  validUntil: string;
  vatRate: string;
  notes: string;
  lines: EditableLine[];
};

export type QuoteFormOptions = {
  customers: Array<{ id: string; name: string; customerNumber: string | null }>;
  contacts: Array<{ id: string; name: string; customerId: string; role?: string | null }>;
  workOrders: Array<{ id: string; title: string; reference: string }>;
  contracts: Array<{ id: string; title: string; customerId: string }>;
  products: Array<{ id: string; model: string; customerId: string }>;
  departments: Array<{ id: string; name: string }>;
  isAdmin: boolean;
};

export default async function QuoteForm({
  action,
  defaults,
  options,
  submitLabel,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  defaults: QuoteFormDefaults;
  options: QuoteFormOptions;
  submitLabel: string;
  cancelHref: string;
}) {
  const t = await getTranslations("common");

  return (
    <form action={action} className="space-y-4">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <section className={CARD}>
        <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
          {t("quotes.form.details")}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={LABEL}>{t("quotes.form.title")}</span>
            <input name="title" defaultValue={defaults.title} required maxLength={200} className={INPUT} />
          </label>
          <CustomerContactSelect
            customers={options.customers}
            defaultCustomerId={defaults.customerId}
            defaultContactId={defaults.contactId}
            initialContacts={options.contacts}
            labels={{
              customer: t("quotes.form.customer"),
              chooseCustomer: t("quotes.form.chooseCustomer"),
              contact: t("quotes.form.contact"),
              noContact: t("quotes.form.noContact"),
              loadingContacts: t("quotes.form.loadingContacts"),
              noContacts: t("quotes.form.noContacts"),
            }}
          />
          <label>
            <span className={LABEL}>{t("quotes.form.workOrder")}</span>
            <select name="workOrderId" defaultValue={defaults.workOrderId} className={INPUT}>
              <option value="">{t("quotes.form.noWorkOrder")}</option>
              {options.workOrders.map((workOrder) => (
                <option key={workOrder.id} value={workOrder.id}>
                  {workOrder.reference} · {workOrder.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t("quotes.form.contract")}</span>
            <select name="contractId" defaultValue={defaults.contractId} className={INPUT}>
              <option value="">{t("quotes.form.noContract")}</option>
              {options.contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t("quotes.form.equipment")}</span>
            <select name="productId" defaultValue={defaults.productId} className={INPUT}>
              <option value="">{t("quotes.form.noEquipment")}</option>
              {options.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.model}
                </option>
              ))}
            </select>
          </label>
          {options.isAdmin ? (
            <label>
              <span className={LABEL}>{t("quotes.form.department")}</span>
              <select name="departmentId" defaultValue={defaults.departmentId} className={INPUT}>
                <option value="">{t("quotes.form.defaultDepartment")}</option>
                {options.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span className={LABEL}>{t("quotes.form.validUntil")}</span>
            <input type="date" name="validUntil" defaultValue={defaults.validUntil} className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>{t("quotes.form.vatRate")}</span>
            <input
              type="number"
              name="vatRate"
              min="0"
              max="100"
              step="0.01"
              defaultValue={defaults.vatRate}
              className={INPUT}
            />
          </label>
          <label className="sm:col-span-2">
            <span className={LABEL}>{t("quotes.form.notes")}</span>
            <textarea name="notes" defaultValue={defaults.notes} rows={4} className={INPUT} />
          </label>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
          {t("quotes.form.linesTitle")}
        </h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("quotes.form.linesHint")}
        </p>
        <div className="mt-3">
          <LineItemsEditor
            initialLines={defaults.lines}
            vatRate={defaults.vatRate}
            labels={{
              lineFormat: t("quotes.lines.line", { number: "§" }),
              description: t("quotes.lines.description"),
              quantity: t("quotes.lines.quantity"),
              unit: t("quotes.lines.unit"),
              unitPrice: t("quotes.lines.unitPrice"),
              vatRate: t("quotes.lines.vatRate"),
              add: t("quotes.lines.add"),
              remove: t("quotes.lines.remove"),
            }}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-4 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
          pendingLabel={t("quotes.form.saving")}
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
