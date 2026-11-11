import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import IsoDateInput from "@/components/IsoDateInput";
import FormValuePersistence from "@/components/FormValuePersistence";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import ValidatedForm from "@/components/forms/ValidatedForm";
import SubmitButton from "@/components/SubmitButton";
import SectionCard from "@/components/SectionCard";
import { brandInset } from "@/components/ui/brandStyles";
import { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { controlClassName } from "@/components/ui/controlStyles";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments } from "@/lib/departments";
import { staffForDepartment, staffWhere, workOrderScope } from "@/lib/access";
import CustomerSelect from "../../ny/CustomerSelect";
import { getCustomerSiteOptions } from "@/server/customer-sites";
import { updateWorkOrder } from "./actions";

/**
 * Fjerner ledende symbol-ikoner fra oversettelser som ennå har emoji i
 * katalogen. Flaten bruker monokrome <Icon>-ikoner i stedet.
 */
function withoutLeadingSymbol(value: string) {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

export default async function EditWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;
  const { error } = await searchParams;
  const t = await getTranslations("common");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.edit")) redirect("/");

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    include: {
      department: true,
      customer: true,
      technicians: { include: { department: true } },
      templates: true,
      tags: true,
      skillRequirements: { include: { skill: true } }
    }
  });

  if (!workOrder) {
    return (
      <PageShell size="narrow">
        <EmptyState
          icon={<Icon name="alert" className="h-6 w-6" />}
          title={t("orders.edit.notFoundTitle")}
          action={
            <Link
              href="/"
              className={buttonClassName({ variant: "primary" })}
            >
              {withoutLeadingSymbol(t("orders.edit.backToDashboard"))}
            </Link>
          }
        />
      </PageShell>
    );
  }

  const isAdmin = user.role === "ADMIN";
  const departments = isAdmin ? await getActiveDepartments() : [];

  // Startutvalg for det søkbare kundevalget. Den valgte kunden sendes
  // eksplisitt, så et lagre uten endringer aldri nullstiller den.
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, city: true, customerNumber: true },
  });
  const technicians = await prisma.user.findMany({
    where: isAdmin ? staffWhere() : staffForDepartment(workOrder.departmentId),
    include: { department: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  const skills = await prisma.skill.findMany({
    orderBy: [{ category: "asc" }, { label: "asc" }],
    select: { id: true, key: true, label: true, category: true },
    take: 500,
  });
  const selectedSkillIds = new Set(
    (workOrder.skillRequirements ?? []).map((entry) => entry.skillId),
  );
  const mandatorySkillIds = new Set(
    (workOrder.skillRequirements ?? [])
      .filter((entry) => entry.mandatory)
      .map((entry) => entry.skillId),
  );
  // Steder lastes bare for oppdragets kunde. Bytter man kunde i skjemaet,
  // henter klienten den nye kundens steder fra et serveravgrenset endepunkt;
  // gamle stedsvalg kan derfor aldri peke på en annen kunde.
  const siteOptionsResult = workOrder.customerId
    ? await getCustomerSiteOptions(user, workOrder.customerId, { limit: 200 })
    : null;
  const sites = siteOptionsResult?.ok ? siteOptionsResult.data.sites : [];
  // Kontaktene til den valgte kunden, slik at valgt kontakt vises umiddelbart
  // og overlever en feil i det etterfølgende kontakt-søket.
  const selectedCustomerContacts = workOrder.customerId
    ? await prisma.contact.findMany({
        where: {
          customerId: workOrder.customerId,
          customer: { deletedAt: null },
        },
        orderBy: { name: "asc" },
        take: 200,
        select: { id: true, name: true, role: true, customerId: true },
      })
    : [];

  const technicianOptions = [...technicians];
  for (const assigned of workOrder.technicians) {
    if (!technicianOptions.some((technician) => technician.id === assigned.id)) {
      technicianOptions.push(assigned);
    }
  }

  const errorMessages: Record<string, string> = {
    "ugyldig-data": t("orders.errors.invalidData"),
    "ugyldig-sluttdato": t("orders.errors.invalidEndDate"),
    "sluttdato-for-startdato": t("orders.errors.endBeforeStart"),
    "duplikat-ordrenummer": t("orders.errors.duplicateOrderNumber"),
    avdeling: t("orders.errors.department"),
    "workorder-locked": t("orders.errors.workOrderLocked"),
    "kunde-last": t("orders.errors.customerChangeBlocked"),
    "ikke-tilgang": t("orders.errors.generic"),
    ukjent: t("orders.errors.generic"),
  };
  const errorMessage = error
    ? withoutLeadingSymbol(errorMessages[error] ?? t("orders.errors.saveFailed"))
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
        title={withoutLeadingSymbol(t("orders.edit.title"))}
        subtitle={t("orders.edit.subtitle")}
        icon={<Icon name="edit" className="h-5 w-5" />}
        actions={
          <Link href={`/oppdrag/${workOrderId}`} className={buttonClassName({ variant: "secondary" })}>
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {withoutLeadingSymbol(t("orders.edit.cancel"))}
          </Link>
        }
      />

      <ErrorBanner message={errorMessage} />

      <ValidatedForm
        id="office-edit-work-order"
        action={updateWorkOrder}
        className="space-y-4"
      >
        <FormValuePersistence
          formId="office-edit-work-order"
          storageKey={`fsm:office-edit-work-order:${workOrderId}`}
          restore={Boolean(error)}
        />
        <input type="hidden" name="workOrderId" value={workOrderId} />

        {/* INNHOLD */}
        <SectionCard title={t("orders.formSections.content")}>

          <div className="mt-3 space-y-3">
            <Field
              id="office-edit-title"
              label={t("orders.edit.titleLabel")}
              required
            >
              <Input
                id="office-edit-title"
                type="text"
                name="title"
                defaultValue={workOrder.title}
                required
              />
            </Field>

            <Field
              id="office-edit-order-number"
              label={t("orders.edit.orderNumber")}
              error={orderNumberError}
            >
              <Input
                id="office-edit-order-number"
                type="text"
                name="orderNumber"
                defaultValue={workOrder.orderNumber ?? ""}
                maxLength={200}
                aria-invalid={orderNumberError ? true : undefined}
              />
            </Field>

            <Field
              id="office-edit-description"
              label={t("orders.edit.description")}
            >
              <MarkdownEditor
                id="office-edit-description"
                name="description"
                rows={4}
                defaultValue={workOrder.description || ""}
                placeholder={t("orders.edit.descriptionPlaceholder")}
              />
            </Field>
          </div>
        </SectionCard>

        {/* KUNDE OG STED */}
        <SectionCard title={t("orders.formSections.customerPlace")}>

          <div className="mt-3 space-y-3">
            <Field
              id="office-edit-department"
              label={t("orders.edit.department")}
              hint={t("orders.edit.departmentHint")}
            >
              {isAdmin ? (
                <Select
                  id="office-edit-department"
                  name="departmentId"
                  defaultValue={workOrder.departmentId}
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className={`${brandInset} flex min-h-11 w-full items-center px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]`}>
                  {workOrder.department.name}
                </div>
              )}
            </Field>

            <div>
              <CustomerSelect
                customers={customers}
                selectedCustomer={
                  workOrder.customer
                    ? {
                        id: workOrder.customer.id,
                        name: workOrder.customer.name,
                        city: workOrder.customer.city,
                        customerNumber: workOrder.customer.customerNumber,
                      }
                    : null
                }
                selectedContactId={workOrder.contactId}
                contacts={selectedCustomerContacts}
                siteSelector={{
                  initialCustomerId: workOrder.customerId,
                  initialSites: sites,
                  initialSiteId: workOrder.siteId,
                  id: "office-edit-site",
                  label: t("orders.edit.siteLabel"),
                  noSiteLabel: t("orders.edit.noSite"),
                  hint: t("orders.edit.siteHint"),
                }}
              />
              <p className="type-meta mt-1 text-[var(--muted,#62685f)]">
                {t("orders.edit.contactHint")}
              </p>
            </div>

            <div className={`${brandInset} p-3`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field
                  id="office-edit-address"
                  label={t("orders.edit.addressLabel")}
                  className="sm:col-span-3"
                >
                  <Input
                    id="office-edit-address"
                    name="address"
                    defaultValue={workOrder.address ?? ""}
                    maxLength={200}
                  />
                </Field>
                <Field
                  id="office-edit-postal-code"
                  label={t("orders.edit.postalCodeLabel")}
                >
                  <Input
                    id="office-edit-postal-code"
                    name="postalCode"
                    defaultValue={workOrder.postalCode ?? ""}
                    maxLength={20}
                  />
                </Field>
                <Field
                  id="office-edit-city"
                  label={t("orders.edit.cityLabel")}
                  className="sm:col-span-2"
                >
                  <Input
                    id="office-edit-city"
                    name="city"
                    defaultValue={workOrder.city ?? ""}
                    maxLength={100}
                  />
                </Field>
              </div>
              <p className="type-meta mt-2 text-[var(--muted,#62685f)]">
                {t("orders.edit.locationHint")}
              </p>
            </div>
          </div>
        </SectionCard>

        {/* TID */}
        <SectionCard title={t("orders.formSections.time")}>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id="office-edit-scheduled-for"
              label={t("orders.edit.scheduledDate")}
            >
              <IsoDateInput
                id="office-edit-scheduled-for"
                name="scheduledFor"
                defaultValue={workOrder.scheduledFor ? new Date(workOrder.scheduledFor).toISOString().split('T')[0] : ""}
                className={controlClassName("min-h-11")}
              />
            </Field>
            <Field
              id="office-edit-scheduled-to"
              label={t("orders.edit.endDate")}
              hint={t("orders.edit.endDateHint")}
              error={dateError}
            >
              <IsoDateInput
                id="office-edit-scheduled-to"
                name="scheduledTo"
                aria-describedby={
                  dateError
                    ? "office-edit-scheduled-to-hint office-edit-scheduled-to-error"
                    : "office-edit-scheduled-to-hint"
                }
                aria-invalid={dateError ? true : undefined}
                defaultValue={workOrder.scheduledTo ? new Date(workOrder.scheduledTo).toISOString().split('T')[0] : ""}
                className={controlClassName("min-h-11")}
              />
            </Field>
          </div>
          <p className={`${brandInset} mt-3 px-3 py-2 text-xs font-medium leading-5 text-[var(--muted,#62685f)]`}>
            {t("orders.edit.workdayHint")}
          </p>
        </SectionCard>

        {/* RESSURSER */}
        <SectionCard title={t("orders.formSections.resources")}>

          <div className="mt-3 space-y-4">
            <div role="group" aria-labelledby="office-edit-technicians">
              <p
                id="office-edit-technicians"
                className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
              >
                {t("orders.edit.technicians")}
              </p>
              <p id="office-edit-technicians-hint" className="type-meta mt-1 text-[var(--muted,#62685f)]">
                {t("orders.edit.techniciansHint")}
              </p>
              <div
                aria-describedby="office-edit-technicians-hint"
                className={`mt-2 max-h-48 space-y-1 overflow-y-auto ${brandInset} p-2`}
              >
                {technicianOptions.map(tech => (
                  <label
                    key={tech.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-1.5 transition hover:bg-[var(--surface,#fffdf8)]"
                  >
                    <input
                      type="checkbox"
                      name="technicianIds"
                      value={tech.id}
                      defaultChecked={workOrder.technicians.some(wt => wt.id === tech.id)}
                      className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                    />
                    <span className="min-w-0 break-words text-sm font-medium text-[var(--ink,#101310)]">
                      {tech.name} ({tech.role === 'ADMIN' ? t("orders.edit.roleAdmin") : tech.role === 'OFFICE' ? t("orders.edit.roleOffice") : t("orders.edit.roleTechnician")})
                      {isAdmin && tech.department ? ` – ${tech.department.name}` : ""}
                    </span>
                  </label>
                ))}
                {technicianOptions.length === 0 && (
                  <p className="p-2 text-sm text-[var(--muted,#62685f)]">
                    {t("orders.edit.noEmployees")}
                  </p>
                )}
              </div>
            </div>

            <div
              role="group"
              aria-labelledby="office-edit-skills-title"
              aria-describedby="office-edit-skills-hint"
            >
              <p
                id="office-edit-skills-title"
                className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
              >
                {t("orders.skills.title")}
              </p>
              <p id="office-edit-skills-hint" className="type-meta mt-1 text-[var(--muted,#62685f)]">
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
                          defaultChecked={selectedSkillIds.has(skill.id)}
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
                          defaultChecked={mandatorySkillIds.has(skill.id)}
                          className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                        />
                        {t("orders.skills.mandatory")}
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div aria-describedby="office-edit-tags-hint">
              <p className="type-eyebrow mb-1 text-[var(--ink,#101310)]">
                {t("orders.edit.tags")}
              </p>
              <TagSelector allTags={tags} selectedTagNames={workOrder.tags.map((tag: any) => tag.name)} />
              <p id="office-edit-tags-hint" className="type-meta mt-1 text-[var(--muted,#62685f)]">
                {t("orders.edit.tagsHint")}
              </p>
            </div>
          </div>
        </SectionCard>

        <SubmitButton
          pendingLabel={t("orders.edit.saving")}
          className={`${buttonClassName({ variant: "primary" })} w-full`}
        >
          {withoutLeadingSymbol(t("orders.edit.submit"))}
        </SubmitButton>
      </ValidatedForm>
    </PageShell>
  );
}
