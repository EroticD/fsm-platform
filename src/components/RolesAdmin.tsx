import { getTranslations } from "next-intl/server";
import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/innstillinger/role-actions";
import { PERMISSIONS, roleLabel } from "@/lib/permissions";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";

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
    "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ink,#101310)] sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden";
  const summaryChevronClass =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted,#62685f)] transition-transform group-open:rotate-180";
  const permissionChipClass =
    "rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 font-medium text-[var(--ink,#101310)]";
  const fieldClass = controlClassName("min-h-10 text-sm font-medium");
  const LABEL =
    "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
  const infoBoxClass =
    "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-xs text-[var(--muted,#62685f)]";
  const SIGNAL_BUTTON =
    "signal-button w-full text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-2";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <details className="group office-card sticky top-8">
          <summary className={summaryClass}>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
            >
              <Icon name="plus" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 font-bold text-[var(--ink,#101310)]">
              {t("settings.roles.newRole")}
            </span>
            <span aria-hidden="true" className={summaryChevronClass}>
              <Icon name="chevronDown" className="h-4 w-4" />
            </span>
          </summary>
          <div className="border-t border-[var(--line,#dedcd1)] p-4 sm:p-6">
            <form action={createRole} className="space-y-4">
              <div>
                <label htmlFor="role-new-label" className={LABEL}>
                  {t("settings.roles.name")}
                </label>
                <input
                  id="role-new-label"
                  type="text"
                  name="label"
                  required
                  placeholder={t("settings.roles.namePlaceholder")}
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="role-new-description" className={LABEL}>
                  {t("settings.roles.descriptionLabel")}{" "}
                  <span className="font-normal normal-case tracking-normal text-[var(--muted,#62685f)]">{t("settings.roles.optional")}</span>
                </label>
                <input
                  id="role-new-description"
                  type="text"
                  name="description"
                  placeholder={t("settings.roles.descriptionPlaceholder")}
                  className={fieldClass}
                />
              </div>
  
              <div className="space-y-3">
                <p className="text-xs font-bold text-[var(--ink,#101310)]">{t("settings.roles.permissions")}</p>
                {permissionGroups.map((group) => (
                  <fieldset
                    key={group.group}
                    className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3"
                  >
                    <legend className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                      {t(group.groupKey)}
                    </legend>
                    <div className="space-y-2">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex items-start gap-2 text-xs text-[var(--ink,#101310)]"
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
                            <span className="block text-xs text-[var(--muted,#62685f)]">
                              {t(permission.descriptionKey)}
                            </span>
                            {permission.key === "reports.viewAllDepartments" && (
                              <span className="mt-0.5 block rounded bg-[#fbf1d2] px-1.5 py-0.5 text-xs font-semibold text-[#6b4a05]">
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
  
              <div className={infoBoxClass}>
                {t("settings.roles.keyInfo")}
              </div>
  
              <button
                type="submit"
                className={SIGNAL_BUTTON}
              >
                {t("settings.roles.create")}
              </button>
            </form>
          </div>
        </details>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {error && ROLE_ERROR_CODES.has(error) && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {t(`settings.roles.errors.${error}`)}
          </div>
        )}
        {messageText && (
          <div className="flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] px-4 py-3 text-sm font-bold text-[var(--ink,#101310)]">
            <Icon name="check" className="h-4 w-4 shrink-0" />
            {messageText}
          </div>
        )}

        {roles.map((role) => {
          const locked = lockedRole(role.key);
          return (
            <details
              key={role.key}
              className="group office-card"
              data-role-row
            >
              <summary className={summaryClass}>
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
                >
                  <Icon name="shield" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-bold text-[var(--ink,#101310)]">
                      {role.isSystem ? roleLabel(role.key, t) : role.label}
                    </span>
                    {role.isSystem && (
                      <span className="shrink-0 rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold uppercase text-[var(--ink,#101310)]">
                        {t("settings.roles.system")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted,#62685f)]">
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

              <div className="border-t border-[var(--line,#dedcd1)] p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--muted,#62685f)]">{role.key}</p>
                    {role.description && (
                      <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                        {role.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-[var(--muted,#62685f)]">
                      <span className="font-semibold text-[var(--muted,#62685f)]">
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
                            <span className="rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 font-bold text-[var(--ink,#101310)]">
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
                        className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 py-1.5 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--risk,#f04427)] focus-visible:ring-offset-1"
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

                <form action={updateRole} className="mt-4 space-y-4 border-t border-[var(--line,#dedcd1)] pt-4">
                  <input type="hidden" name="key" value={role.key} />
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("settings.roles.edit")}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`role-${role.key}-label`} className={LABEL}>
                        {t("settings.roles.displayName")}
                      </label>
                      <input
                        id={`role-${role.key}-label`}
                        type="text"
                        name="label"
                        required
                        defaultValue={role.label}
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <label htmlFor={`role-${role.key}-description`} className={LABEL}>
                        {t("settings.roles.descriptionLabel")}
                      </label>
                      <input
                        id={`role-${role.key}-description`}
                        type="text"
                        name="description"
                        defaultValue={role.description ?? ""}
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  {locked ? (
                    <div className="rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] p-3 text-xs text-[#6b4a05]">
                      {role.key === "ADMIN"
                        ? t("settings.roles.adminLocked")
                        : t("settings.roles.customerLocked")}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {permissionGroups.map((group) => (
                        <fieldset
                          key={group.group}
                          className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3"
                        >
                          <legend className="px-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                            {t(group.groupKey)}
                          </legend>
                          <div className="space-y-2">
                            {group.permissions.map((permission) => (
                              <label
                                key={permission.key}
                                className="flex items-start gap-2 text-xs text-[var(--ink,#101310)]"
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
                                  <span className="block text-xs text-[var(--muted,#62685f)]">
                                    {t(permission.descriptionKey)}
                                  </span>
                                  {permission.key === "reports.viewAllDepartments" && (
                                    <span className="mt-0.5 block rounded bg-[#fbf1d2] px-1.5 py-0.5 text-xs font-semibold text-[#6b4a05]">
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
                    className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 py-2 text-xs font-bold text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:shadow-[1px_1px_0_var(--ink,#101310)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-1"
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
