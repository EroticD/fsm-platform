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
  isActive: boolean;
  isDefault: boolean;
  users: number;
  workOrders: number;
  contracts: number;
};

export default function DepartmentsAdmin({ departments }: { departments: DepartmentRow[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-8">
          <h2 className="font-bold text-lg text-gray-800 border-b pb-2 mb-4">
            ➕ Ny avdeling
          </h2>
          <form action={createDepartment} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Navn</label>
              <input
                type="text"
                name="name"
                required
                placeholder="F.eks. Bergen"
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Beskrivelse <span className="font-normal text-gray-400">(valgfritt)</span>
              </label>
              <input
                type="text"
                name="description"
                placeholder="F.eks. service på Vestlandet"
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-800">
              Oppdrag, serviceavtaler og ansatte knyttes til en avdeling. Kunder,
              dokumenter og rapporter er fortsatt felles for alle.
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition"
            >
              Opprett avdeling
            </button>
          </form>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {departments.length === 0 && (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 text-sm text-gray-500">
            Det finnes ingen avdelinger ennå.
          </div>
        )}

        {departments.map((department) => (
          <div
            key={department.id}
            className={`bg-white p-5 rounded-2xl shadow-sm border ${
              department.isDefault ? "border-blue-300" : "border-gray-100"
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900 flex flex-wrap items-center gap-2">
                  🏷️ {department.name}
                  {department.isDefault && (
                    <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold uppercase">
                      Standard
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                      department.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {department.isActive ? "Aktiv" : "Inaktiv"}
                  </span>
                </h3>
                {department.description && (
                  <p className="text-sm text-gray-500 mt-1">{department.description}</p>
                )}
                <p className="text-[11px] text-gray-500 mt-2">
                  👥 {department.users} ansatte • 📋 {department.workOrders} oppdrag • 📄{" "}
                  {department.contracts} serviceavtaler
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!department.isDefault && department.isActive && (
                  <form action={setDefaultDepartment}>
                    <input type="hidden" name="id" value={department.id} />
                    <button
                      type="submit"
                      className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition"
                    >
                      Sett som standard
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
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                        department.isActive
                          ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                          : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                      }`}
                    >
                      {department.isActive ? "Deaktiver" : "Aktiver"}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <details className="mt-4 group">
              <summary className="text-xs font-bold text-blue-700 cursor-pointer select-none">
                Rediger avdeling
              </summary>
              <form action={updateDepartment} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input type="hidden" name="id" value={department.id} />
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Navn</label>
                  <input
                    type="text"
                    name="name"
                    required
                    defaultValue={department.name}
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
                    defaultValue={department.description ?? ""}
                    className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition"
                  >
                    Lagre endringer
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
