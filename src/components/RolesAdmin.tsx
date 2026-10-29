import { getTranslations } from "next-intl/server";
import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/innstillinger/role-actions";
import { PERMISSIONS, roleLabel } from "@/lib/permissions";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-8">
          <h2 className="font-bold text-lg text-gray-800 border-b pb-2 mb-4">
            ➕ {t("settings.roles.newRole")}
          </h2>
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
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
              className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition"
            >
              {t("settings.roles.create")}
            </button>
          </form>
        </div>
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
            <div
              key={role.key}
              className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-gray-900 flex flex-wrap items-center gap-2">
                    {role.isSystem ? roleLabel(role.key, t) : role.label}
                    {role.isSystem && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-bold uppercase">
                        {t("settings.roles.system")}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">
                    {role.key}
                  </p>
                  {role.description && (
                    <p className="text-sm text-gray-500 mt-1">
                      {role.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    👥 {t("settings.roles.stats", {
                      users: role.users,
                      permissions: role.permissions.length,
                    })}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-600">
                    <span className="font-semibold text-gray-500">
                      {t("settings.roles.selectedPermissions")}:
                    </span>
                    {role.permissions.length === 0 ? (
                      <span>{t("settings.roles.noPermissions")}</span>
                    ) : (
                      <>
                        {role.permissions.slice(0, 6).map((permissionKey) => (
                          <span
                            key={permissionKey}
                            className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700"
                          >
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
                      className="text-xs font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
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

              <details className="mt-4 group">
                <summary className="text-xs font-bold text-blue-700 cursor-pointer select-none">
                  {t("settings.roles.edit")}
                </summary>
                <form action={updateRole} className="mt-3 space-y-4">
                  <input type="hidden" name="key" value={role.key} />
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
                        className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
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
                        className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
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
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition"
                  >
                    {t("settings.roles.save")}
                  </button>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
