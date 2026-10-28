import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import CustomerSelect from "./CustomerSelect";
import ErrorBanner from "@/components/ErrorBanner";
import FormValuePersistence from "@/components/FormValuePersistence";
import MarkdownEditor from "@/components/MarkdownEditor";
import SubmitButton from "@/components/SubmitButton";
import TagSelector from "@/components/TagSelector";
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
    ? (errorMessages[error] ?? t("orders.errors.generic"))
    : undefined;
  const dateError =
    error === "sluttdato-for-startdato"
      ? t("orders.errors.endBeforeStart")
      : error === "ugyldig-sluttdato"
        ? t("orders.errors.invalidEndDate")
        : undefined;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900">{t("orders.new.title")}</h1>
            <p className="text-gray-500 text-sm">{t("orders.new.subtitle")}</p>
          </div>
          <Link href="/kalender" className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition text-sm">
            {t("orders.new.backToCalendar")}
          </Link>
        </div>

        <ErrorBanner message={errorMessage} />

        <form
          id="office-create-work-order"
          action={createWorkOrder}
          className="bg-white p-6 rounded-2xl shadow-sm border space-y-5"
        >
          <FormValuePersistence
            formId="office-create-work-order"
            storageKey="fsm:office-create-work-order"
            restore={Boolean(error)}
          />

          <div>
            <label htmlFor="office-new-department" className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.department")}</label>
            {isAdmin ? (
              <select
                id="office-new-department"
                name="departmentId"
                aria-describedby="office-new-department-hint"
                defaultValue={ownDepartmentId ?? ""}
                required
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
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
              <div className="w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-sm text-gray-800 font-bold">
                {user.department?.name || departments.find((d) => d.id === ownDepartmentId)?.name || t("orders.new.noDepartment")}
              </div>
            )}
            <p id="office-new-department-hint" className="text-xs text-gray-500 mt-1">
              {t("orders.new.departmentHint")}
            </p>
          </div>

          <div>
            <label htmlFor="office-new-title" className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.titleLabel")}</label>
            <input
              id="office-new-title"
              type="text"
              name="title"
              placeholder={t("orders.new.titlePlaceholder")}
              required
              className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
            />
          </div>

          <div>
            <label htmlFor="office-new-order-number" className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.orderNumber")}</label>
            <input
              id="office-new-order-number"
              type="text"
              name="orderNumber"
              placeholder={t("orders.new.orderNumberPlaceholder")}
              maxLength={200}
              className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
            />
          </div>

          <CustomerSelect
            customers={customers}
            optional={true}
            persistenceKey="fsm:office-create-work-order"
            restoreSelection={Boolean(error)}
          />

          <fieldset className="rounded-xl border-2 border-gray-200 p-4" aria-describedby="office-new-location-hint">
            <legend className="px-1 text-sm font-bold text-gray-700">{t("orders.new.locationTitle")}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <label htmlFor="office-new-address" className="mb-1 block text-xs font-bold text-gray-600">{t("orders.new.addressLabel")}</label>
                <input id="office-new-address" name="address" maxLength={200} className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900" />
              </div>
              <div>
                <label htmlFor="office-new-postal-code" className="mb-1 block text-xs font-bold text-gray-600">{t("orders.new.postalCodeLabel")}</label>
                <input id="office-new-postal-code" name="postalCode" maxLength={20} className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="office-new-city" className="mb-1 block text-xs font-bold text-gray-600">{t("orders.new.cityLabel")}</label>
                <input id="office-new-city" name="city" maxLength={100} className="w-full rounded-xl border border-gray-300 bg-white p-3 text-sm font-medium text-gray-900" />
              </div>
            </div>
            <p id="office-new-location-hint" className="mt-2 text-xs text-gray-500">{t("orders.new.locationHint")}</p>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="office-new-scheduled-for" className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.executionDate")}</label>
              <input id="office-new-scheduled-for" type="date" name="scheduledFor" defaultValue={todayInOslo()} required className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium" />

            </div>
            <div>
              <label htmlFor="office-new-scheduled-to" className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.endDate")}</label>
              <input id="office-new-scheduled-to" type="date" name="scheduledTo" aria-describedby={dateError ? "office-new-scheduled-to-hint office-new-scheduled-to-error" : "office-new-scheduled-to-hint"} aria-invalid={dateError ? true : undefined} className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium" />
              <p id="office-new-scheduled-to-hint" className="text-xs text-gray-500 mt-1">{t("orders.new.endDateHint")}</p>
              {dateError && (
                <p id="office-new-scheduled-to-error" role="alert" className="text-xs font-bold text-red-700 mt-1">
                  {dateError}
                </p>
              )}
            </div>
          </div>

          <fieldset>
            <legend className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.assignTechnicians")}</legend>
            <div className="max-h-40 overflow-y-auto bg-gray-50 p-3 rounded-xl border space-y-2">
              {technicians.map(tech => (
                <label key={tech.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-200 p-1.5 rounded-lg transition">
                  <input type="checkbox" name="technicianIds" value={tech.id} className="w-4 h-4 text-blue-600 rounded" />
                  <span className="font-medium text-gray-800 text-sm">
                    {tech.name}
                    {tech.department ? ` (${tech.department.name})` : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset aria-describedby="office-new-templates-hint">
            <legend className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.templates")}</legend>
            <p id="office-new-templates-hint" className="text-xs text-gray-500 mb-2">{t("orders.new.templatesHint")}</p>
            <div className="max-h-64 overflow-y-auto bg-blue-50/50 p-3 rounded-xl border border-blue-100 space-y-3">
              {templates.length === 0 && (
                <p className="text-sm text-gray-500 p-2">{t("orders.new.noTemplates")}</p>
              )}

              {serviceTemplates.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-blue-900 uppercase tracking-wider px-1">
                    {t("orders.templateGroups.service")}
                  </p>
                  {serviceTemplates.map((template) => (
                    <label key={template.id} className="flex items-center gap-3 cursor-pointer hover:bg-blue-100 p-2 rounded-lg transition">
                      <input type="checkbox" name="templateIds" value={template.id} className="w-4 h-4 text-blue-600 rounded border-gray-300" />
                      <span className="font-bold text-blue-900 text-sm">{template.title}</span>
                    </label>
                  ))}
                </div>
              )}

              {hmsTemplates.length > 0 && (
                <div className="space-y-1 border-t border-indigo-200 pt-2">
                  <p className="text-[10px] font-black text-indigo-900 uppercase tracking-wider px-1">
                    🛡️ {t("orders.templateGroups.hms")}
                  </p>
                  {hmsTemplates.map((template) => (
                    <label key={template.id} className="flex items-center gap-3 cursor-pointer hover:bg-indigo-100 p-2 rounded-lg transition">
                      <input type="checkbox" name="templateIds" value={template.id} className="w-4 h-4 text-indigo-600 rounded border-gray-300" />
                      <span className="font-bold text-indigo-900 text-sm">{template.title}</span>
                      <span className="bg-indigo-100 text-indigo-900 border border-indigo-200 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                        {template.hmsType
                          ? t(HMS_TYPE_MESSAGE_KEYS[template.hmsType])
                          : t("orders.templateGroups.hmsBadge")}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </fieldset>

          <fieldset aria-describedby="office-new-tags-hint">
            <legend className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.tags")}</legend>
            <TagSelector allTags={tags} />
            <p id="office-new-tags-hint" className="text-xs text-gray-500 mt-1">{t("orders.new.tagsHint")}</p>
          </fieldset>

          <div>
            <label htmlFor="office-new-description" className="block text-sm font-bold text-gray-700 mb-1">{t("orders.new.description")}</label>
            <MarkdownEditor id="office-new-description" name="description" rows={3} placeholder={t("orders.new.descriptionPlaceholder")} />
          </div>

          <SubmitButton
            pendingLabel={t("orders.new.submitting")}
            className="w-full bg-[var(--primary-color)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm"
          >
            {t("orders.new.submit")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
