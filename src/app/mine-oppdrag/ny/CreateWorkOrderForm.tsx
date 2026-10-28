"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import CustomerSelect from "@/app/oppdrag/ny/CustomerSelect";
import ErrorBanner from "@/components/ErrorBanner";
import FormValuePersistence from "@/components/FormValuePersistence";
import MarkdownEditor from "@/components/MarkdownEditor";
import SubmitButton from "@/components/SubmitButton";
import TagSelector from "@/components/TagSelector";
import { splitTemplatesByCategory } from "@/lib/template-categories";

export default function CreateWorkOrderForm({
  customers,
  templates,
  tags,
  error,
}: {
  customers: {
    id: string;
    name: string;
    city: string | null;
    customerNumber: string | null;
  }[];
  templates: any[];
  tags: any[];
  error?: string;
}) {
  const t = useTranslations("common");
  const { service: serviceTemplates, hms: hmsTemplates } =
    splitTemplatesByCategory(templates);

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      <div className="bg-gray-900 text-white p-6 shadow-md rounded-b-3xl">
        <Link href="/mine-oppdrag" className="text-gray-300 hover:text-white text-sm mb-4 inline-block">{t("orders.fieldNew.backToMyWorkOrders")}</Link>
        <h1 className="text-2xl font-bold">{t("orders.fieldNew.title")}</h1>
        <p className="text-gray-400 text-sm mt-1">{t("orders.fieldNew.subtitle")}</p>
      </div>

      <div className="px-4 max-w-md mx-auto mt-6 space-y-4">
        <ErrorBanner message={error} />

        <form
          id="field-create-work-order"
          action="/api/technician/workorders/create"
          method="POST"
          className="bg-white p-6 rounded-2xl shadow-sm border space-y-4"
        >
          <FormValuePersistence
            formId="field-create-work-order"
            storageKey="fsm:field-create-work-order"
            restore={Boolean(error)}
          />

          <div>
            <label htmlFor="field-title" className="block text-sm font-semibold text-gray-700 mb-1">{t("orders.fieldNew.titleLabel")}</label>
            <input id="field-title" type="text" name="title" placeholder={t("orders.fieldNew.titlePlaceholder")} required className="w-full border p-3 rounded-xl text-sm text-gray-800" />
          </div>

          {/* Søk i hele kunderegisteret på serveren – ikke bare de 100 første. */}
          <CustomerSelect
            customers={customers}
            optional={true}
            persistenceKey="fsm:field-create-work-order"
            restoreSelection={Boolean(error)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="field-scheduled-for" className="block text-sm font-semibold text-gray-700 mb-1">{t("orders.fieldNew.executionDate")}</label>
              <input id="field-scheduled-for" type="date" name="scheduledFor" defaultValue={new Date().toISOString().split('T')[0]} required className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50" />
            </div>
            <div>
              <label htmlFor="field-scheduled-to" className="block text-sm font-semibold text-gray-700 mb-1">{t("orders.fieldNew.endDate")}</label>
              <input id="field-scheduled-to" type="date" name="scheduledTo" aria-describedby="field-scheduled-to-hint" className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50" />
              <p id="field-scheduled-to-hint" className="text-[11px] text-gray-500 mt-1">{t("orders.fieldNew.endDateHint")}</p>
            </div>
          </div>

          <div>
            <label htmlFor="field-template" className="block text-sm font-semibold text-gray-700 mb-1">{t("orders.fieldNew.templateLabel")}</label>
            <select id="field-template" name="templateId" className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50">
              <option value="">{t("orders.fieldNew.noTemplate")}</option>
              {serviceTemplates.length > 0 && (
                <optgroup label={t("orders.templateGroups.service")}>
                  {serviceTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.title}</option>
                  ))}
                </optgroup>
              )}
              {hmsTemplates.length > 0 && (
                <optgroup label={`🛡️ ${t("orders.templateGroups.hms")}`}>
                  {hmsTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.title}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <fieldset>
            <legend className="block text-sm font-semibold text-gray-700 mb-1">{t("orders.fieldNew.tags")}</legend>
            <TagSelector allTags={tags} />
          </fieldset>

          <div>
            <label htmlFor="field-description" className="block text-sm font-semibold text-gray-700 mb-1">{t("orders.fieldNew.description")}</label>
            <MarkdownEditor id="field-description" name="description" rows={3} placeholder={t("orders.fieldNew.descriptionPlaceholder")} />
          </div>

          <SubmitButton
            pendingLabel={t("orders.fieldNew.submitting")}
            className="w-full bg-[var(--primary-color)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm"
          >
            {t("orders.fieldNew.submit")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
