import { formatDate } from "@/lib/dates";
import UnitHistory from "@/components/UnitHistory";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";

type Product = CustomerDetailData["products"][number];
type ReportUnit = Product["reportUnits"][number];

/** Datoen for den nyeste servicen på en enhet (eller null hvis den aldri er kontrollert). */
function lastServiceDate(entries: ReportUnit[]) {
  const times = entries
    .map((entry) => entry.report.workOrder.scheduledFor ?? entry.report.createdAt)
    .filter((value): value is Date => Boolean(value))
    .map((value) => new Date(value).getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

type UnitsTabProps = {
  customerId: string;
  products: CustomerDetailData["products"];
  canManageEquipment: boolean;
  isAdmin: boolean;
  createUnit: (formData: FormData) => Promise<void>;
  updateUnit: (formData: FormData) => Promise<void>;
  deleteUnit: (formData: FormData) => Promise<void>;
};

export default function CustomerUnitsTab({
  customerId,
  products,
  canManageEquipment,
  isAdmin,
  createUnit,
  updateUnit,
  deleteUnit,
}: UnitsTabProps) {
  return (
    <CustomerTabPanel
      title="🔧 Utstyr / enheter"
      description="Maskinene og utstyret kunden har. Enhetene kan velges når montøren fyller ut en servicerapport, og rapporten husker hvilke enheter som ble kontrollert."
    >
      {/* Skjema for ny enhet – krever equipment.manage */}
      {canManageEquipment && (
        <form action={createUnit} className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Betegnelse *</label>
              <input type="text" name="model" required placeholder="F.eks. Port Nord" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Serienummer</label>
              <input type="text" name="serialNumber" placeholder="F.eks. 12-3456" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Plassering</label>
              <input type="text" name="location" placeholder="F.eks. Bygg A, plan 2" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm whitespace-nowrap">
            Legg til enhet
          </button>
        </form>
      )}

      {products.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Ingen registrerte enheter på denne kunden.</p>
      ) : (
        <div className="space-y-2">
          {products.map((unit) => (
            <div key={unit.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <details className="flex-1 min-w-0">
                  <summary className="cursor-pointer list-none">
                    <span className="font-bold text-gray-900 text-sm">{unit.model}</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">
                      {unit.serialNumber ? `SN: ${unit.serialNumber}` : "Uten serienummer"}
                      {unit.location ? ` • ${unit.location}` : ""}
                    </span>
                    <span className="block text-[11px] mt-1">
                      {unit._count.reportUnits === 0 ? (
                        <span className="text-gray-400">🕓 Aldri kontrollert</span>
                      ) : (
                        <span className="text-blue-800 font-bold">
                          🕓 {unit._count.reportUnits}{" "}
                          {unit._count.reportUnits === 1 ? "service" : "servicer"} • siste{" "}
                          {formatDate(lastServiceDate(unit.reportUnits), "Ingen dato")}
                        </span>
                      )}
                      <span className="ml-2 text-blue-600 font-bold">
                        ▾ Vis historikk og redigering
                      </span>
                    </span>
                  </summary>

                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <p className="text-[11px] font-black text-gray-600 uppercase tracking-wider mb-2">
                      🕓 Servicehistorikk ({unit._count.reportUnits})
                    </p>
                    {unit._count.reportUnits > unit.reportUnits.length && (
                      <p className="text-[10px] text-gray-500 mb-2">
                        Viser de {unit.reportUnits.length} nyeste av {unit._count.reportUnits} kontroller.
                      </p>
                    )}
                    <UnitHistory entries={unit.reportUnits} />
                  </div>

                  {canManageEquipment && (
                    <details className="mt-3 border-t border-gray-200 pt-3">
                      <summary className="cursor-pointer text-[11px] font-black text-gray-600 uppercase tracking-wider">
                        ✏️ Endre enhet
                      </summary>

                      <form action={updateUnit} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                        <input type="hidden" name="customerId" value={customerId} />
                        <input type="hidden" name="id" value={unit.id} />
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Betegnelse *</label>
                          <input type="text" name="model" required defaultValue={unit.model} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Serienummer</label>
                          <input type="text" name="serialNumber" defaultValue={unit.serialNumber || ""} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Plassering</label>
                          <input type="text" name="location" defaultValue={unit.location || ""} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                        </div>
                        <div className="sm:col-span-3 flex justify-end">
                          <button type="submit" className="bg-gray-900 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-800 transition">
                            Lagre endringer
                          </button>
                        </div>
                      </form>
                    </details>
                  )}
                </details>

                {isAdmin && (
                  <form action={deleteUnit}>
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="id" value={unit.id} />
                    <button type="submit" title="Slett enhet" className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition">
                      🗑️
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </CustomerTabPanel>
  );
}
