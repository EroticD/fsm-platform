import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import InviteActionForm from "@/components/InviteActionForm";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
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
    groupKey:
      PERMISSIONS.find((permission) => permission.group === group)?.groupKey ??
      "settings.permissions.groups.administration",
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
    "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ink,#101310)] sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden";
  const summaryChevronClass =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted,#62685f)] transition-transform group-open:rotate-180";
  const fieldClass = controlClassName("min-h-10 text-xs font-bold");
  const formLabelClass =
    "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
  const actionButtonClass =
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-1";
  const statusBadgeClass =
    "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-bold uppercase";
  const infoBoxClass =
    "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-xs text-[var(--muted,#62685f)]";
  const inputClass = controlClassName("min-h-11 text-sm font-medium");
  const inkButton =
    "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--ink,#101310)] bg-transparent px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-1";
  const dangerButton =
    "inline-flex min-h-9 items-center justify-center rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--risk,#f04427)] focus-visible:ring-offset-1";

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      {isAdmin && (
        <div className="office-card relative flex flex-col justify-between gap-3 overflow-hidden p-4 pl-5 sm:flex-row sm:items-center">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-[var(--signal,#d8ff3e)]"
          />
          <div>
            <p className="text-sm font-bold text-[var(--ink,#101310)]">
              {t("users.roles.title")}
            </p>
            <p className="text-xs text-[var(--muted,#62685f)]">
              {t("users.roles.description")}
            </p>
          </div>
          <Link
            href="/innstillinger?tab=roller"
            className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[#cbef35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-2"
          >
            {t("users.roles.manage")} →
          </Link>
        </div>
      )}

      <details className="group office-card">
        <summary className={summaryClass}>
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
          >
            <Icon name="plus" className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-[var(--ink,#101310)]">
              {t("users.add.title")}
            </span>
          </span>
          <span aria-hidden="true" className={summaryChevronClass}>
            <Icon name="chevronDown" className="h-4 w-4" />
          </span>
        </summary>

        <div className="border-t border-[var(--line,#dedcd1)] p-4 sm:p-6">
          <InviteActionForm
            action={createUser}
            formClassName="space-y-4"
            submitLabel={t("users.add.submit")}
            buttonClassName="signal-button mt-2 w-full text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-2"
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
                <label htmlFor="new-user-name" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">{t("users.add.fullName")}</label>
                <input
                  id="new-user-name"
                  type="text"
                  name="name"
                  required
                  placeholder={t("users.add.namePlaceholder")}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="new-user-email" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">{t("users.add.email")}</label>
                <input
                  id="new-user-email"
                  type="email"
                  name="email"
                  required
                  placeholder={t("users.add.emailPlaceholder")}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="new-user-phone" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">{t("users.add.phone")} <span className="font-normal normal-case tracking-normal text-[var(--muted,#62685f)]">{t("users.add.optional")}</span></label>
                <input
                  id="new-user-phone"
                  type="tel"
                  name="phone"
                  placeholder={t("users.add.phonePlaceholder")}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="new-user-role" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  {t("users.add.role")}
                </label>
                <select
                  id="new-user-role"
                  name="role"
                  defaultValue={defaultRole?.key ?? ""}
                  className={inputClass}
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                      {role.key === "CUSTOMER" ? t("users.add.customerSuffix") : ""}
                    </option>
                  ))}
                </select>
                {roles.length === 0 && (
                  <p className="mt-1 text-xs text-[var(--risk-text,#b42318)]">
                    {t("users.add.noRoles")}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="new-user-department" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  {t("users.add.department")}
                </label>
                <select
                  id="new-user-department"
                  name="departmentId"
                  defaultValue={defaultDepartment?.id ?? ""}
                  className={inputClass}
                >
                  <option value="">{t("users.add.noDepartment")}</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.isDefault ? t("users.add.defaultSuffix") : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                  {t("users.add.departmentHelp")}
                </p>
              </div>
              {canManageCustomers && (
                <div>
                  <label htmlFor="new-user-contact" className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("users.add.contact")}{" "}
                    <span className="font-normal normal-case tracking-normal text-[var(--muted,#62685f)]">{t("users.add.contactRequired")}</span>
                  </label>
                  <select
                    id="new-user-contact"
                    name="contactId"
                    defaultValue=""
                    className={controlClassName("min-h-11 text-xs font-medium")}
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
                  <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                    {t("users.add.contactHelp")}
                  </p>
                </div>
              )}
            </div>

            <div className={infoBoxClass}>
              {t("users.add.info")}
            </div>
          </InviteActionForm>
        </div>
      </details>

      <div className="office-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
            <Icon name="users" className="h-4 w-4 shrink-0" />
            {t("users.list.title")}
          </h2>
          <span className="whitespace-nowrap rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold text-[var(--ink,#101310)]">
            {t("users.list.count", { count: totalUsers })}
          </span>
        </div>

        <div className="divide-y divide-[var(--line,#dedcd1)]">
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-xs font-bold text-[var(--ink,#101310)] sm:h-9 sm:w-9 sm:text-sm"
                  >
                    {u.name?.charAt(0).toUpperCase() || "?"}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-bold text-[var(--ink,#101310)]">
                        {u.name || t("users.list.noName")}
                      </span>
                      {isMe && (
                        <span className="inline-flex shrink-0 rounded border border-[#c7d98e] bg-[#f3fbd1] px-1.5 py-0.5 text-xs font-bold uppercase text-[#283509]">
                          <span className="sm:hidden">
                            {t("users.list.thisIsYouShort")}
                          </span>
                          <span className="hidden sm:inline">
                            {t("users.list.thisIsYou")}
                          </span>
                        </span>
                      )}
                      <span className="hidden min-w-0 truncate text-xs text-[var(--muted,#62685f)] sm:inline">
                        {u.email}
                      </span>
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                      <span className="min-w-0 truncate font-semibold text-[var(--ink,#101310)]">
                        {roleLabel}
                      </span>
                      <span aria-hidden="true">•</span>
                      <span className="min-w-0 truncate">{locationLabel}</span>
                    </span>
                  </span>

                  {hasPendingInvite && (
                    <span className={`${statusBadgeClass} hidden border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)] sm:inline-flex`}>
                      {t("users.list.invited")}
                    </span>
                  )}
                  <span
                    className={`${statusBadgeClass} ${
                      u.isActive
                        ? "border-[#c7d98e] bg-[#f3fbd1] text-[#283509]"
                        : "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05]"
                    }`}
                  >
                    {u.isActive ? t("users.list.active") : t("users.list.inactive")}
                  </span>

                  <span aria-hidden="true" className={summaryChevronClass}>
                    <Icon name="chevronDown" className="h-4 w-4" />
                  </span>
                </summary>

                <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--muted,#62685f)]">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{u.email}</span>
                    </span>
                    {isMe && (
                      <span className={`${statusBadgeClass} border-[#c7d98e] bg-[#f3fbd1] text-[#283509] sm:hidden`}>
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
                      <span className={`${statusBadgeClass} border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--muted,#62685f)]`}>
                        {t("users.list.missingPassword")}
                      </span>
                    )}
                    {hasPendingInvite && (
                      <span className={`${statusBadgeClass} border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]`}>
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
                              className={inkButton}
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
                              className={inkButton}
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
                              className={inkButton}
                            >
                              {t("users.list.savePhone")}
                            </button>
                          </form>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line,#dedcd1)] pt-4">
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
                            buttonClassName={`${actionButtonClass} border-[var(--ink,#101310)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]`}
                            bannerClassName="w-full rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] p-3 text-xs text-[var(--ink,#101310)]"
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
                                  ? "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05] hover:bg-[#f6e8c5]"
                                  : "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] hover:bg-[#cbef35]"
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
                              className={`${actionButtonClass} border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05] hover:bg-[#f6e8c5]`}
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
                              className={dangerButton}
                              title={t("users.list.deleteUser")}
                            >
                              <Icon name="trash" className="h-4 w-4" />
                            </button>
                          </ConfirmSubmitForm>
                        )}
                      </div>

                      {isAdmin && (
                        <form action={changePermissions} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
                          <input type="hidden" name="id" value={u.id} />
                          {u.role === "ADMIN" || u.role === "CUSTOMER" ? (
                            <div className="rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] p-3 text-xs text-[#6b4a05]">
                              {u.role === "ADMIN"
                                ? t("users.list.adminHint")
                                : t("users.list.customerHint")}
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-bold text-[var(--ink,#101310)]">
                                    {t("users.list.permissionsTitle")}
                                  </p>
                                  <p className="text-xs text-[var(--muted,#62685f)]">
                                    {t("users.list.permissionsDesc")}
                                  </p>
                                </div>
                                {u.permissionsCustomized && (
                                  <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold uppercase text-[var(--ink,#101310)]">
                                    {t("users.list.customized")}
                                  </span>
                                )}
                              </div>
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
                                            defaultChecked={effective.has(
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
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  </fieldset>
                                ))}
                              </div>
                              <button
                                type="submit"
                                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 text-xs font-bold text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:shadow-[1px_1px_0_var(--ink,#101310)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)] focus-visible:ring-offset-1"
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
                              className={inkButton}
                            >
                              {t("users.list.useRolePermissions")}
                            </button>
                          </form>
                        )}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--muted,#62685f)]">
                      {t("users.list.readOnly")}
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="border-t border-[var(--line,#dedcd1)] p-4">
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
