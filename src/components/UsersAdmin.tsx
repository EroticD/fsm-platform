import Link from "next/link";
import prisma from "@/lib/prisma";
import { buildInviteUrl } from "@/lib/invite";
import CopyButton from "@/components/CopyButton";
import {
  createUser,
  deleteUser,
  changeRole,
  changeDepartment,
  changePhone,
  changePermissions,
  resetPermissions,
  setActive,
  generateInvite,
} from "@/app/brukere/actions";
import { effectivePermissions, PERMISSIONS } from "@/lib/permissions";

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
  invite,
  inviteToken,
  error,
  mail,
  page = 1,
  pageSize = 25,
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
  invite?: string;
  inviteToken?: string;
  error?: string;
  mail?: string;
  page?: number;
  pageSize?: number;
  baseUrl?: string;
}) {
  // Administrator ser alle. Avdelingsansvarlige ser bare egen avdeling, slik
  // at brukeradministrasjon ikke blir en vei rundt avdelingssperren.
  const where = isAdmin ? {} : { departmentId: departmentId ?? "__ingen_avdeling__" };
  const safePage = Math.max(1, page);
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
        orderBy: { name: "asc" },
        include: { contacts: { orderBy: { name: "asc" } } },
      })
    : [];

  // Brukeren vi nettopp lagde invitasjonslenke for (vises i banneret øverst).
  // Selve nøkkelen lagres bare som hash, så den rå lenken kommer i redirecten.
  const inviteUser = invite ? users.find((u) => u.id === invite) : undefined;
  const inviteUrl = inviteToken ? buildInviteUrl(inviteToken) : null;

  const errorMessage =
    error === "mangler_kontakt"
      ? "Kundeportalbrukere må kobles til en kontaktperson på kundekortet."
      : error === "epost_finnes"
        ? "Det finnes allerede en bruker med denne e-postadressen."
        : error === "mangler_felt"
          ? "Fyll ut navn, e-post og velg en kontaktperson."
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
              Roller og rettigheter
            </p>
            <p className="text-xs text-purple-700">
              Opprett egne roller, endre rettighetene deres, eller fjern roller
              som ikke er i bruk.
            </p>
          </div>
          <Link
            href="/innstillinger?tab=roller"
            className="text-xs font-bold bg-purple-700 text-white px-3 py-2 rounded-lg hover:bg-purple-800 transition whitespace-nowrap"
          >
            Administrer roller →
          </Link>
        </div>
      )}

      {inviteUser && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
          <h2 className="font-bold text-green-900 mb-1">
            ✅ Invitasjon klar for {inviteUser.name || inviteUser.email}
          </h2>
          <p className="text-sm text-green-800 mb-3">
            {mail === "sent"
              ? "Invitasjons-e-posten er sendt. Brukeren setter sitt eget passord, og kontoen aktiveres av deg etterpå."
              : "E-posten kunne ikke sendes (sjekk SMTP-innstillingene i .env), så send denne lenken til brukeren manuelt. De setter sitt eget passord, og kontoen aktiveres av deg etterpå."}
          </p>
          {inviteUrl ? (
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 bg-white border border-green-300 rounded-lg px-3 py-2 text-xs text-gray-700 font-mono"
              />
              <CopyButton value={inviteUrl} label="Kopier lenke" />
            </div>
          ) : (
            <p className="text-sm text-red-700 font-semibold">
              Ingen gyldig lenke funnet. Trykk «Invitasjonslenke» for å lage en ny.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-8">
            <h2 className="font-bold text-lg text-gray-800 border-b pb-2 mb-4">
              ➕ Legg til ny bruker
            </h2>

            <form action={createUser} className="space-y-4">
              <input type="hidden" name="returnTo" value={returnTo} />
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Fullt navn</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="F.eks. Kari Nordmann"
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">E-postadresse</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="kari@bedriften.no"
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Telefon <span className="font-normal text-gray-400">(valgfritt)</span></label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="F.eks. 900 00 000"
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Rolle / Tilgangsnivå
                </label>
                <select
                  name="role"
                  defaultValue={defaultRole?.key ?? ""}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900"
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                      {role.key === "CUSTOMER" ? " (kundedata)" : ""}
                    </option>
                  ))}
                </select>
                {roles.length === 0 && (
                  <p className="text-[11px] text-red-600 mt-1">
                    Ingen roller er tilgjengelige. Be en administrator opprette
                    eller tildele en rolle.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Avdeling
                </label>
                <select
                  name="departmentId"
                  defaultValue={defaultDepartment?.id ?? ""}
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900"
                >
                  <option value="">-- Ingen avdeling --</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.isDefault ? " (standard)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Ansatte må være i en avdeling for å kunne opprette og se oppdrag.
                </p>
              </div>
              {canManageCustomers && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Kontaktperson{" "}
                    <span className="font-normal text-gray-400">(påkrevd for kundeportal)</span>
                  </label>
                  <select
                    name="contactId"
                    defaultValue=""
                    className="w-full border border-gray-300 p-2.5 rounded-xl text-xs font-medium bg-white text-gray-900"
                  >
                    <option value="">-- Ingen kontaktperson --</option>
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
                  <p className="text-[11px] text-gray-500 mt-1">
                    Kobler brukeren til kunden og gir tilgang til kundeportalen.
                  </p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-800">
                Nye brukere er inaktive. Etter at du har opprettet dem får du en invitasjonslenke de
                kan bruke til å sette eget passord. Deretter må du aktivere kontoen her.
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition mt-2"
              >
                Opprett og lag invitasjon
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b bg-gray-50/50 flex justify-between items-center">
              <h2 className="font-bold text-lg text-gray-800">Alle brukere i systemet</h2>
              <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2.5 py-1 rounded-full">
                {totalUsers} stk
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
                            {u.name || "Uten navn"}
                            {isMe && (
                              <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold uppercase">
                                Det er deg
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500">{u.email}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            🔐 {roleLabel} • 🏷️{" "}
                            {u.department?.name || "Ingen avdeling"}
                          </p>
                          {u.customer && (
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              🏢 {u.customer.name}
                              {u.contact ? ` • ${u.contact.name}` : ""}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${
                            u.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {u.isActive ? "Aktiv" : "Inaktiv"}
                        </span>
                        {!u.password && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase bg-gray-100 text-gray-600">
                            Mangler passord
                          </span>
                        )}
                        {hasPendingInvite && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase bg-blue-100 text-blue-800">
                            Invitert
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
                          defaultValue={u.role}
                          disabled={isMe}
                          className="text-xs font-bold border border-gray-300 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-900"
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
                            className="text-[10px] font-bold bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                          >
                            Lagre rolle
                          </button>
                        )}
                      </form>

                      {isAdmin && (
                        <form action={changeDepartment} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <select
                            name="departmentId"
                            defaultValue={u.departmentId ?? ""}
                            disabled={u.role === "CUSTOMER"}
                            className="text-xs font-bold border border-gray-300 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-900"
                          >
                            <option value="">Ingen avdeling</option>
                            {departments.map((department) => (
                              <option key={department.id} value={department.id}>
                                {department.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="text-[10px] font-bold bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                          >
                            Lagre avdeling
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
                            placeholder="Telefon"
                            className="text-xs font-bold border border-gray-300 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-900 w-32"
                          />
                          <button
                            type="submit"
                            className="text-[10px] font-bold bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                          >
                            Lagre tlf.
                          </button>
                        </form>
                      )}

                      {!isMe && (
                        <form action={generateInvite}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-700 hover:text-white transition"
                          >
                            🔗 Invitasjonslenke
                          </button>
                        </form>
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
                            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                              u.isActive
                                ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                                : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                            }`}
                          >
                            {u.isActive ? "Deaktiver" : "Aktiver"}
                          </button>
                        </form>
                      )}

                      {!isMe && isAdmin && (
                        <form action={deleteUser}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition"
                            title="Slett bruker"
                          >
                            🗑️
                          </button>
                        </form>
                      )}
                    </div>

                    {isAdmin && (
                      <form action={changePermissions} className="border-t border-gray-100 pt-3 space-y-3">
                        <input type="hidden" name="id" value={u.id} />
                        {u.role === "ADMIN" || u.role === "CUSTOMER" ? (
                          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800">
                            {u.role === "ADMIN"
                              ? "Administrator har alltid alle rettigheter, uavhengig av rollens liste."
                              : "Kundeportalbrukere styres av kundetilknytningen, ikke av interne rettigheter."}
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-bold text-gray-800">
                                  Rettigheter for denne brukeren
                                </p>
                                <p className="text-[11px] text-gray-500">
                                  Listen overstyrer rollen. La stå lik rollens
                                  rettigheter for å følge rollen videre.
                                </p>
                              </div>
                              {u.permissionsCustomized && (
                                <span className="text-[10px] font-bold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full uppercase">
                                  Tilpasset
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {permissionGroups.map((group) => (
                                <fieldset
                                  key={group.group}
                                  className="border border-gray-200 rounded-xl p-3"
                                >
                                  <legend className="px-1 text-[11px] font-bold text-gray-500 uppercase">
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
                                          <span className="block text-[11px] text-gray-500">
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
                              className="text-[10px] font-bold bg-purple-700 text-white px-3 py-1.5 rounded-lg hover:bg-purple-800 transition"
                            >
                              Lagre rettigheter
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
                            className="text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
                          >
                            Bruk rollens rettigheter
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
                    ← Forrige
                  </Link>
                )}
                <span className="text-sm font-bold text-gray-600">
                  Side {safePage} av {totalPages}
                </span>
                {safePage < totalPages && (
                  <Link
                    href={`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}side=${safePage + 1}`}
                    className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition"
                  >
                    Neste →
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
