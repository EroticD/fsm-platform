import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
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
  trackingEnabled: boolean;
  users: number;
  workOrders: number;
  contracts: number;
};

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
const SIGNAL_BUTTON =
  "signal-button w-full text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_SMALL =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]";
const CHIP =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold uppercase";

export default async function DepartmentsAdmin({ departments }: { departments: DepartmentRow[] }) {
  const t = await getTranslations("common");

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
      <div className="lg:col-span-1">
        <div className="office-card sticky top-8 p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-2 text-base font-extrabold text-[var(--ink,#101310)]">
            <Icon name="plus" className="h-4 w-4 shrink-0" />
            {t("settings.departments.new")}
          </h2>
          <form action={createDepartment} className="space-y-4">
            <div>
              <label htmlFor="new-department-name" className={LABEL}>{t("settings.departments.name")}</label>
              <input
                id="new-department-name"
                type="text"
                name="name"
                required
                placeholder={t("settings.departments.namePlaceholder")}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="new-department-description" className={LABEL}>
                {t("settings.departments.descriptionLabel")}{" "}
                <span className="font-normal normal-case tracking-normal text-[var(--muted,#62685f)]">{t("settings.departments.optional")}</span>
              </label>
              <input
                id="new-department-description"
                type="text"
                name="description"
                placeholder={t("settings.departments.descriptionPlaceholder")}
                className={FIELD}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="new-department-phone" className={LABEL}>{t("settings.departments.phone")}</label>
                <input id="new-department-phone" type="tel" name="phone" placeholder={t("settings.departments.phonePlaceholder")} className={FIELD} />
              </div>
              <div>
                <label htmlFor="new-department-email" className={LABEL}>{t("settings.departments.email")}</label>
                <input id="new-department-email" type="email" name="email" placeholder={t("settings.departments.emailPlaceholder")} className={FIELD} />
              </div>
            </div>
            <div>
              <label htmlFor="new-department-address" className={LABEL}>{t("settings.departments.address")}</label>
              <input id="new-department-address" type="text" name="address" placeholder={t("settings.departments.addressPlaceholder")} className={FIELD} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="new-department-postal-code" className={LABEL}>{t("settings.departments.postalCode")}</label>
                <input id="new-department-postal-code" type="text" name="postalCode" className={FIELD} />
              </div>
              <div>
                <label htmlFor="new-department-city" className={LABEL}>{t("settings.departments.city")}</label>
                <input id="new-department-city" type="text" name="city" className={FIELD} />
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-xs text-[var(--muted,#62685f)]">
              {t("settings.departments.info")}
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#101310)]">
              <input
                type="checkbox"
                name="trackingEnabled"
                className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
              />
              <span>
                <span className="block font-bold">
                  {t("settings.departments.trackingEnabled")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted,#62685f)]">
                  {t("settings.departments.trackingHint")}
                </span>
              </span>
            </label>
            <button type="submit" className={SIGNAL_BUTTON}>
              {t("settings.departments.create")}
            </button>
          </form>
        </div>
      </div>

      <div className="space-y-3 lg:col-span-2">
        {departments.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-6 text-sm text-[var(--muted,#62685f)]">
            {t("settings.departments.empty")}
          </div>
        )}

        {departments.map((department) => (
          <div
            key={department.id}
            className="office-card relative overflow-hidden p-4 pl-5 sm:p-5"
          >
            {department.isDefault && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-[var(--signal,#d8ff3e)]"
              />
            )}
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 font-bold text-[var(--ink,#101310)]">
                  <Icon name="building" className="h-4 w-4 shrink-0" />
                  <span className="break-words">{department.name}</span>
                  {department.isDefault && (
                    <span className={`${CHIP} border-[#c7d98e] bg-[#f3fbd1] text-[#283509]`}>
                      {t("settings.departments.default")}
                    </span>
                  )}
                  <span
                    className={`${CHIP} ${
                      department.isActive
                        ? "border-[#c7d98e] bg-[#f3fbd1] text-[#283509]"
                        : "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05]"
                    }`}
                  >
                    {department.isActive
                      ? t("settings.departments.active")
                      : t("settings.departments.inactive")}
                  </span>
                </h3>
                {department.description && (
                  <p className="mt-1 text-sm text-[var(--muted,#62685f)]">{department.description}</p>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                  <Icon name="users" className="h-3.5 w-3.5 shrink-0" />
                  {t("settings.departments.stats", {
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
                    <button type="submit" className={INK_SMALL}>
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
                      className={`inline-flex min-h-9 items-center justify-center rounded-lg border px-3 text-xs font-bold transition ${
                        department.isActive
                          ? "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05] hover:bg-[#f6e8c5]"
                          : "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] hover:bg-[#cbef35]"
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

            <details className="group mt-4 border-t border-[var(--line,#dedcd1)] pt-3">
              <summary className={`${INK_SMALL} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                {t("settings.departments.edit")}
              </summary>
              <form action={updateDepartment} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <input type="hidden" name="id" value={department.id} />
                <div>
                  <label htmlFor={`department-${department.id}-name`} className={LABEL}>{t("settings.departments.name")}</label>
                  <input
                    id={`department-${department.id}-name`}
                    type="text"
                    name="name"
                    required
                    defaultValue={department.name}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-description`} className={LABEL}>
                    {t("settings.departments.descriptionLabel")}
                  </label>
                  <input
                    id={`department-${department.id}-description`}
                    type="text"
                    name="description"
                    defaultValue={department.description ?? ""}
                    className={FIELD}
                  />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-phone`} className={LABEL}>{t("settings.departments.phone")}</label>
                  <input id={`department-${department.id}-phone`} type="tel" name="phone" defaultValue={department.phone ?? ""} className={FIELD} />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-email`} className={LABEL}>{t("settings.departments.email")}</label>
                  <input id={`department-${department.id}-email`} type="email" name="email" defaultValue={department.email ?? ""} className={FIELD} />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-address`} className={LABEL}>{t("settings.departments.address")}</label>
                  <input id={`department-${department.id}-address`} type="text" name="address" defaultValue={department.address ?? ""} className={FIELD} />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-postal-code`} className={LABEL}>{t("settings.departments.postalCode")}</label>
                  <input id={`department-${department.id}-postal-code`} type="text" name="postalCode" defaultValue={department.postalCode ?? ""} className={FIELD} />
                </div>
                <div>
                  <label htmlFor={`department-${department.id}-city`} className={LABEL}>{t("settings.departments.city")}</label>
                  <input id={`department-${department.id}-city`} type="text" name="city" defaultValue={department.city ?? ""} className={FIELD} />
                </div>
                <div className="md:col-span-2">
                  <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#101310)]">
                    <input
                      type="checkbox"
                      name="trackingEnabled"
                      defaultChecked={department.trackingEnabled}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                    />
                    <span>
                      <span className="block font-bold">
                        {t("settings.departments.trackingEnabled")}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--muted,#62685f)]">
                        {t("settings.departments.trackingHint")}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="md:col-span-2">
                  <button type="submit" className={INK_SMALL}>
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
