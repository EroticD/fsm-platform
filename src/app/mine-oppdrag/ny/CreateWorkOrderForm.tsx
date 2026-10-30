"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import CustomerSelect from "@/app/oppdrag/ny/CustomerSelect";
import ErrorBanner from "@/components/ErrorBanner";
import IsoDateInput from "@/components/IsoDateInput";
import FormValuePersistence from "@/components/FormValuePersistence";
import Icon from "@/components/icons";
import MarkdownEditor from "@/components/MarkdownEditor";
import SubmitButton from "@/components/SubmitButton";
import TagSelector from "@/components/TagSelector";
import { controlClassName } from "@/components/ui/controlStyles";
import { splitTemplatesByCategory } from "@/lib/template-categories";
import { todayInOslo } from "@/lib/dates";

const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const HINT = "mt-1 text-xs leading-5 text-[var(--muted,#62685f)]";
const SECTION_TITLE =
  "flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const SECTION =
  "rounded-xl border border-[var(--line,#dedcd1)] bg-white/55 p-3 sm:p-4";

/**
 * Fjerner ledende symbol-ikoner fra oversettelser som ennå har emoji i
 * katalogen. Feltflaten bruker monokrome <Icon>-ikoner i stedet.
 */
function withoutLeadingSymbol(value: string) {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

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
  const errorMessage = error ? withoutLeadingSymbol(error) : undefined;

  return (
    <div className="field-app min-h-screen p-4 pb-28 sm:p-6 sm:pb-12">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="field-hero p-5 sm:p-6">
          <Link
            href="/mine-oppdrag"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-paper/70 transition hover:text-paper"
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {withoutLeadingSymbol(t("orders.fieldNew.backToMyWorkOrders"))}
          </Link>
          <p className="mt-4 text-[11px] font-black uppercase tracking-[0.18em] text-signal">
            {t("workOrder")}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-paper">
            {withoutLeadingSymbol(t("orders.fieldNew.title"))}
          </h1>
          <p className="mt-1 text-sm font-medium text-paper/60">
            {t("orders.fieldNew.subtitle")}
          </p>
        </header>

        <ErrorBanner message={errorMessage} />

        <form
          id="field-create-work-order"
          action="/api/technician/workorders/create"
          method="POST"
          className="field-sheet space-y-4 p-4 sm:p-6"
        >
          <FormValuePersistence
            formId="field-create-work-order"
            storageKey="fsm:field-create-work-order"
            restore={Boolean(error)}
          />

          {/* INNHOLD */}
          <section className={SECTION} aria-labelledby="field-new-content">
            <h2 id="field-new-content" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.content")}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="field-title" className={LABEL}>
                  {t("orders.fieldNew.titleLabel")}{" "}
                  <span className="text-[var(--risk-text,#b42318)]">*</span>
                </label>
                <input
                  id="field-title"
                  type="text"
                  name="title"
                  placeholder={t("orders.fieldNew.titlePlaceholder")}
                  required
                  className={controlClassName("min-h-11")}
                />
              </div>

              <div>
                <label htmlFor="field-description" className={LABEL}>
                  {t("orders.fieldNew.description")}
                </label>
                <MarkdownEditor
                  id="field-description"
                  name="description"
                  rows={3}
                  placeholder={t("orders.fieldNew.descriptionPlaceholder")}
                />
              </div>
            </div>
          </section>

          {/* KUNDE OG STED */}
          <section className={SECTION} aria-labelledby="field-new-customer">
            <h2 id="field-new-customer" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.customerPlace")}
            </h2>

            <div className="mt-3 space-y-3">
              {/* Søk i hele kunderegisteret på serveren – ikke bare de 100 første. */}
              <CustomerSelect
                customers={customers}
                optional={true}
                persistenceKey="fsm:field-create-work-order"
                restoreSelection={Boolean(error)}
              />

              <div
                className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                aria-describedby="field-new-location-hint"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label htmlFor="field-new-address" className={LABEL}>
                      {t("orders.new.addressLabel")}
                    </label>
                    <input
                      id="field-new-address"
                      name="address"
                      maxLength={200}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div>
                    <label htmlFor="field-new-postal-code" className={LABEL}>
                      {t("orders.new.postalCodeLabel")}
                    </label>
                    <input
                      id="field-new-postal-code"
                      name="postalCode"
                      maxLength={20}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="field-new-city" className={LABEL}>
                      {t("orders.new.cityLabel")}
                    </label>
                    <input
                      id="field-new-city"
                      name="city"
                      maxLength={100}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                </div>
                <p id="field-new-location-hint" className={HINT}>
                  {t("orders.new.locationHint")}
                </p>
              </div>
            </div>
          </section>

          {/* TID */}
          <section className={SECTION} aria-labelledby="field-new-time">
            <h2 id="field-new-time" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.time")}
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="field-scheduled-for" className={LABEL}>
                  {t("orders.fieldNew.executionDate")}{" "}
                  <span className="text-[var(--risk-text,#b42318)]">*</span>
                </label>
                <IsoDateInput
                  id="field-scheduled-for"
                  name="scheduledFor"
                  defaultValue={todayInOslo()}
                  required
                  className={controlClassName("min-h-11")}
                />
              </div>
              <div>
                <label htmlFor="field-scheduled-to" className={LABEL}>
                  {t("orders.fieldNew.endDate")}
                </label>
                <IsoDateInput
                  id="field-scheduled-to"
                  name="scheduledTo"
                  aria-describedby="field-scheduled-to-hint"
                  className={controlClassName("min-h-11")}
                />
                <p id="field-scheduled-to-hint" className={HINT}>
                  {t("orders.fieldNew.endDateHint")}
                </p>
              </div>
            </div>
          </section>

          {/* RESSURSER */}
          <section className={SECTION} aria-labelledby="field-new-resources">
            <h2 id="field-new-resources" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.resources")}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="field-template" className={LABEL}>
                  {t("orders.fieldNew.templateLabel")}
                </label>
                <select
                  id="field-template"
                  name="templateId"
                  className={controlClassName("min-h-11")}
                >
                  <option value="">{t("orders.fieldNew.noTemplate")}</option>
                  {serviceTemplates.length > 0 && (
                    <optgroup label={t("orders.templateGroups.service")}>
                      {serviceTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.title}</option>
                      ))}
                    </optgroup>
                  )}
                  {hmsTemplates.length > 0 && (
                    <optgroup label={t("orders.templateGroups.hms")}>
                      {hmsTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.title}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <p className="mb-1 text-sm font-bold text-[var(--ink,#101310)]">
                  {t("orders.fieldNew.tags")}
                </p>
                <TagSelector allTags={tags} />
              </div>
            </div>
          </section>

          <SubmitButton
            pendingLabel={t("orders.fieldNew.submitting")}
            className="field-cta w-full"
          >
            {t("orders.fieldNew.submit")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
