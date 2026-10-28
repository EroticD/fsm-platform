import { getTranslations } from "next-intl/server";
import {
  createDepartment,
  setDefaultDepartment,
  toggleDepartment,
  updateDepartment,
} from "@/app/innstillinger/department-actions";

type DepartmentRow = {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  isActive: boolean;
  isDefault: boolean;
  users: number;
  workOrders: number;
  contracts: number;
};

export default async function DepartmentsAdmin({ departments }: { departments: DepartmentRow[] }) {
  const t = await getTranslations("common");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-8">
          <h2 className="font-bold text-lg text-gray-800 border-b pb-2 mb-4">
            ➕ {t("settings.departments.new")}
          </h2>
          <form action={createDepartment} className="space-y-4">
            <div>
              <label htmlFor="new-department-name" className="block text-sm font-bold text-gray-700 mb-1">{t("settings.departments.name")}</label>
              <input
                id="new-department-name"
                type="text"
                name="name"
                required
                placeholder={t("settings.departments.namePlaceholder")}
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>
            <div>
              <label htmlFor="new-department-description" className="block text-sm font-bold text-gray-700 mb-1">
                {t("settings.departments.descriptionLabel")}{" "}
                <span className="font-normal text-gray-400">{t("settings.departments.optional")}</span>
              </label>
              <input
                id="new-department-description"
                type="text"
                name="description"
                placeholder={t("settings.departments.descriptionPlaceholder")}
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-department-phone" className="block text-sm font-bold text-gray-700 mb-1">{t("settings.departments.phone")}</label>
                <input id="new-department-phone" type="tel" name="phone" placeholder={t("settings.departments.phonePlaceholder")} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
              </div>
              <div>
                <label htmlFor="new-department-email" className="block text-sm font-bold text-gray-700 mb-1">{t("settings.departments.email")}</label>
                <input id="new-department-email" type="email" name="email" placeholder={t("settings.departments.emailPlaceholder")} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
              </div>
            </div>
            <div>
              <label htmlFor="new-department-address" className="block text-sm font-bold text-gray-700 mb-1">{t("settings.departments.address")}</label>
              <input id="new-department-address" type="text" name="address" placeholder={t("settings.departments.addressPlaceholder")} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="new-department-postal-code" className="block text-sm font-bold text-gray-700 mb-1">{t("settings.departments.postalCode")}</label>
                <input id="new-department-postal-code" type="text" name="postalCode" className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
              </div>
              <div>
                <label htmlFor="new-department-city" className="block text-sm font-bold text-gray-700 mb-1">{t("settings.departments.city")}</label>
                <input id="new-department-city" type="text" name="city" className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
              {t("settings.departments.info")}
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition"
            >
              {t("settings.departments.create")}
            </button>
          </form>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {departments.length === 0 && (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 text-sm text-gray-500">
            {t("settings.departments.empty")}
          </div>
        )}

        {departments.map((department) => (
          <div
            key={department.id}
            className={`bg-white p-5 rounded-2xl shadow-sm border ${
              department.isDefault ? "border-blue-300" : "border-gray-100"
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900 flex flex-wrap items-center gap-2">
                  🏷️ {department.name}
                  {department.isDefault && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold uppercase">
                      {t("settings.departments.default")}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                      department.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {department.isActive
                      ? t("settings.departments.active")
                      : t("settings.departments.inactive")}
                  </span>
                </h3>
                {department.description && (
                  <p className="text-sm text-gray-500 mt-1">{department.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  👥 {t("settings.departments.stats", {
                    users: department.users,
                    workOrders: department.workOrders,
                    contracts: department.contracts,
                  })}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!department.isDefault && department.isActive && (
                  <form action={setDefaultDepartment}>
                    <input type="hidden" name="id" value={department.id} />
                    <button
                      type="submit"
                      className="text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition"
                    >
                      {t("settings.departments.setDefault")}
                    </button>
                  </form>
                )}
                {!department.isDefault && (
                  <form action={toggleDepartment}>
                    <input type="hidden" name="id" value={department.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={department.isActive ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                        department.isActive
                          ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                          : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                      }`}
                    >
                      {department.isActive
                        ? t("settings.departments.deactivate")
                        : t("settings.departments.activate")}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <details className="mt-4 group">
              <summary className="text-xs font-bold text-blue-700 cursor-pointer select-none">
                {t("settings.departments.edit")}
              </summary>
              <form action={updateDepartment} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input type="hidden" name="id" value={department.id} />
                <div>
                  <label htmlFor={`department-${department.id}-name`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.departments.name")}</label>
                  <input
                    id={`department-${department.id}-name`}
                    type="text"
                    name="name"
                    required
                    defaultValue={department.name}
                    className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
                  />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-description`} className="block text-xs font-bold text-gray-700 mb-1">
                    {t("settings.departments.descriptionLabel")}
                  </label>
                  <input
                    id={`department-${department.id}-description`}
                    type="text"
                    name="description"
                    defaultValue={department.description ?? ""}
                    className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
                  />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-phone`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.departments.phone")}</label>
                  <input id={`department-${department.id}-phone`} type="tel" name="phone" defaultValue={department.phone ?? ""} className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-email`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.departments.email")}</label>
                  <input id={`department-${department.id}-email`} type="email" name="email" defaultValue={department.email ?? ""} className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-address`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.departments.address")}</label>
                  <input id={`department-${department.id}-address`} type="text" name="address" defaultValue={department.address ?? ""} className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-postal-code`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.departments.postalCode")}</label>
                  <input id={`department-${department.id}-postal-code`} type="text" name="postalCode" defaultValue={department.postalCode ?? ""} className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-city`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.departments.city")}</label>
                  <input id={`department-${department.id}-city`} type="text" name="city" defaultValue={department.city ?? ""} className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition"
                  >
                    {t("settings.departments.saveChanges")}
                  </button>
                </div>
              </form>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
