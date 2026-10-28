import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import ErrorBanner from "@/components/ErrorBanner";
import FormValuePersistence from "@/components/FormValuePersistence";
import SubmitButton from "@/components/SubmitButton";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments } from "@/lib/departments";
import { staffForDepartment, staffWhere, workOrderScope } from "@/lib/access";
import CustomerSelect from "../../ny/CustomerSelect";
import { updateWorkOrder } from "./actions";

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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("orders.edit.notFoundTitle")}</h1>
        <Link href="/" className="text-blue-700 font-bold hover:underline">{t("orders.edit.backToDashboard")}</Link>
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
    "duplikat-ordrenummer": t("orders.errors.duplicateOrderNumber"),
    avdeling: t("orders.errors.department"),
    "workorder-locked": t("orders.errors.workOrderLocked"),
    "ikke-tilgang": t("orders.errors.generic"),
    ukjent: t("orders.errors.generic"),
  };
  const errorMessage = error
    ? (errorMessages[error] ?? t("orders.errors.saveFailed"))
    : undefined;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        
        <ErrorBanner message={errorMessage} />

        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900">{t("orders.edit.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">{t("orders.edit.subtitle")}</p>
          </div>
          <Link href={`/oppdrag/${workOrderId}`} className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm">
            {t("orders.edit.cancel")}
          </Link>
        </div>

        <form id="office-edit-work-order" action={updateWorkOrder} className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border-2 border-gray-200 space-y-6">
          <FormValuePersistence
            formId="office-edit-work-order"
            storageKey={`fsm:office-edit-work-order:${workOrderId}`}
            restore={Boolean(error)}
          />
          <input type="hidden" name="workOrderId" value={workOrderId} />
          
          <div>
            <label htmlFor="office-edit-title" className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.titleLabel")} <span className="text-red-500">*</span></label>
            <input 
              id="office-edit-title"
              type="text" 
              name="title" 
              defaultValue={workOrder.title} 
              required 
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label htmlFor="office-edit-order-number" className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.orderNumber")}</label>
            <input
              id="office-edit-order-number"
              type="text"
              name="orderNumber"
              defaultValue={workOrder.orderNumber ?? ""}
              maxLength={200}
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label htmlFor="office-edit-department" className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.department")}</label>
            {isAdmin ? (
              <select
                id="office-edit-department"
                name="departmentId"
                defaultValue={workOrder.departmentId}
                aria-describedby="office-edit-department-hint"
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full border-2 border-gray-200 bg-gray-50 p-3.5 rounded-xl text-base font-bold text-gray-800">
                {workOrder.department.name}
              </div>
            )}
            <p id="office-edit-department-hint" className="text-xs text-gray-500 mt-1">
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
              hideLabel
            />
            <p className="text-xs text-gray-500 mt-1">
              {t("orders.edit.contactHint")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="office-edit-scheduled-for" className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.scheduledDate")}</label>
              <input
                id="office-edit-scheduled-for"
                type="date"
                name="scheduledFor"
                defaultValue={workOrder.scheduledFor ? new Date(workOrder.scheduledFor).toISOString().split('T')[0] : ""}
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label htmlFor="office-edit-scheduled-to" className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.endDate")}</label>
              <input
                id="office-edit-scheduled-to"
                type="date"
                name="scheduledTo"
                aria-describedby="office-edit-scheduled-to-hint"
                defaultValue={workOrder.scheduledTo ? new Date(workOrder.scheduledTo).toISOString().split('T')[0] : ""}
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              />
              <p id="office-edit-scheduled-to-hint" className="text-xs text-gray-500 mt-1">{t("orders.edit.endDateHint")}</p>
            </div>
          </div>

          <fieldset>
            <legend className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.technicians")}</legend>
            <p id="office-edit-technicians-hint" className="text-xs text-gray-500 mb-2">{t("orders.edit.techniciansHint")}</p>
            <div aria-describedby="office-edit-technicians-hint" className="max-h-48 overflow-y-auto bg-gray-50 p-3 rounded-xl border-2 border-gray-200 space-y-1">
              {technicianOptions.map(tech => (
                <label key={tech.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-200 p-1.5 rounded-lg transition">
                  <input
                    type="checkbox"
                    name="technicianIds"
                    value={tech.id}
                    defaultChecked={workOrder.technicians.some(wt => wt.id === tech.id)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="font-medium text-gray-800 text-sm">
                    {tech.name} ({tech.role === 'ADMIN' ? t("orders.edit.roleAdmin") : tech.role === 'OFFICE' ? t("orders.edit.roleOffice") : t("orders.edit.roleTechnician")})
                    {isAdmin && tech.department ? ` – ${tech.department.name}` : ""}
                  </span>
                </label>
              ))}
              {technicianOptions.length === 0 && (
                <p className="text-sm text-gray-500 p-2">{t("orders.edit.noEmployees")}</p>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.tags")}</legend>
            <TagSelector allTags={tags} selectedTagNames={workOrder.tags.map((tag: any) => tag.name)} />
            <p className="text-xs text-gray-500 mt-1">{t("orders.edit.tagsHint")}</p>
          </fieldset>

          <div>
            <label htmlFor="office-edit-description" className="block text-sm font-black text-gray-900 mb-2">{t("orders.edit.description")}</label>
            <MarkdownEditor
              id="office-edit-description"
              name="description"
              rows={4}
              defaultValue={workOrder.description || ""}
              placeholder={t("orders.edit.descriptionPlaceholder")}
            />
          </div>

          <div className="border-t-2 border-gray-200 pt-6">
            <SubmitButton
              pendingLabel={t("orders.edit.saving")}
              className="w-full bg-blue-700 text-white py-4 rounded-xl font-black text-lg hover:bg-blue-800 transition shadow-md"
            >
              {t("orders.edit.submit")}
            </SubmitButton>
          </div>

        </form>

      </div>
    </div>
  );
}
