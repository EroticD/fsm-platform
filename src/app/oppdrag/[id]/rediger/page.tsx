import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import ErrorBanner from "@/components/ErrorBanner";
import FormValuePersistence from "@/components/FormValuePersistence";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { controlClassName } from "@/components/ui/controlStyles";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments } from "@/lib/departments";
import { staffForDepartment, staffWhere, workOrderScope } from "@/lib/access";
import CustomerSelect from "../../ny/CustomerSelect";
import { updateWorkOrder } from "./actions";

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
      tags: true
    }
  });

  if (!workOrder) {
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center p-4 sm:p-6">
        <div className="office-card w-full max-w-md p-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]">
            <Icon name="alert" className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-black text-[var(--ink,#101310)]">
            {t("orders.edit.notFoundTitle")}
          </h1>
          <Link
            href="/"
            className="signal-button mt-4 w-full"
          >
            {withoutLeadingSymbol(t("orders.edit.backToDashboard"))}
          </Link>
        </div>
      </div>
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

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto min-w-0 max-w-2xl space-y-4">
        <PageHeader
          title={withoutLeadingSymbol(t("orders.edit.title"))}
          subtitle={t("orders.edit.subtitle")}
          icon={<Icon name="edit" className="h-5 w-5" />}
          actions={
            <Link href={`/oppdrag/${workOrderId}`} className={INK_LINK}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {withoutLeadingSymbol(t("orders.edit.cancel"))}
            </Link>
          }
        />

        <ErrorBanner message={errorMessage} />

        <form
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
          <section className={CARD} aria-labelledby="office-edit-content">
            <h2 id="office-edit-content" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.content")}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="office-edit-title" className={LABEL}>
                  {t("orders.edit.titleLabel")}{" "}
                  <span className="text-[var(--risk-text,#b42318)]">*</span>
                </label>
                <input
                  id="office-edit-title"
                  type="text"
                  name="title"
                  defaultValue={workOrder.title}
                  required
                  className={controlClassName("min-h-11")}
                />
              </div>

              <div>
                <label htmlFor="office-edit-order-number" className={LABEL}>
                  {t("orders.edit.orderNumber")}
                </label>
                <input
                  id="office-edit-order-number"
                  type="text"
                  name="orderNumber"
                  defaultValue={workOrder.orderNumber ?? ""}
                  maxLength={200}
                  className={controlClassName("min-h-11")}
                />
              </div>

              <div>
                <label htmlFor="office-edit-description" className={LABEL}>
                  {t("orders.edit.description")}
                </label>
                <MarkdownEditor
                  id="office-edit-description"
                  name="description"
                  rows={4}
                  defaultValue={workOrder.description || ""}
                  placeholder={t("orders.edit.descriptionPlaceholder")}
                />
              </div>
            </div>
          </section>

          {/* KUNDE OG STED */}
          <section className={CARD} aria-labelledby="office-edit-customer">
            <h2 id="office-edit-customer" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.customerPlace")}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="office-edit-department" className={LABEL}>
                  {t("orders.edit.department")}
                </label>
                {isAdmin ? (
                  <select
                    id="office-edit-department"
                    name="departmentId"
                    defaultValue={workOrder.departmentId}
                    aria-describedby="office-edit-department-hint"
                    className={controlClassName("min-h-11")}
                  >
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex min-h-11 w-full items-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]">
                    {workOrder.department.name}
                  </div>
                )}
                <p id="office-edit-department-hint" className={HINT}>
                  {t("orders.edit.departmentHint")}
                </p>
              </div>

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
                />
                <p className={HINT}>
                  {t("orders.edit.contactHint")}
                </p>
              </div>

              <div
                className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                aria-describedby="office-edit-location-hint"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label htmlFor="office-edit-address" className={LABEL}>
                      {t("orders.edit.addressLabel")}
                    </label>
                    <input
                      id="office-edit-address"
                      name="address"
                      defaultValue={workOrder.address ?? ""}
                      maxLength={200}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div>
                    <label htmlFor="office-edit-postal-code" className={LABEL}>
                      {t("orders.edit.postalCodeLabel")}
                    </label>
                    <input
                      id="office-edit-postal-code"
                      name="postalCode"
                      defaultValue={workOrder.postalCode ?? ""}
                      maxLength={20}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="office-edit-city" className={LABEL}>
                      {t("orders.edit.cityLabel")}
                    </label>
                    <input
                      id="office-edit-city"
                      name="city"
                      defaultValue={workOrder.city ?? ""}
                      maxLength={100}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                </div>
                <p id="office-edit-location-hint" className={HINT}>
                  {t("orders.edit.locationHint")}
                </p>
              </div>
            </div>
          </section>

          {/* TID */}
          <section className={CARD} aria-labelledby="office-edit-time">
            <h2 id="office-edit-time" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.time")}
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="office-edit-scheduled-for" className={LABEL}>
                  {t("orders.edit.scheduledDate")}
                </label>
                <input
                  id="office-edit-scheduled-for"
                  type="date"
                  name="scheduledFor"
                  defaultValue={workOrder.scheduledFor ? new Date(workOrder.scheduledFor).toISOString().split('T')[0] : ""}
                  className={controlClassName("min-h-11")}
                />
              </div>
              <div>
                <label htmlFor="office-edit-scheduled-to" className={LABEL}>
                  {t("orders.edit.endDate")}
                </label>
                <input
                  id="office-edit-scheduled-to"
                  type="date"
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
                <p id="office-edit-scheduled-to-hint" className={HINT}>
                  {t("orders.edit.endDateHint")}
                </p>
                {dateError && (
                  <p
                    id="office-edit-scheduled-to-error"
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
          <section className={CARD} aria-labelledby="office-edit-resources">
            <h2 id="office-edit-resources" className={SECTION_TITLE}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              {t("orders.formSections.resources")}
            </h2>

            <div className="mt-3 space-y-4">
              <div role="group" aria-labelledby="office-edit-technicians">
                <p
                  id="office-edit-technicians"
                  className="mb-1 text-sm font-bold text-[var(--ink,#101310)]"
                >
                  {t("orders.edit.technicians")}
                </p>
                <p id="office-edit-technicians-hint" className={HINT}>
                  {t("orders.edit.techniciansHint")}
                </p>
                <div
                  aria-describedby="office-edit-technicians-hint"
                  className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2"
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

              <div aria-describedby="office-edit-tags-hint">
                <p className="mb-1 text-sm font-bold text-[var(--ink,#101310)]">
                  {t("orders.edit.tags")}
                </p>
                <TagSelector allTags={tags} selectedTagNames={workOrder.tags.map((tag: any) => tag.name)} />
                <p id="office-edit-tags-hint" className={HINT}>
                  {t("orders.edit.tagsHint")}
                </p>
              </div>
            </div>
          </section>

          <SubmitButton
            pendingLabel={t("orders.edit.saving")}
            className="signal-button w-full"
          >
            {withoutLeadingSymbol(t("orders.edit.submit"))}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
