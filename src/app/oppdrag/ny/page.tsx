import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import CustomerSelect from "./CustomerSelect";
import ErrorBanner from "@/components/ErrorBanner";
import IsoDateInput from "@/components/IsoDateInput";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import FormValuePersistence from "@/components/FormValuePersistence";
import MarkdownEditor from "@/components/MarkdownEditor";
import SubmitButton from "@/components/SubmitButton";
import TagSelector from "@/components/TagSelector";
import { controlClassName } from "@/components/ui/controlStyles";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments, getDefaultDepartmentId } from "@/lib/departments";
import { staffForDepartment, staffWhere } from "@/lib/access";
import {
  HMS_TYPE_MESSAGE_KEYS,
  splitTemplatesByCategory,
} from "@/lib/template-categories";
import { createWorkOrder } from "./actions";
import { todayInOslo } from "@/lib/dates";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const HINT = "mt-1 text-xs leading-5 text-[var(--muted,#62685f)]";
const SECTION_TITLE =
  "flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const INK_LINK =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

/**
 * Fjerner ledende symbol-ikoner fra oversettelser som ennå har emoji i
 * katalogen. Flaten bruker monokrome <Icon>-ikoner i stedet.
 */
function withoutLeadingSymbol(value: string) {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

export default async function AdminCreateWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.create")) redirect("/");

  const { error } = await searchParams;
  const t = await getTranslations("common");
  const isAdmin = user.role === "ADMIN";
  const departments = await getActiveDepartments();
  const defaultDepartmentId = await getDefaultDepartmentId();
  // Administrator kan opprette i alle avdelinger. Alle andre må selv være
  // knyttet til en avdeling – vi faller ikke tilbake til standardavdelingen.
  const ownDepartmentId = isAdmin
    ? (user.departmentId ?? defaultDepartmentId)
    : user.departmentId;

  // Startutvalg for kundevelgeren. Resten av registeret søkes det i på
  // serveren, så listen er ikke begrenset til de første kundene.
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    take: 20,
    select: { id: true, name: true, city: true, customerNumber: true },
  });
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const { service: serviceTemplates, hms: hmsTemplates } =
    splitTemplatesByCategory(templates);
  const technicians = await prisma.user.findMany({
    where: isAdmin ? staffWhere() : staffForDepartment(ownDepartmentId),
    include: { department: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  const errorMessages: Record<string, string> = {
    avdeling: t("orders.errors.department"),
    "ugyldig-data": t("orders.errors.invalidData"),
    "ugyldig-sluttdato": t("orders.errors.invalidEndDate"),
    "sluttdato-for-startdato": t("orders.errors.endBeforeStart"),
    "duplikat-ordrenummer": t("orders.errors.duplicateOrderNumber"),
    "workorder-locked": t("orders.errors.workOrderLocked"),
    "ikke-tilgang": t("orders.errors.generic"),
    ukjent: t("orders.errors.generic"),
  };
  const errorMessage = error
    ? withoutLeadingSymbol(errorMessages[error] ?? t("orders.errors.generic"))
    : undefined;
  const dateError =
    error === "sluttdato-for-startdato"
      ? t("orders.errors.endBeforeStart")
      : error === "ugyldig-sluttdato"
        ? t("orders.errors.invalidEndDate")
        : undefined;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto min-w-0 max-w-2xl space-y-4">
        <PageHeader
          title={withoutLeadingSymbol(t("orders.new.title"))}
          subtitle={t("orders.new.subtitle")}
          icon={<Icon name="plus" className="h-5 w-5" />}
          actions={
            <Link href="/kalender" className={INK_LINK}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {withoutLeadingSymbol(t("orders.new.backToCalendar"))}
            </Link>
          }
        />

        <ErrorBanner message={errorMessage} />

        <form
          id="office-create-work-order"
          action={createWorkOrder}
          className="space-y-4"
        >
          <FormValuePersistence
            formId="office-create-work-order"
            storageKey="fsm:office-create-work-order"
            restore={Boolean(error)}
          />

          {/* INNHOLD */}
          <section className={CARD} aria-labelledby="office-new-content">
            <h2 id="office-new-content" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.content")}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="office-new-title" className={LABEL}>
                  {t("orders.new.titleLabel")}{" "}
                  <span className="text-[var(--risk-text,#b42318)]">*</span>
                </label>
                <input
                  id="office-new-title"
                  type="text"
                  name="title"
                  placeholder={t("orders.new.titlePlaceholder")}
                  required
                  className={controlClassName("min-h-11")}
                />
              </div>

              <div>
                <label htmlFor="office-new-order-number" className={LABEL}>
                  {t("orders.new.orderNumber")}
                </label>
                <input
                  id="office-new-order-number"
                  type="text"
                  name="orderNumber"
                  placeholder={t("orders.new.orderNumberPlaceholder")}
                  maxLength={200}
                  className={controlClassName("min-h-11")}
                />
              </div>

              <div>
                <label htmlFor="office-new-description" className={LABEL}>
                  {t("orders.new.description")}
                </label>
                <MarkdownEditor
                  id="office-new-description"
                  name="description"
                  rows={3}
                  placeholder={t("orders.new.descriptionPlaceholder")}
                />
              </div>
            </div>
          </section>

          {/* KUNDE OG STED */}
          <section className={CARD} aria-labelledby="office-new-customer">
            <h2 id="office-new-customer" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.customerPlace")}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="office-new-department" className={LABEL}>
                  {t("orders.new.department")}
                </label>
                {isAdmin ? (
                  <select
                    id="office-new-department"
                    name="departmentId"
                    aria-describedby="office-new-department-hint"
                    defaultValue={ownDepartmentId ?? ""}
                    required
                    className={controlClassName("min-h-11")}
                  >
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.isDefault
                          ? t("orders.new.departmentDefault", { name: department.name })
                          : department.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex min-h-11 w-full items-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]">
                    {user.department?.name || departments.find((d) => d.id === ownDepartmentId)?.name || t("orders.new.noDepartment")}
                  </div>
                )}
                <p id="office-new-department-hint" className={HINT}>
                  {t("orders.new.departmentHint")}
                </p>
              </div>

              <CustomerSelect
                customers={customers}
                optional={true}
                persistenceKey="fsm:office-create-work-order"
                restoreSelection={Boolean(error)}
              />

              <div
                className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                aria-describedby="office-new-location-hint"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label htmlFor="office-new-address" className={LABEL}>
                      {t("orders.new.addressLabel")}
                    </label>
                    <input
                      id="office-new-address"
                      name="address"
                      maxLength={200}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div>
                    <label htmlFor="office-new-postal-code" className={LABEL}>
                      {t("orders.new.postalCodeLabel")}
                    </label>
                    <input
                      id="office-new-postal-code"
                      name="postalCode"
                      maxLength={20}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="office-new-city" className={LABEL}>
                      {t("orders.new.cityLabel")}
                    </label>
                    <input
                      id="office-new-city"
                      name="city"
                      maxLength={100}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                </div>
                <p id="office-new-location-hint" className={HINT}>
                  {t("orders.new.locationHint")}
                </p>
              </div>
            </div>
          </section>

          {/* TID */}
          <section className={CARD} aria-labelledby="office-new-time">
            <h2 id="office-new-time" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.time")}
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="office-new-scheduled-for" className={LABEL}>
                  {t("orders.new.executionDate")}{" "}
                  <span className="text-[var(--risk-text,#b42318)]">*</span>
                </label>
                <IsoDateInput
                  id="office-new-scheduled-for"
                  name="scheduledFor"
                  defaultValue={todayInOslo()}
                  required
                  className={controlClassName("min-h-11")}
                />
              </div>
              <div>
                <label htmlFor="office-new-scheduled-to" className={LABEL}>
                  {t("orders.new.endDate")}
                </label>
                <IsoDateInput
                  id="office-new-scheduled-to"
                  name="scheduledTo"
                  aria-describedby={
                    dateError
                      ? "office-new-scheduled-to-hint office-new-scheduled-to-error"
                      : "office-new-scheduled-to-hint"
                  }
                  aria-invalid={dateError ? true : undefined}
                  className={controlClassName("min-h-11")}
                />
                <p id="office-new-scheduled-to-hint" className={HINT}>
                  {t("orders.new.endDateHint")}
                </p>
                {dateError && (
                  <p
                    id="office-new-scheduled-to-error"
                    role="alert"
                    className="mt-1 text-xs font-bold text-[var(--risk-text,#b42318)]"
                  >
                    {dateError}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* RESSURSER */}
          <section className={CARD} aria-labelledby="office-new-resources">
            <h2 id="office-new-resources" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.resources")}
            </h2>

            <div className="mt-3 space-y-4">
              <div role="group" aria-labelledby="office-new-technicians">
                <p
                  id="office-new-technicians"
                  className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
                >
                  {t("orders.new.assignTechnicians")}
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2">
                  {technicians.map((tech) => (
                    <label
                      key={tech.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-1.5 transition hover:bg-[var(--surface,#fffdf8)]"
                    >
                      <input
                        type="checkbox"
                        name="technicianIds"
                        value={tech.id}
                        className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                      />
                      <span className="min-w-0 break-words text-sm font-medium text-[var(--ink,#101310)]">
                        {tech.name}
                        {tech.department ? ` (${tech.department.name})` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div
                role="group"
                aria-labelledby="office-new-templates-title"
                aria-describedby="office-new-templates-hint"
              >
                <p
                  id="office-new-templates-title"
                  className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
                >
                  {t("orders.new.templates")}
                </p>
                <p id="office-new-templates-hint" className={HINT}>
                  {t("orders.new.templatesHint")}
                </p>
                <div className="mt-2 max-h-72 min-w-0 space-y-3 overflow-y-auto rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
                  {templates.length === 0 && (
                    <p className="p-2 text-sm text-[var(--muted,#62685f)]">
                      {t("orders.new.noTemplates")}
                    </p>
                  )}

                  {serviceTemplates.length > 0 && (
                    <div className="min-w-0 space-y-1">
                      <p className="flex items-center gap-1.5 px-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]">
                        <Icon name="clipboard" className="h-3.5 w-3.5 shrink-0" />
                        {t("orders.templateGroups.service")}
                      </p>
                      {serviceTemplates.map((template) => (
                        <label
                          key={template.id}
                          className="flex min-h-11 min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-[10px] p-2 transition hover:bg-[var(--surface,#fffdf8)]"
                        >
                          <input
                            type="checkbox"
                            name="templateIds"
                            value={template.id}
                            className="h-4 w-4 shrink-0 rounded border-[var(--line,#dedcd1)] accent-[var(--ink,#101310)]"
                          />
                          <span className="min-w-0 break-words text-sm font-bold text-[var(--ink,#101310)]">
                            {template.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {hmsTemplates.length > 0 && (
                    <div className="min-w-0 space-y-1 border-t border-[var(--line,#dedcd1)] pt-2">
                      <p className="flex items-center gap-1.5 px-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]">
                        <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
                        {t("orders.templateGroups.hms")}
                      </p>
                      {hmsTemplates.map((template) => (
                        <label
                          key={template.id}
                          className="flex min-h-11 min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-[10px] p-2 transition hover:bg-[var(--surface,#fffdf8)]"
                        >
                          <input
                            type="checkbox"
                            name="templateIds"
                            value={template.id}
                            className="h-4 w-4 shrink-0 rounded border-[var(--line,#dedcd1)] accent-[var(--ink,#101310)]"
                          />
                          <span className="min-w-0 break-words text-sm font-bold text-[var(--ink,#101310)]">
                            {template.title}
                          </span>
                          <span className="max-w-full break-words rounded-full border border-[var(--ink,#101310)] bg-[var(--surface,#fffdf8)] px-2 py-0.5 text-xs font-black uppercase text-[var(--ink,#101310)]">
                            {template.hmsType
                              ? t(HMS_TYPE_MESSAGE_KEYS[template.hmsType])
                              : t("orders.templateGroups.hmsBadge")}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div aria-describedby="office-new-tags-hint">
                <p className="mb-1 text-sm font-bold text-[var(--ink,#101310)]">
                  {t("orders.new.tags")}
                </p>
                <TagSelector allTags={tags} />
                <p id="office-new-tags-hint" className={HINT}>
                  {t("orders.new.tagsHint")}
                </p>
              </div>
            </div>
          </section>

          <SubmitButton
            pendingLabel={t("orders.new.submitting")}
            className="signal-button w-full"
          >
            {t("orders.new.submit")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
