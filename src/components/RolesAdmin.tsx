import { getTranslations } from "next-intl/server";
import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/innstillinger/role-actions";
import { PERMISSIONS, roleLabel } from "@/lib/permissions";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";

type RoleRow = {
  key: string;
  label: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  users: number;
};

const ROLE_ERROR_CODES = new Set([
  "mangler_navn",
  "rollen_finnes",
  "ukjent_rolle",
  "systemrolle",
  "rolle_i_bruk",
]);

const ROLE_MESSAGE_CODES = new Set(["created", "updated", "deleted"]);

export default async function RolesAdmin({
  roles,
  error,
  message,
}: {
  roles: RoleRow[];
  error?: string | null;
  message?: string | null;
}) {
  const t = await getTranslations("common");
  const permissionGroups = Array.from(
    new Set(PERMISSIONS.map((permission) => permission.group)),
  ).map((group) => ({
    group,
    groupKey:
      PERMISSIONS.find((permission) => permission.group === group)?.groupKey ??
      "settings.permissions.groups.administration",
    permissions: PERMISSIONS.filter((permission) => permission.group === group),
  }));

  const reportsViewLabel = t(
    "settings.permissions.items.reports_view.label",
  );
  const permissionLabel = (key: string) => {
    const definition = PERMISSIONS.find((permission) => permission.key === key);
    return definition ? t(definition.labelKey) : key;
  };

  const lockedRole = (key: string) => key === "ADMIN" || key === "CUSTOMER";
  const messageText =
    message && ROLE_MESSAGE_CODES.has(message)
      ? t(`settings.roles.messages.${message}`)
      : null;

  const summaryClass =
    "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden";
  const summaryChevronClass =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-transform group-open:rotate-180";
  const permissionChipClass =
    "rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <details className="group sticky top-8 rounded-2xl border border-gray-100 bg-white shadow-sm">
          <summary className={summaryClass}>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"
            >
              <Icon name="plus" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 font-bold text-gray-800">
              {t("settings.roles.newRole")}
            </span>
            <span aria-hidden="true" className={summaryChevronClass}>
              <Icon name="chevronDown" className="h-4 w-4" />
            </span>
          </summary>
          <div className="border-t border-gray-100 p-4 sm:p-6">
            <form action={createRole} className="space-y-4">
              <div>
                <label htmlFor="role-new-label" className="block text-sm font-bold text-gray-700 mb-1">
                  {t("settings.roles.name")}
                </label>
                <input
                  id="role-new-label"
                  type="text"
                  name="label"
                  required
                  placeholder={t("settings.roles.namePlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>
              <div>
                <label htmlFor="role-new-description" className="block text-sm font-bold text-gray-700 mb-1">
                  {t("settings.roles.descriptionLabel")}{" "}
                  <span className="font-normal text-gray-600">{t("settings.roles.optional")}</span>
                </label>
                <input
                  id="role-new-description"
                  type="text"
                  name="description"
                  placeholder={t("settings.roles.descriptionPlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>
  
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-800">{t("settings.roles.permissions")}</p>
                {permissionGroups.map((group) => (
                  <fieldset
                    key={group.group}
                    className="border border-gray-200 rounded-xl p-3"
                  >
                    <legend className="px-1 text-xs font-bold text-gray-600 uppercase">
                      {t(group.groupKey)}
                    </legend>
                    <div className="space-y-2">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex items-start gap-2 text-xs text-gray-700"
                          title={t(permission.descriptionKey)}
                        >
                          <input
                            type="checkbox"
                            name="permissions"
                            value={permission.key}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-semibold">{t(permission.labelKey)}</span>
                            <span className="block text-xs text-gray-600">
                              {t(permission.descriptionKey)}
                            </span>
                            {permission.key === "reports.viewAllDepartments" && (
                              <span className="mt-0.5 block rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                                {t("settings.roles.requiresPermission", {
                                  permission: reportsViewLabel,
                                })}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
  
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
                {t("settings.roles.keyInfo")}
              </div>
  
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                {t("settings.roles.create")}
              </button>
            </form>
          </div>
        </details>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {error && ROLE_ERROR_CODES.has(error) && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-semibold">
            {t(`settings.roles.errors.${error}`)}
          </div>
        )}
        {messageText && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl text-sm font-semibold">
            {messageText}
          </div>
        )}

        {roles.map((role) => {
          const locked = lockedRole(role.key);
          return (
            <details
              key={role.key}
              className="group rounded-2xl border border-gray-100 bg-white shadow-sm"
              data-role-row
            >
              <summary className={summaryClass}>
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600"
                >
                  <Icon name="shield" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-bold text-gray-900">
                      {role.isSystem ? roleLabel(role.key, t) : role.label}
                    </span>
                    {role.isSystem && (
                      <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-bold uppercase text-gray-600">
                        {t("settings.roles.system")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-500">
                    {t("settings.roles.stats", {
                      users: role.users,
                      permissions: role.permissions.length,
                    })}
                  </span>
                </span>
                <span aria-hidden="true" className={summaryChevronClass}>
                  <Icon name="chevronDown" className="h-4 w-4" />
                </span>
              </summary>

              <div className="border-t border-gray-100 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-gray-500">{role.key}</p>
                    {role.description && (
                      <p className="mt-1 text-sm text-gray-500">
                        {role.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-600">
                      <span className="font-semibold text-gray-500">
                        {t("settings.roles.selectedPermissions")}:
                      </span>
                      {role.permissions.length === 0 ? (
                        <span>{t("settings.roles.noPermissions")}</span>
                      ) : (
                        <>
                          {role.permissions.slice(0, 6).map((permissionKey) => (
                            <span key={permissionKey} className={permissionChipClass}>
                              {permissionLabel(permissionKey)}
                            </span>
                          ))}
                          {role.permissions.length > 6 && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
                              +{role.permissions.length - 6}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {!role.isSystem && (
                    <ConfirmSubmitForm
                      action={deleteRole}
                      confirmMessage={t("components.confirm.deleteRole", {
                        name: role.label,
                      })}
                      confirmLabel={t("components.confirm.deleteRoleLabel")}
                      danger
                    >
                      <input type="hidden" name="key" value={role.key} />
                      <button
                        type="submit"
                        disabled={role.users > 0}
                        className="text-xs font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1"
                        title={
                          role.users > 0
                            ? t("settings.roles.deleteBlocked")
                            : t("settings.roles.deleteTitle")
                        }
                      >
                        {t("settings.roles.deleteRole")}
                      </button>
                    </ConfirmSubmitForm>
                  )}
                </div>

                <form action={updateRole} className="mt-4 space-y-4 border-t border-gray-100 pt-4">
                  <input type="hidden" name="key" value={role.key} />
                  <p className="text-xs font-bold text-gray-700">
                    {t("settings.roles.edit")}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`role-${role.key}-label`} className="block text-xs font-bold text-gray-700 mb-1">
                        {t("settings.roles.displayName")}
                      </label>
                      <input
                        id={`role-${role.key}-label`}
                        type="text"
                        name="label"
                        required
                        defaultValue={role.label}
                        className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label htmlFor={`role-${role.key}-description`} className="block text-xs font-bold text-gray-700 mb-1">
                        {t("settings.roles.descriptionLabel")}
                      </label>
                      <input
                        id={`role-${role.key}-description`}
                        type="text"
                        name="description"
                        defaultValue={role.description ?? ""}
                        className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      />
                    </div>
                  </div>

                  {locked ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                      {role.key === "ADMIN"
                        ? t("settings.roles.adminLocked")
                        : t("settings.roles.customerLocked")}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {permissionGroups.map((group) => (
                        <fieldset
                          key={group.group}
                          className="border border-gray-200 rounded-xl p-3"
                        >
                          <legend className="px-1 text-xs font-bold text-gray-600 uppercase">
                            {t(group.groupKey)}
                          </legend>
                          <div className="space-y-2">
                            {group.permissions.map((permission) => (
                              <label
                                key={permission.key}
                                className="flex items-start gap-2 text-xs text-gray-700"
                                title={t(permission.descriptionKey)}
                              >
                                <input
                                  type="checkbox"
                                  name="permissions"
                                  value={permission.key}
                                  defaultChecked={role.permissions.includes(
                                    permission.key,
                                  )}
                                  className="mt-0.5"
                                />
                                <span>
                                  <span className="font-semibold">
                                    {t(permission.labelKey)}
                                  </span>
                                  <span className="block text-xs text-gray-600">
                                    {t(permission.descriptionKey)}
                                  </span>
                                  {permission.key === "reports.viewAllDepartments" && (
                                    <span className="mt-0.5 block rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                                      {t("settings.roles.requiresPermission", {
                                        permission: reportsViewLabel,
                                      })}
                                    </span>
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1"
                  >
                    {t("settings.roles.save")}
                  </button>
                </form>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
