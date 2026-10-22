import {
  createRole,
  deleteRole,
  updateRole,
} from "@/app/innstillinger/role-actions";
import { PERMISSIONS } from "@/lib/permissions";

type RoleRow = {
  key: string;
  label: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  users: number;
};

const ROLE_ERRORS: Record<string, string> = {
  mangler_navn: "Rollen må ha et navn.",
  rollen_finnes: "Det finnes allerede en rolle med dette navnet.",
  ukjent_rolle: "Rollen finnes ikke lenger.",
  systemrolle: "Systemroller kan ikke slettes.",
  rolle_i_bruk:
    "Rollen er i bruk. Flytt brukerne til en annen rolle før du sletter den.",
};

export default function RolesAdmin({
  roles,
  error,
  message,
}: {
  roles: RoleRow[];
  error?: string | null;
  message?: string | null;
}) {
  const permissionGroups = Array.from(
    new Set(PERMISSIONS.map((permission) => permission.group)),
  ).map((group) => ({
    group,
    permissions: PERMISSIONS.filter((permission) => permission.group === group),
  }));

  const lockedRole = (key: string) => key === "ADMIN" || key === "CUSTOMER";
  const messageText =
    message === "created"
      ? "Rollen ble opprettet."
      : message === "updated"
        ? "Rollen ble oppdatert."
        : message === "deleted"
          ? "Rollen ble slettet."
          : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-8">
          <h2 className="font-bold text-lg text-gray-800 border-b pb-2 mb-4">
            ➕ Ny rolle
          </h2>
          <form action={createRole} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Navn
              </label>
              <input
                type="text"
                name="label"
                required
                placeholder="F.eks. Serviceleder"
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Beskrivelse{" "}
                <span className="font-normal text-gray-400">(valgfritt)</span>
              </label>
              <input
                type="text"
                name="description"
                placeholder="Hva rollen brukes til"
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-800">Rettigheter</p>
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
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-semibold">{permission.label}</span>
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

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-800">
              Rollen får en fast nøkkel basert på navnet. Nøkkelen brukes internt
              og endres ikke hvis du senere endrer visningsnavnet.
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition"
            >
              Opprett rolle
            </button>
          </form>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {error && ROLE_ERRORS[error] && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-semibold">
            {ROLE_ERRORS[error]}
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
                    {role.label}
                    {role.isSystem && (
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-bold uppercase">
                        System
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                    {role.key}
                  </p>
                  {role.description && (
                    <p className="text-sm text-gray-500 mt-1">
                      {role.description}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-500 mt-2">
                    👥 {role.users} brukere • 🔑 {role.permissions.length}{" "}
                    rettigheter
                  </p>
                </div>

                {!role.isSystem && (
                  <form action={deleteRole}>
                    <input type="hidden" name="key" value={role.key} />
                    <button
                      type="submit"
                      disabled={role.users > 0}
                      className="text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      title={
                        role.users > 0
                          ? "Flytt brukerne til en annen rolle først"
                          : "Slett rollen"
                      }
                    >
                      Slett rolle
                    </button>
                  </form>
                )}
              </div>

              <details className="mt-4 group">
                <summary className="text-xs font-bold text-blue-700 cursor-pointer select-none">
                  Rediger rolle og rettigheter
                </summary>
                <form action={updateRole} className="mt-3 space-y-4">
                  <input type="hidden" name="key" value={role.key} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Visningsnavn
                      </label>
                      <input
                        type="text"
                        name="label"
                        required
                        defaultValue={role.label}
                        className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Beskrivelse
                      </label>
                      <input
                        type="text"
                        name="description"
                        defaultValue={role.description ?? ""}
                        className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
                      />
                    </div>
                  </div>

                  {locked ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800">
                      {role.key === "ADMIN"
                        ? "Administrator har alltid alle rettigheter. Rettighetslisten kan ikke endres."
                        : "Kundeportalbrukere styres av kundetilknytningen, ikke av interne rettigheter."}
                    </div>
                  ) : (
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
                                  defaultChecked={role.permissions.includes(
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
                  )}

                  <button
                    type="submit"
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition"
                  >
                    Lagre rolle
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
