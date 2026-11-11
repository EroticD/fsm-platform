import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import CustomerSelect from "./CustomerSelect";
import ErrorBanner from "@/components/ErrorBanner";
import IsoDateInput from "@/components/IsoDateInput";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import ValidatedForm from "@/components/forms/ValidatedForm";
import FormValuePersistence from "@/components/FormValuePersistence";
import MarkdownEditor from "@/components/MarkdownEditor";
import SubmitButton from "@/components/SubmitButton";
import TagSelector from "@/components/TagSelector";
import SectionCard from "@/components/SectionCard";
import { brandInset } from "@/components/ui/brandStyles";
import { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
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
import { getCustomerSiteOptions } from "@/server/customer-sites";
import { todayInOslo } from "@/lib/dates";

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
  searchParams: Promise<{ error?: string; customerId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.create")) redirect("/");

  const { error, customerId: requestedCustomerId } = await searchParams;
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

  // Kommer man fra et kundekort med ?customerId=..., skal kunden være valgt
  // allerede. Validerer at kunden finnes og ikke er slettet; ukjente id-er
  // ignoreres stille, slik at en gammel lenke ikke blokkerer skjemaet.
  const selectedCustomerId = requestedCustomerId?.trim() || "";
  const selectedCustomer = selectedCustomerId
    ? await prisma.customer.findFirst({
        where: { id: selectedCustomerId, deletedAt: null },
        select: { id: true, name: true, city: true, customerNumber: true },
      })
    : null;
  const selectedCustomerContacts = selectedCustomer
    ? await prisma.contact.findMany({
        where: { customerId: selectedCustomer.id },
        orderBy: { name: "asc" },
        take: 100,
        select: { id: true, name: true, role: true, customerId: true },
      })
    : [];
  const customerOptions = selectedCustomer
    ? [
        selectedCustomer,
        ...customers.filter((customer) => customer.id !== selectedCustomer.id),
      ]
    : customers;
  // Steder lastes bare for den valgte kunden. Når kunden endres i skjemaet,
  // henter klienten den nye kundens steder fra et serveravgrenset endepunkt.
  const siteOptionsResult = selectedCustomer
    ? await getCustomerSiteOptions(user, selectedCustomer.id, { limit: 200 })
    : null;
  const sites = siteOptionsResult?.ok ? siteOptionsResult.data.sites : [];
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
  const skills = await prisma.skill.findMany({
    orderBy: [{ category: "asc" }, { label: "asc" }],
    select: { id: true, key: true, label: true, category: true },
    take: 500,
  });

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
  const orderNumberError =
    error === "duplikat-ordrenummer"
      ? t("orders.errors.duplicateOrderNumber")
      : undefined;

  return (
    <PageShell size="narrow">
      <PageHeader
        title={withoutLeadingSymbol(t("orders.new.title"))}
        subtitle={t("orders.new.subtitle")}
        icon={<Icon name="plus" className="h-5 w-5" />}
        actions={
          <Link href="/kalender" className={buttonClassName({ variant: "secondary" })}>
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {withoutLeadingSymbol(t("orders.new.backToCalendar"))}
          </Link>
        }
      />

      <ErrorBanner message={errorMessage} />

      <ValidatedForm
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
        <SectionCard title={t("orders.formSections.content")}>

          <div className="mt-3 space-y-3">
            <Field
              id="office-new-title"
              label={t("orders.new.titleLabel")}
              required
            >
              <Input
                id="office-new-title"
                type="text"
                name="title"
                placeholder={t("orders.new.titlePlaceholder")}
                required
              />
            </Field>

            <Field
              id="office-new-order-number"
              label={t("orders.new.orderNumber")}
              error={orderNumberError}
            >
              <Input
                id="office-new-order-number"
                type="text"
                name="orderNumber"
                placeholder={t("orders.new.orderNumberPlaceholder")}
                maxLength={200}
                aria-invalid={orderNumberError ? true : undefined}
              />
            </Field>

            <Field
              id="office-new-description"
              label={t("orders.new.description")}
            >
              <MarkdownEditor
                id="office-new-description"
                name="description"
                rows={3}
                placeholder={t("orders.new.descriptionPlaceholder")}
              />
            </Field>
          </div>
        </SectionCard>

        {/* KUNDE OG STED */}
        <SectionCard title={t("orders.formSections.customerPlace")}>

          <div className="mt-3 space-y-3">
            <Field
              id="office-new-department"
              label={t("orders.new.department")}
              hint={t("orders.new.departmentHint")}
            >
              {isAdmin ? (
                <Select
                  id="office-new-department"
                  name="departmentId"
                  defaultValue={ownDepartmentId ?? ""}
                  required
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.isDefault
                        ? t("orders.new.departmentDefault", { name: department.name })
                        : department.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className={`${brandInset} flex min-h-11 w-full items-center px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]`}>
                  {user.department?.name || departments.find((d) => d.id === ownDepartmentId)?.name || t("orders.new.noDepartment")}
                </div>
              )}
            </Field>

            <CustomerSelect
              customers={customerOptions}
              selectedCustomer={selectedCustomer}
              contacts={selectedCustomerContacts}
              optional={true}
              persistenceKey="fsm:office-create-work-order"
              restoreSelection={Boolean(error)}
              siteSelector={{
                initialCustomerId: selectedCustomer?.id ?? null,
                initialSites: sites,
                id: "office-new-site",
                label: t("orders.new.siteLabel"),
                noSiteLabel: t("orders.new.noSite"),
                hint: t("orders.new.siteHint"),
              }}
            />

            <div className={`${brandInset} p-3`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field
                  id="office-new-address"
                  label={t("orders.new.addressLabel")}
                  className="sm:col-span-3"
                >
                  <Input
                    id="office-new-address"
                    name="address"
                    maxLength={200}
                  />
                </Field>
                <Field
                  id="office-new-postal-code"
                  label={t("orders.new.postalCodeLabel")}
                >
                  <Input
                    id="office-new-postal-code"
                    name="postalCode"
                    maxLength={20}
                  />
                </Field>
                <Field
                  id="office-new-city"
                  label={t("orders.new.cityLabel")}
                  className="sm:col-span-2"
                >
                  <Input
                    id="office-new-city"
                    name="city"
                    maxLength={100}
                  />
                </Field>
              </div>
              <p className="type-meta mt-2 text-[var(--muted,#62685f)]">
                {t("orders.new.locationHint")}
              </p>
            </div>
          </div>
        </SectionCard>

        {/* TID */}
        <SectionCard title={t("orders.formSections.time")}>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id="office-new-scheduled-for"
              label={t("orders.new.executionDate")}
              required
            >
              <IsoDateInput
                id="office-new-scheduled-for"
                name="scheduledFor"
                defaultValue={todayInOslo()}
                required
                className={controlClassName("min-h-11")}
              />
            </Field>
            <Field
              id="office-new-scheduled-to"
              label={t("orders.new.endDate")}
              hint={t("orders.new.endDateHint")}
              error={dateError}
            >
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
            </Field>
          </div>
          <p className={`${brandInset} mt-3 px-3 py-2 text-xs font-medium leading-5 text-[var(--muted,#62685f)]`}>
            {t("orders.new.workdayHint")}
          </p>
        </SectionCard>

        {/* RESSURSER */}
        <SectionCard title={t("orders.formSections.resources")}>

          <div className="mt-3 space-y-4">
            <div role="group" aria-labelledby="office-new-technicians">
              <p
                id="office-new-technicians"
                className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
              >
                {t("orders.new.assignTechnicians")}
              </p>
              <div className={`max-h-48 space-y-1 overflow-y-auto ${brandInset} p-2`}>
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
              aria-labelledby="office-new-skills-title"
              aria-describedby="office-new-skills-hint"
            >
              <p
                id="office-new-skills-title"
                className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
              >
                {t("orders.skills.title")}
              </p>
              <p id="office-new-skills-hint" className="type-meta mt-1 text-[var(--muted,#62685f)]">
                {t("orders.skills.hint")}
              </p>
              <div className={`mt-2 max-h-64 space-y-1 overflow-y-auto ${brandInset} p-2`}>
                {skills.length === 0 ? (
                  <p className="p-2 text-sm text-[var(--muted,#62685f)]">
                    {t("orders.skills.empty")}
                  </p>
                ) : (
                  skills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] px-2 py-1.5 hover:bg-[var(--surface,#fffdf8)]"
                    >
                      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          name="skillIds"
                          value={skill.id}
                          className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                        />
                        <span className="min-w-0 break-words text-sm font-medium text-[var(--ink,#101310)]">
                          {skill.label}
                          {skill.category ? ` · ${skill.category}` : ""}
                        </span>
                      </label>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-bold text-[var(--muted,#62685f)]">
                        <input
                          type="checkbox"
                          name="mandatorySkillIds"
                          value={skill.id}
                          className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                        />
                        {t("orders.skills.mandatory")}
                      </label>
                    </div>
                  ))
                )}
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
              <p id="office-new-templates-hint" className="type-meta mt-1 text-[var(--muted,#62685f)]">
                {t("orders.new.templatesHint")}
              </p>
              <div className={`mt-2 max-h-72 min-w-0 space-y-3 overflow-y-auto ${brandInset} p-3`}>
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
              <p className="type-eyebrow mb-1 text-[var(--ink,#101310)]">
                {t("orders.new.tags")}
              </p>
              <TagSelector allTags={tags} />
              <p id="office-new-tags-hint" className="type-meta mt-1 text-[var(--muted,#62685f)]">
                {t("orders.new.tagsHint")}
              </p>
            </div>
          </div>
        </SectionCard>

        <SubmitButton
          pendingLabel={t("orders.new.submitting")}
          className={`${buttonClassName({ variant: "primary" })} w-full`}
        >
          {t("orders.new.submit")}
        </SubmitButton>
      </ValidatedForm>
    </PageShell>
  );
}
