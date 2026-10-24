import { getTranslations } from "next-intl/server";
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

export default async function CustomerUnitsTab({
  customerId,
  products,
  canManageEquipment,
  isAdmin,
  createUnit,
  updateUnit,
  deleteUnit,
}: UnitsTabProps) {
  const t = await getTranslations("common");

  return (
    <CustomerTabPanel
      title={`🔧 ${t("customers.units.title")}`}
      description={t("customers.units.description")}
    >
      {/* Skjema for ny enhet – krever equipment.manage */}
      {canManageEquipment && (
        <form action={createUnit} className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">{t("customers.units.model")} *</label>
              <input type="text" name="model" required placeholder={t("customers.units.modelPlaceholder")} className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">{t("customers.units.serialNumber")}</label>
              <input type="text" name="serialNumber" placeholder={t("customers.units.serialPlaceholder")} className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">{t("customers.units.location")}</label>
              <input type="text" name="location" placeholder={t("customers.units.locationPlaceholder")} className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm whitespace-nowrap">
            {t("customers.units.add")}
          </button>
        </form>
      )}

      {products.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{t("customers.units.empty")}</p>
      ) : (
        <div className="space-y-2">
          {products.map((unit) => (
            <div key={unit.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <details className="flex-1 min-w-0">
                  <summary className="cursor-pointer list-none">
                    <span className="font-bold text-gray-900 text-sm">{unit.model}</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">
                      {unit.serialNumber
                        ? t("customers.units.serial", { serial: unit.serialNumber })
                        : t("customers.units.withoutSerial")}
                      {unit.location ? ` • ${unit.location}` : ""}
                    </span>
                    <span className="block text-[11px] mt-1">
                      {unit._count.reportUnits === 0 ? (
                        <span className="text-gray-400">🕓 {t("customers.units.neverChecked")}</span>
                      ) : (
                        <span className="text-blue-800 font-bold">
                          🕓 {t("customers.units.serviceCount", { count: unit._count.reportUnits })} •{" "}
                          {t("customers.units.lastService", {
                            date: formatDate(
                              lastServiceDate(unit.reportUnits),
                              t("customers.units.noDate"),
                            ),
                          })}
                        </span>
                      )}
                      <span className="ml-2 text-blue-600 font-bold">
                        ▾ {t("customers.units.showHistory")}
                      </span>
                    </span>
                  </summary>

                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <p className="text-[11px] font-black text-gray-600 uppercase tracking-wider mb-2">
                      🕓 {t("customers.units.serviceHistory", { count: unit._count.reportUnits })}
                    </p>
                    {unit._count.reportUnits > unit.reportUnits.length && (
                      <p className="text-[10px] text-gray-500 mb-2">
                        {t("customers.units.showingRecent", {
                          shown: unit.reportUnits.length,
                          total: unit._count.reportUnits,
                        })}
                      </p>
                    )}
                    <UnitHistory entries={unit.reportUnits} />
                  </div>

                  {canManageEquipment && (
                    <details className="mt-3 border-t border-gray-200 pt-3">
                      <summary className="cursor-pointer text-[11px] font-black text-gray-600 uppercase tracking-wider">
                        ✏️ {t("customers.units.editUnit")}
                      </summary>

                      <form action={updateUnit} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                        <input type="hidden" name="customerId" value={customerId} />
                        <input type="hidden" name="id" value={unit.id} />
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">{t("customers.units.model")} *</label>
                          <input type="text" name="model" required defaultValue={unit.model} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">{t("customers.units.serialNumber")}</label>
                          <input type="text" name="serialNumber" defaultValue={unit.serialNumber || ""} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">{t("customers.units.location")}</label>
                          <input type="text" name="location" defaultValue={unit.location || ""} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                        </div>
                        <div className="sm:col-span-3 flex justify-end">
                          <button type="submit" className="bg-gray-900 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-800 transition">
                            {t("customers.units.save")}
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
                    <button type="submit" title={t("customers.units.delete")} className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition">
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
