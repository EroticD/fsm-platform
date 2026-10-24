import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import MarkdownEditor from "@/components/MarkdownEditor";
import { getCustomerEditOptions } from "@/server/customers";
import { updateCustomerAction } from "../../actions";

export default async function EditCustomerPage({ 
  params,
  searchParams,
}: { 
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getCurrentUser();
  if (!session) redirect("/api/auth/signin");
  const t = await getTranslations("common");

  const resolvedParams = await params;
  const customerId = resolvedParams.id;

  // Å redigere kundedata krever customers.manage. Montører får lese kundekortet.
  if (!hasPermission(session, "customers.manage")) redirect(`/kunder/${customerId}`);

  const options = await getCustomerEditOptions(session, customerId);
  if (!options.ok) {
    if (options.reason === "forbidden") redirect(`/kunder/${customerId}`);
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("customers.detail.notFound")}</h1>
        <Link href="/kunder" className="text-blue-600 font-bold hover:underline">
          {t("customers.detail.backToArchive")}
        </Link>
      </div>
    );
  }

  const { customer, departments, technicianOptions } = options.data;
  const updateCustomer = updateCustomerAction.bind(null, customerId);

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {error && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            ⛔ {t("customers.edit.saveError")}
          </div>
        )}

        {/* HEADER */}
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">✏️ {t("customers.edit.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm">{t("customers.edit.description", { name: customer.name })}</p>
          </div>
          <div className="flex gap-3">
            <Link href={`/kunder/${customerId}`} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition shadow-sm">
              &larr; {t("customers.edit.backToDetails")}
            </Link>
            <Link href="/kunder" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition shadow-sm">
              {t("customers.edit.archive")}
            </Link>
          </div>
        </div>

        <form action={updateCustomer} className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Firmanavn */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.companyName")} *</label>
              <input 
                type="text" 
                name="name" 
                defaultValue={customer.name} 
                required 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>

            {/* Kundenummer */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.customerNumber")}</label>
              <input 
                type="text" 
                name="customerNumber" 
                defaultValue={customer.customerNumber || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* Org.nr */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.orgNumber")}</label>
              <input 
                type="text" 
                name="orgNumber" 
                defaultValue={customer.orgNumber || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* Merkevarefarge */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.brandColor")}</label>
              <div className="flex gap-3 items-center">
                <input 
                  type="color" 
                  name="brandColor" 
                  defaultValue={customer.brandColor || "#2563eb"} 
                  className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
                />
                <input 
                  type="text" 
                  name="brandColorText" 
                  defaultValue={customer.brandColor || "#2563eb"} 
                  className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium bg-gray-50" 
                  readOnly 
                />
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Adresse */}
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.address")}</label>
              <input 
                type="text" 
                name="address" 
                defaultValue={customer.address || ""} 
                placeholder={t("customers.edit.addressPlaceholder")}
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Postnr */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.postalCode")}</label>
              <input 
                type="text" 
                name="postalCode" 
                defaultValue={customer.postalCode || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* By */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.city")}</label>
              <input 
                type="text" 
                name="city" 
                defaultValue={customer.city || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* Telefon */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.phone")}</label>
              <input 
                type="tel" 
                name="phone" 
                defaultValue={customer.phone || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* E-post */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.email")}</label>
              <input 
                type="email" 
                name="email" 
                defaultValue={customer.email || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

          </div>

          {/* Avdeling og ansvarlig montør */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.department")}</label>
              <select
                name="departmentId"
                defaultValue={customer.departmentId || ""}
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              >
                <option value="">{t("customers.edit.noDepartment")}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{t("customers.edit.departmentHint")}</p>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.responsibleTechnician")}</label>
              <select
                name="responsibleTechnicianId"
                defaultValue={customer.responsibleTechnicianId || ""}
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              >
                <option value="">{t("customers.edit.noResponsible")}</option>
                {technicianOptions.map((technician) => (
                  <option key={technician.id} value={technician.id}>{technician.name || technician.email}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{t("customers.edit.responsibleHint")}</p>
            </div>
          </div>

          {/* Noter */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">{t("customers.edit.notes")}</label>
            <MarkdownEditor
              name="notes"
              rows={4}
              defaultValue={customer.notes || ""}
              placeholder={t("customers.edit.notesPlaceholder")}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Link href={`/kunder/${customerId}`} className="bg-gray-100 text-gray-700 px-6 py-3 rounded-xl font-bold hover:bg-gray-200 transition shadow-sm">
              {t("customers.edit.cancel")}
            </Link>
            <button type="submit" className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-sm">
              {t("customers.edit.save")}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
