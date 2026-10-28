import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import InviteActionForm from "@/components/InviteActionForm";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import {
  createUser,
  deleteUser,
  changeRole,
  changeDepartment,
  changePhone,
  changePermissions,
  resetPermissions,
  resetTwoFactor,
  setActive,
  generateInvite,
} from "@/app/brukere/actions";
import { effectivePermissions, PERMISSIONS } from "@/lib/permissions";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/pagination";

/**
 * Brukeradministrasjon (ansatte, roller, aktivering og invitasjoner).
 * Brukes både av /brukere og av «Ansatte & Roller»-fanen i innstillinger.
 * `returnTo` gjør at handlingene sender deg tilbake til riktig side.
 */
export default async function UsersAdmin({
  returnTo,
  currentUserEmail,
  isAdmin = false,
  departmentId,
  canManageCustomers = false,
  actorPermissions = [],
  error,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  baseUrl = "/brukere",
}: {
  returnTo: string;
  currentUserEmail?: string | null;
  isAdmin?: boolean;
  /** Avdelingen en ikke-administrator får administrere brukere i. */
  departmentId?: string | null;
  /** Kundeportalbrukere krever customers.manage. */
  canManageCustomers?: boolean;
  /** Rettighetene innlogget bruker har, brukt til å filtrere roller. */
  actorPermissions?: string[];
  error?: string;
  page?: number;
  pageSize?: number;
  baseUrl?: string;
}) {
  // Administrator ser alle. Avdelingsansvarlige ser bare egen avdeling, slik
  // at brukeradministrasjon ikke blir en vei rundt avdelingssperren.
  const t = await getTranslations("common");
  const where = isAdmin ? {} : { departmentId: departmentId ?? "__ingen_avdeling__" };
  const safePage = parsePage(page);
  const [users, totalUsers] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      take: pageSize,
      skip: (safePage - 1) * pageSize,
      include: {
        contact: true,
        customer: true,
        department: true,
        roleDefinition: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));

  const allRoles = await prisma.role.findMany({
    orderBy: [{ isSystem: "desc" }, { label: "asc" }],
  });

  // Ikke-administratorer kan bare tildele roller som ikke gir mer tilgang enn
  // de har selv. Administrator kan tildele alle roller.
  const actorPermissionSet = new Set(actorPermissions);
  const roles = allRoles.filter((role) => {
    if (role.key === "ADMIN" && !isAdmin) return false;
    if (role.key === "CUSTOMER" && !canManageCustomers) return false;
    if (isAdmin) return true;
    return role.permissions.every(
      (permission) => !permission || actorPermissionSet.has(permission),
    );
  });
  const defaultRole =
    roles.find((role) => role.key === "TECHNICIAN") ??
    roles.find((role) => role.key === "USER") ??
    roles[0];

  const departments = await prisma.department.findMany({
    where: {
      isActive: true,
      ...(isAdmin ? {} : { id: departmentId ?? "__ingen_avdeling__" }),
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  const defaultDepartment = departments.find((department) => department.isDefault) ?? departments[0];

  const permissionGroups = Array.from(
    new Set(PERMISSIONS.map((permission) => permission.group)),
  ).map((group) => ({
    group,
    permissions: PERMISSIONS.filter((permission) => permission.group === group),
  }));

  const customers = canManageCustomers
    ? await prisma.customer.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        include: { contacts: { orderBy: { name: "asc" } } },
      })
    : [];

  const errorMessage =
    error === "mangler_kontakt"
      ? t("users.errors.missingContact")
      : error === "epost_finnes"
        ? t("users.errors.duplicateEmail")
        : error === "mangler_felt"
          ? t("users.errors.missingField")
          : error === "ugyldig-data"
            ? t("users.errors.invalid")
            : null;

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-semibold">
          {errorMessage}
        </div>
      )}

      {isAdmin && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-purple-900">
              {t("users.roles.title")}
            </p>
            <p className="text-xs text-purple-700">
              {t("users.roles.description")}
            </p>
          </div>
          <Link
            href="/innstillinger?tab=roller"
            className="text-xs font-bold bg-purple-700 text-white px-3 py-2 rounded-lg hover:bg-purple-800 transition whitespace-nowrap"
          >
            {t("users.roles.manage")} →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-8">
            <h2 className="font-bold text-lg text-gray-800 border-b pb-2 mb-4">
              ➕ {t("users.add.title")}
            </h2>

            <InviteActionForm
              action={createUser}
              formClassName="space-y-4"
              submitLabel={t("users.add.submit")}
              buttonClassName="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition mt-2"
              labels={{
                ready: t("users.invite.ready", { name: "{name}" }),
                sent: t("users.invite.sent"),
                manual: t("users.invite.manual"),
                copy: t("users.invite.copy"),
                error: t("users.invite.failed"),
              }}
            >
              <input type="hidden" name="returnTo" value={returnTo} />
              <div>
                <label htmlFor="new-user-name" className="block text-sm font-bold text-gray-700 mb-1">{t("users.add.fullName")}</label>
                <input
                  id="new-user-name"
                  type="text"
                  name="name"
                  required
                  placeholder={t("users.add.namePlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
                />
              </div>
              <div>
                <label htmlFor="new-user-email" className="block text-sm font-bold text-gray-700 mb-1">{t("users.add.email")}</label>
                <input
                  id="new-user-email"
                  type="email"
                  name="email"
                  required
                  placeholder={t("users.add.emailPlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
                />
              </div>
              <div>
                <label htmlFor="new-user-phone" className="block text-sm font-bold text-gray-700 mb-1">{t("users.add.phone")} <span className="font-normal text-gray-600">{t("users.add.optional")}</span></label>
                <input
                  id="new-user-phone"
                  type="tel"
                  name="phone"
                  placeholder={t("users.add.phonePlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
                />
              </div>
              <div>
                <label htmlFor="new-user-role" className="block text-sm font-bold text-gray-700 mb-1">
                  {t("users.add.role")}
                </label>
                <select
                  id="new-user-role"
                  name="role"
                  defaultValue={defaultRole?.key ?? ""}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900"
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                      {role.key === "CUSTOMER" ? t("users.add.customerSuffix") : ""}
                    </option>
                  ))}
                </select>
                {roles.length === 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    {t("users.add.noRoles")}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="new-user-department" className="block text-sm font-bold text-gray-700 mb-1">
                  {t("users.add.department")}
                </label>
                <select
                  id="new-user-department"
                  name="departmentId"
                  defaultValue={defaultDepartment?.id ?? ""}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900"
                >
                  <option value="">{t("users.add.noDepartment")}</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.isDefault ? t("users.add.defaultSuffix") : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {t("users.add.departmentHelp")}
                </p>
              </div>
              {canManageCustomers && (
                <div>
                  <label htmlFor="new-user-contact" className="block text-sm font-bold text-gray-700 mb-1">
                    {t("users.add.contact")}{" "}
                    <span className="font-normal text-gray-600">{t("users.add.contactRequired")}</span>
                  </label>
                  <select
                    id="new-user-contact"
                    name="contactId"
                    defaultValue=""
                    className="w-full border border-gray-300 p-2.5 rounded-xl text-xs font-medium bg-white text-gray-900"
                  >
                    <option value="">{t("users.add.noContact")}</option>
                    {customers
                      .filter((c) => c.contacts.length > 0)
                      .map((c) => (
                        <optgroup key={c.id} label={c.name}>
                          {c.contacts.map((ct) => (
                            <option key={ct.id} value={ct.id}>
                              {ct.name}
                              {ct.role ? ` (${ct.role})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {t("users.add.contactHelp")}
                  </p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
                {t("users.add.info")}
              </div>
            </InviteActionForm>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b bg-gray-50/50 flex justify-between items-center">
              <h2 className="font-bold text-lg text-gray-800">{t("users.list.title")}</h2>
              <span className="text-xs font-bold text-gray-800 bg-gray-200 px-2.5 py-1 rounded-full">
                {t("users.list.count", { count: totalUsers })}
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {users.map((u) => {
                const isMe = u.email === currentUserEmail;
                const hasPendingInvite =
                  !!u.resetToken && !!u.resetTokenExpiry && u.resetTokenExpiry > new Date();
                // Bare administrator kan gjøre endringer på en administrator.
                const canManageTarget = isAdmin || u.role !== "ADMIN";
                const effective = effectivePermissions(u);
                const roleLabel = u.roleDefinition?.label ?? u.role;

                return (
                  <div key={u.id} className="p-5 flex flex-col gap-4 hover:bg-gray-50 transition">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-600">
                          {u.name?.charAt(0).toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 flex items-center gap-2">
                            {u.name || t("users.list.noName")}
                            {isMe && (
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold uppercase">
                                {t("users.list.thisIsYou")}
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500">{u.email}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            🔐 {roleLabel} • 🏷️{" "}
                            {u.department?.name || t("users.list.noDepartment")}
                          </p>
                          {u.customer && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              🏢 {u.customer.name}
                              {u.contact ? ` • ${u.contact.name}` : ""}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-xs font-bold px-2 py-1 rounded-full uppercase ${
                            u.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {u.isActive ? t("users.list.active") : t("users.list.inactive")}
                        </span>
                        {!u.password && (
                          <span className="text-xs font-bold px-2 py-1 rounded-full uppercase bg-gray-100 text-gray-600">
                            {t("users.list.missingPassword")}
                          </span>
                        )}
                        {hasPendingInvite && (
                          <span className="text-xs font-bold px-2 py-1 rounded-full uppercase bg-blue-100 text-blue-800">
                            {t("users.list.invited")}
                          </span>
                        )}
                      </div>
                    </div>

                    {canManageTarget && (
                    <>
                    <div className="flex flex-wrap items-center gap-3">
                      <form action={changeRole} className="flex items-center gap-2">
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="id" value={u.id} />
                        <select
                          name="role"
                          aria-label={`${t("users.add.role")}: ${u.name || u.email || u.id}`}
                          defaultValue={u.role}
                          disabled={isMe}
                          className="text-xs font-bold border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900"
                        >
                          {!roles.some((role) => role.key === u.role) && (
                            <option value={u.role}>{roleLabel}</option>
                          )}
                          {roles.map((role) => (
                            <option key={role.key} value={role.key}>
                              {role.label}
                            </option>
                          ))}
                        </select>

                        {!isMe && (
                          <button
                            type="submit"
                            className="text-xs font-bold bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                          >
                            {t("users.list.saveRole")}
                          </button>
                        )}
                      </form>

                      {isAdmin && (
                        <form action={changeDepartment} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <select
                            name="departmentId"
                            aria-label={`${t("users.add.department")}: ${u.name || u.email || u.id}`}
                            defaultValue={u.departmentId ?? ""}
                            disabled={u.role === "CUSTOMER"}
                            className="text-xs font-bold border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900"
                          >
                            <option value="">{t("users.list.noDepartmentOption")}</option>
                            {departments.map((department) => (
                              <option key={department.id} value={department.id}>
                                {department.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="text-xs font-bold bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                          >
                            {t("users.list.saveDepartment")}
                          </button>
                        </form>
                      )}

                      {isAdmin && (
                        <form action={changePhone} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <input
                            type="tel"
                            name="phone"
                            defaultValue={u.phone ?? ""}
                            placeholder={t("users.list.phonePlaceholder")}
                            className="text-xs font-bold border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900 w-32"
                          />
                          <button
                            type="submit"
                            className="text-xs font-bold bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                          >
                            {t("users.list.savePhone")}
                          </button>
                        </form>
                      )}

                      {!isMe && (
                        <InviteActionForm
                          action={generateInvite}
                          wrapperClassName="contents"
                          submitLabel={`🔗 ${t("users.list.inviteLink")}`}
                          buttonClassName="text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-700 hover:text-white transition"
                          bannerClassName="w-full rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-900"
                          labels={{
                            ready: t("users.invite.ready", { name: "{name}" }),
                            sent: t("users.invite.sent"),
                            manual: t("users.invite.manual"),
                            copy: t("users.invite.copy"),
                            error: t("users.invite.failed"),
                          }}
                        >
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                        </InviteActionForm>
                      )}

                      {!isMe && (
                        <form action={setActive}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={u.isActive ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                              u.isActive
                                ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                                : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                            }`}
                          >
                            {u.isActive
                              ? t("users.list.deactivate")
                              : t("users.list.activate")}
                          </button>
                        </form>
                      )}

                      {!isMe && isAdmin && u.isTwoFactorEnabled && (
                        <ConfirmSubmitForm
                          action={resetTwoFactor}
                          confirmMessage={t("users.list.resetTwoFactorConfirm", {
                            name: u.name || u.email || u.id,
                          })}
                          confirmLabel={t("users.list.resetTwoFactorLabel")}
                          danger
                        >
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition"
                            title={t("users.list.resetTwoFactorHint")}
                          >
                            {t("users.list.resetTwoFactor")}
                          </button>
                        </ConfirmSubmitForm>
                      )}

                      {!isMe && isAdmin && (
                        <ConfirmSubmitForm
                          action={deleteUser}
                          confirmMessage={t("components.confirm.deleteUser", {
                            name: u.name || u.email || u.id,
                          })}
                          confirmLabel={t("components.confirm.deleteUserLabel")}
                          danger
                        >
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition"
                            title={t("users.list.deleteUser")}
                          >
                            🗑️
                          </button>
                        </ConfirmSubmitForm>
                      )}
                    </div>

                    {isAdmin && (
                      <form action={changePermissions} className="border-t border-gray-100 pt-3 space-y-3">
                        <input type="hidden" name="id" value={u.id} />
                        {u.role === "ADMIN" || u.role === "CUSTOMER" ? (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                            {u.role === "ADMIN"
                              ? t("users.list.adminHint")
                              : t("users.list.customerHint")}
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold text-gray-800">
                                  {t("users.list.permissionsTitle")}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {t("users.list.permissionsDesc")}
                                </p>
                              </div>
                              {u.permissionsCustomized && (
                                <span className="text-xs font-bold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full uppercase">
                                  {t("users.list.customized")}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {permissionGroups.map((group) => (
                                <fieldset
                                  key={group.group}
                                  className="border border-gray-200 rounded-xl p-3"
                                >
                                  <legend className="px-1 text-xs font-bold text-gray-500 uppercase">
                                    {group.group}
                                  </legend>
                                  <div className="space-y-2">
                                    {group.permissions.map((permission) => (
                                      <label
                                        key={permission.key}
                                        className="flex items-start gap-2 text-xs text-gray-700"
                                        title={permission.description}
                                      >
                                        <input
                                          type="checkbox"
                                          name="permissions"
                                          value={permission.key}
                                          defaultChecked={effective.has(
                                            permission.key,
                                          )}
                                          className="mt-0.5"
                                        />
                                        <span>
                                          <span className="font-semibold">
                                            {permission.label}
                                          </span>
                                          <span className="block text-xs text-gray-500">
                                            {permission.description}
                                          </span>
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </fieldset>
                              ))}
                            </div>
                            <button
                              type="submit"
                              className="text-xs font-bold bg-purple-700 text-white px-3 py-1.5 rounded-lg hover:bg-purple-800 transition"
                            >
                              {t("users.list.savePermissions")}
                            </button>
                          </>
                        )}
                      </form>
                    )}

                    {isAdmin && u.permissionsCustomized &&
                      u.role !== "ADMIN" && u.role !== "CUSTOMER" && (
                        <form action={resetPermissions}>
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-xs font-bold bg-gray-100 text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
                          >
                            {t("users.list.useRolePermissions")}
                          </button>
                        </form>
                      )}
                    </>
                    )}
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 p-4 border-t border-gray-100">
                {safePage > 1 && (
                  <Link
                    href={`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}side=${safePage - 1}`}
                    className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition"
                  >
                    ← {t("users.list.previous")}
                  </Link>
                )}
                <span className="text-sm font-bold text-gray-600">
                  {t("users.list.page", { page: safePage, totalPages })}
                </span>
                {safePage < totalPages && (
                  <Link
                    href={`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}side=${safePage + 1}`}
                    className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition"
                  >
                    {t("users.list.next")} →
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
