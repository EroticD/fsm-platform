import prisma from "@/lib/prisma";
import { buildInviteUrl } from "@/lib/invite";
import CopyButton from "@/components/CopyButton";
import {
  createUser,
  deleteUser,
  changeRole,
  changeDepartment,
  changePermissions,
  setActive,
  generateInvite,
} from "@/app/brukere/actions";
import {
  effectivePermissions,
  defaultPermissionsForRole,
  PERMISSIONS,
} from "@/lib/permissions";

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
  invite,
  inviteToken,
  error,
  mail,
}: {
  returnTo: string;
  currentUserEmail?: string | null;
  isAdmin?: boolean;
  /** Avdelingen en ikke-administrator får administrere brukere i. */
  departmentId?: string | null;
  /** Kundeportalbrukere krever customers.manage. */
  canManageCustomers?: boolean;
  invite?: string;
  inviteToken?: string;
  error?: string;
  mail?: string;
}) {
  // Administrator ser alle. Avdelingsansvarlige ser bare egen avdeling, slik
  // at brukeradministrasjon ikke blir en vei rundt avdelingssperren.
  const users = await prisma.user.findMany({
    where: isAdmin ? {} : { departmentId: departmentId ?? "__ingen_avdeling__" },
    orderBy: { name: "asc" },
    include: { contact: true, customer: true, department: true },
  });

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
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Rolle / Tilgangsnivå
                </label>
                <select
                  name="role"
                  className="w-full border border-gray-300 p-2.5 rounded-xl text-sm font-medium bg-white text-gray-900"
                >
                  <option value="TECHNICIAN">📱 Montør (Kun felt-portal)</option>
                  {isAdmin && (
                    <option value="ADMIN">🎛️ Kontor / Admin (Full tilgang)</option>
                  )}
                  <option value="OFFICE">🏢 Kontor (Administrasjon, ingen logg)</option>
                  <option value="USER">🔒 Standard (Ingen tilgang)</option>
                  {canManageCustomers && (
                    <option value="CUSTOMER">👤 Kundeportal (Kundedata)</option>
                  )}
                </select>
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
                {users.length} stk
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {users.map((u) => {
                const isMe = u.email === currentUserEmail;
                const hasPendingInvite =
                  !!u.resetToken && !!u.resetTokenExpiry && u.resetTokenExpiry > new Date();
                // Bare administrator kan gjøre endringer på en administrator.
                const canManageTarget = isAdmin || u.role !== "ADMIN";
                const defaults = new Set(defaultPermissionsForRole(u.role));
                const effective = effectivePermissions(u);

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
                            🏷️ {u.department?.name || "Ingen avdeling"}
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
                          className={`text-xs font-bold border rounded-lg px-2 py-1.5 outline-none bg-white text-gray-900 ${
                            u.role === "ADMIN"
                              ? "border-purple-300"
                              : u.role === "OFFICE"
                                ? "border-indigo-300"
                                : u.role === "TECHNICIAN"
                                  ? "border-blue-300"
                                  : u.role === "CUSTOMER"
                                    ? "border-green-300"
                                    : "border-gray-300"
                          }`}
                        >
                          {isAdmin && <option value="ADMIN">Admin</option>}
                          <option value="OFFICE">Kontor</option>
                          <option value="TECHNICIAN">Montør</option>
                          {canManageCustomers && (
                            <option value="CUSTOMER">Kundeportal</option>
                          )}
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

                      {!isMe && (
                        <form action={generateInvite}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition"
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
                        <div>
                          <p className="text-xs font-bold text-gray-800">Ekstra rettigheter</p>
                          <p className="text-[11px] text-gray-500">
                            Rettigheter som følger rollen er låst. Kryss av for å gi flere
                            rettigheter uten å endre rollen.
                          </p>
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
                                {group.permissions.map((permission) => {
                                  const roleDefault = defaults.has(permission.key);
                                  const checked = effective.has(permission.key);
                                  return (
                                    <label
                                      key={permission.key}
                                      className="flex items-start gap-2 text-xs text-gray-700"
                                      title={permission.description}
                                    >
                                      <input
                                        type="checkbox"
                                        name="permissions"
                                        value={permission.key}
                                        defaultChecked={checked && !roleDefault}
                                        disabled={roleDefault}
                                        className="mt-0.5"
                                      />
                                      <span>
                                        <span className="font-semibold">{permission.label}</span>
                                        {roleDefault && (
                                          <span className="ml-1 text-[10px] font-bold text-gray-400 uppercase">
                                            Rolle
                                          </span>
                                        )}
                                        <span className="block text-[11px] text-gray-500">
                                          {permission.description}
                                        </span>
                                      </span>
                                    </label>
                                  );
                                })}
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
                      </form>
                    )}
                    </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
