import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import InviteActionForm from "@/components/InviteActionForm";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
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
import { DEFAULT_PAGE_SIZE, pageWindow, parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";

/**
 * Brukeradministrasjon (ansatte, roller, aktivering og invitasjoner).
 * Brukes både av /brukere og av «Ansatte & Roller»-fanen i innstillinger.
 * `returnTo` gjør at handlingene sender deg tilbake til riktig side.
 *
 * Lista er bygget som kompakte `<details>`-rader. Bare raden som åpnes viser
 * skjemaene, slik at en side med mange ansatte ikke blir en vegg av kort.
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
  // Tell først, slik at en gammel `?side=999` havner på siste side med innhold.
  const totalUsers = await prisma.user.count({ where });
  const pageInfo = pageWindow(parsePage(page), totalUsers, pageSize);
  const users = await prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    take: pageInfo.take,
    skip: pageInfo.skip,
    include: {
      contact: true,
      customer: true,
      department: true,
      roleDefinition: true,
    },
  });
  const safePage = pageInfo.page;
  const totalPages = pageInfo.totalPages;

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

  const summaryClass =
    "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden";
  const summaryChevronClass =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-transform group-open:rotate-180";
  const fieldClass =
    "w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs font-bold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";
  const formLabelClass = "mb-1 block text-xs font-bold text-gray-600";
  const actionButtonClass =
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1";
  const statusBadgeClass =
    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold uppercase";

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
            className="text-xs font-bold bg-purple-700 text-white px-3 py-2 rounded-lg hover:bg-purple-800 transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-700 focus-visible:ring-offset-2"
          >
            {t("users.roles.manage")} →
          </Link>
        </div>
      )}

      <details className="group rounded-2xl border border-gray-100 bg-white shadow-sm">
        <summary className={summaryClass}>
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"
          >
            <Icon name="plus" className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-gray-800">
              {t("users.add.title")}
            </span>
          </span>
          <span aria-hidden="true" className={summaryChevronClass}>
            <Icon name="chevronDown" className="h-4 w-4" />
          </span>
        </summary>

        <div className="border-t border-gray-100 p-4 sm:p-6">
          <InviteActionForm
            action={createUser}
            formClassName="space-y-4"
            submitLabel={t("users.add.submit")}
            buttonClassName="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            labels={{
              ready: t("users.invite.ready", { name: "{name}" }),
              sent: t("users.invite.sent"),
              manual: t("users.invite.manual"),
              copy: t("users.invite.copy"),
              error: t("users.invite.failed"),
            }}
          >
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="new-user-name" className="block text-sm font-bold text-gray-700 mb-1">{t("users.add.fullName")}</label>
                <input
                  id="new-user-name"
                  type="text"
                  name="name"
                  required
                  placeholder={t("users.add.namePlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
              </div>
              <div>
                <label htmlFor="new-user-phone" className="block text-sm font-bold text-gray-700 mb-1">{t("users.add.phone")} <span className="font-normal text-gray-600">{t("users.add.optional")}</span></label>
                <input
                  id="new-user-phone"
                  type="tel"
                  name="phone"
                  placeholder={t("users.add.phonePlaceholder")}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
                    className="w-full border border-gray-300 p-2.5 rounded-xl text-xs font-medium bg-white text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
              {t("users.add.info")}
            </div>
          </InviteActionForm>
        </div>
      </details>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 sm:p-5 border-b bg-gray-50/50 flex justify-between items-center gap-3">
          <h2 className="font-bold text-lg text-gray-800">{t("users.list.title")}</h2>
          <span className="text-xs font-bold text-gray-800 bg-gray-200 px-2.5 py-1 rounded-full whitespace-nowrap">
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
            const locationLabel = u.customer
              ? u.customer.name
              : u.department?.name || t("users.list.noDepartment");

            return (
              <details key={u.id} className="group" data-user-row>
                <summary className={summaryClass}>
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600 sm:h-9 sm:w-9 sm:text-sm"
                  >
                    {u.name?.charAt(0).toUpperCase() || "?"}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-bold text-gray-900">
                        {u.name || t("users.list.noName")}
                      </span>
                      {isMe && (
                        <span className="inline-flex shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-bold uppercase text-blue-800">
                          <span className="sm:hidden">
                            {t("users.list.thisIsYouShort")}
                          </span>
                          <span className="hidden sm:inline">
                            {t("users.list.thisIsYou")}
                          </span>
                        </span>
                      )}
                      <span className="hidden min-w-0 truncate text-xs text-gray-500 sm:inline">
                        {u.email}
                      </span>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
                      <span className="min-w-0 truncate font-semibold text-gray-700">
                        {roleLabel}
                      </span>
                      <span aria-hidden="true">•</span>
                      <span className="min-w-0 truncate">{locationLabel}</span>
                    </span>
                  </span>

                  {hasPendingInvite && (
                    <span className={`${statusBadgeClass} hidden bg-blue-100 text-blue-800 sm:inline-flex`}>
                      {t("users.list.invited")}
                    </span>
                  )}
                  <span
                    className={`${statusBadgeClass} ${
                      u.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {u.isActive ? t("users.list.active") : t("users.list.inactive")}
                  </span>

                  <span aria-hidden="true" className={summaryChevronClass}>
                    <Icon name="chevronDown" className="h-4 w-4" />
                  </span>
                </summary>

                <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{u.email}</span>
                    </span>
                    {isMe && (
                      <span className={`${statusBadgeClass} bg-blue-100 text-blue-800 sm:hidden`}>
                        {t("users.list.thisIsYou")}
                      </span>
                    )}
                    {u.phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                        {u.phone}
                      </span>
                    )}
                    {u.customer && (
                      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                        <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate">
                          {u.customer.name}
                          {u.contact ? ` · ${u.contact.name}` : ""}
                        </span>
                      </span>
                    )}
                    {!u.password && (
                      <span className={`${statusBadgeClass} bg-gray-100 text-gray-600`}>
                        {t("users.list.missingPassword")}
                      </span>
                    )}
                    {hasPendingInvite && (
                      <span className={`${statusBadgeClass} bg-blue-100 text-blue-800`}>
                        {t("users.list.invited")}
                      </span>
                    )}
                  </div>

                  {canManageTarget ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <form action={changeRole} className="flex items-end gap-2">
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <label className="min-w-0 flex-1">
                            <span className={formLabelClass}>{t("users.add.role")}</span>
                            <select
                              name="role"
                              aria-label={`${t("users.add.role")}: ${u.name || u.email || u.id}`}
                              defaultValue={u.role}
                              disabled={isMe}
                              className={fieldClass}
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
                          </label>
                          {!isMe && (
                            <button
                              type="submit"
                              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-gray-800 px-3 text-xs font-bold text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1"
                            >
                              {t("users.list.saveRole")}
                            </button>
                          )}
                        </form>

                        {isAdmin && (
                          <form action={changeDepartment} className="flex items-end gap-2">
                            <input type="hidden" name="id" value={u.id} />
                            <label className="min-w-0 flex-1">
                              <span className={formLabelClass}>{t("users.add.department")}</span>
                              <select
                                name="departmentId"
                                aria-label={`${t("users.add.department")}: ${u.name || u.email || u.id}`}
                                defaultValue={u.departmentId ?? ""}
                                disabled={u.role === "CUSTOMER"}
                                className={fieldClass}
                              >
                                <option value="">{t("users.list.noDepartmentOption")}</option>
                                {departments.map((department) => (
                                  <option key={department.id} value={department.id}>
                                    {department.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-gray-800 px-3 text-xs font-bold text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1"
                            >
                              {t("users.list.saveDepartment")}
                            </button>
                          </form>
                        )}

                        {isAdmin && (
                          <form action={changePhone} className="flex items-end gap-2">
                            <input type="hidden" name="id" value={u.id} />
                            <label className="min-w-0 flex-1">
                              <span className={formLabelClass}>{t("users.add.phone")}</span>
                              <input
                                type="tel"
                                name="phone"
                                aria-label={`${t("users.add.phone")}: ${u.name || u.email || u.id}`}
                                defaultValue={u.phone ?? ""}
                                placeholder={t("users.list.phonePlaceholder")}
                                className={fieldClass}
                              />
                            </label>
                            <button
                              type="submit"
                              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-gray-800 px-3 text-xs font-bold text-white transition hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1"
                            >
                              {t("users.list.savePhone")}
                            </button>
                          </form>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
                        {!isMe && (
                          <InviteActionForm
                            action={generateInvite}
                            wrapperClassName="contents"
                            submitLabel={
                              <span className="inline-flex items-center gap-1.5">
                                <Icon name="mail" className="h-4 w-4" />
                                {t("users.list.inviteLink")}
                              </span>
                            }
                            buttonClassName={`${actionButtonClass} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-700 hover:text-white`}
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
                              className={`${actionButtonClass} ${
                                u.isActive
                                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : "border-green-600 bg-green-600 text-white hover:bg-green-700"
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
                              className={`${actionButtonClass} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
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
                              aria-label={`${t("users.list.deleteUser")}: ${u.name || u.email || u.id}`}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1"
                              title={t("users.list.deleteUser")}
                            >
                              <Icon name="trash" className="h-4 w-4" />
                            </button>
                          </ConfirmSubmitForm>
                        )}
                      </div>

                      {isAdmin && (
                        <form action={changePermissions} className="border-t border-gray-200 pt-4 space-y-3">
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
                                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-purple-700 px-3 text-xs font-bold text-white transition hover:bg-purple-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-700 focus-visible:ring-offset-1"
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
                              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 px-3 text-xs font-bold text-gray-700 transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1"
                            >
                              {t("users.list.useRolePermissions")}
                            </button>
                          </form>
                        )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-gray-500">
                      {t("users.list.readOnly")}
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="border-t border-gray-100 p-4">
            <Pagination
              page={safePage}
              totalPages={totalPages}
              hrefFor={(targetPage) => {
                const [path, query = ""] = baseUrl.split("?");
                const params = new URLSearchParams(query);
                params.set("side", String(targetPage));
                const qs = params.toString();
                return qs ? `${path}?${qs}` : path;
              }}
              labels={paginationLabels(t)}
              summary={t("users.list.page", {
                page: safePage,
                totalPages,
              })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
