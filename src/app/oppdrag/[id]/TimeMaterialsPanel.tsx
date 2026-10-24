import { getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { getMaterialTotals, listMaterials } from "@/server/materials";
import { getTimeTotals, listTimeEntries } from "@/server/time";
import {
  addMaterialAction,
  addTimeAction,
  deleteMaterialAction,
  deleteTimeAction,
  startTimerAction,
  stopTimerAction,
} from "./time-actions";

type TimeEntryView = {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  minutes: number | null;
  description: string | null;
  billable: boolean;
  hourlyRate: unknown;
};

type MaterialView = {
  id: string;
  name: string;
  sku: string | null;
  quantity: unknown;
  unit: string;
  unitPrice: unknown;
};

const currency = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
});

function minutesLabel(
  minutes: number,
  hoursShort: string,
  minutesShort: string,
) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${minutesShort}`;
  return rest === 0
    ? `${hours} ${hoursShort}`
    : `${hours} ${hoursShort} ${rest} ${minutesShort}`;
}

/**
 * Tidsregistrering og materialer på et oppdrag. Tjenestene håndhever
 * autorisasjon og avdelingssperre; panelet skjuler bare handlinger brukeren
 * ikke kan utføre.
 */
export default async function TimeMaterialsPanel({
  workOrderId,
}: {
  workOrderId: string;
}) {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "workorders.view")) return null;

  const hoursShort = t("p3.timeMaterials.hoursShort");
  const minutesShort = t("p3.timeMaterials.minutesShort");

  const [timeResult, materialResult, timeTotals, materialTotals] =
    await Promise.all([
      listTimeEntries(user, workOrderId),
      listMaterials(user, workOrderId),
      getTimeTotals(user, workOrderId),
      getMaterialTotals(user, workOrderId),
    ]);

  if (!timeResult.ok || !materialResult.ok) return null;
  if (!timeTotals.ok || !materialTotals.ok) return null;

  const entries = timeResult.data as TimeEntryView[];
  const materials = materialResult.data as MaterialView[];
  const canEdit = hasPermission(user, "workorders.update");
  const canDeleteMaterial = hasPermission(user, "workorders.edit");
  const canSetPrice = user.role === "ADMIN" || user.role === "OFFICE";
  const active = entries.find((entry) => entry.userId === user.id && !entry.endedAt);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">⏱️ {t("p3.timeMaterials.timeTitle")}</h2>
            <p className="text-sm text-gray-600">
              {minutesLabel(timeTotals.data.minutes, hoursShort, minutesShort)} · {currency.format(timeTotals.data.amount)}
            </p>
          </div>
          <a
            href={`/api/okonomi/export?workOrderId=${workOrderId}`}
            className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            {t("p3.timeMaterials.exportCsv")}
          </a>
        </div>

        {active ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-bold text-blue-900">
              {t("p3.timeMaterials.active", { time: formatDateTime(active.startedAt) })}
            </p>
            <form action={stopTimerAction}>
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <input type="hidden" name="entryId" value={active.id} />
              <button
                type="submit"
                className="min-h-11 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                {t("p3.timeMaterials.stop")}
              </button>
            </form>
          </div>
        ) : (
          canEdit && (
            <form
              action={startTimerAction}
              className="mb-4 flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row"
            >
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <input
                name="description"
                placeholder={t("p3.timeMaterials.descriptionPlaceholder")}
                className="min-h-11 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900"
              />
              <button
                type="submit"
                className="min-h-11 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                {t("p3.timeMaterials.start")}
              </button>
            </form>
          )
        )}

        <details className="mb-4 rounded-xl border border-gray-200 p-3">
          <summary className="cursor-pointer text-sm font-bold text-gray-700">
            {t("p3.timeMaterials.manual")}
          </summary>
          <form action={addTimeAction} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <label className="text-xs font-bold text-gray-600">
              {t("p3.timeMaterials.from")}
              <input
                type="datetime-local"
                name="startedAt"
                required
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs font-bold text-gray-600">
              {t("p3.timeMaterials.to")}
              <input
                type="datetime-local"
                name="endedAt"
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs font-bold text-gray-600 sm:col-span-2">
              {t("p3.timeMaterials.description")}
              <input
                name="description"
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
              />
            </label>
            {canSetPrice && (
              <label className="text-xs font-bold text-gray-600">
                {t("p3.timeMaterials.hourlyRate")}
                <input
                  type="number"
                  name="hourlyRate"
                  min="0"
                  step="0.01"
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
              <input type="checkbox" name="billable" defaultChecked className="h-4 w-4" />
              {t("p3.timeMaterials.billable")}
            </label>
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 sm:col-span-2"
            >
              {t("p3.timeMaterials.saveTime")}
            </button>
          </form>
        </details>

        {entries.length === 0 ? (
          <p className="text-sm italic text-gray-500">{t("p3.timeMaterials.noTime")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.slice(0, 20).map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {formatDateTime(entry.startedAt)}
                    {entry.endedAt ? ` → ${formatDateTime(entry.endedAt)}` : ` ${t("p3.timeMaterials.activeShort")}`}
                  </p>
                  <p className="text-xs text-gray-600">
                    {minutesLabel(entry.minutes ?? 0, hoursShort, minutesShort)}
                    {entry.description ? ` · ${entry.description}` : ""}
                    {entry.billable ? "" : ` · ${t("p3.timeMaterials.notBillable")}`}
                  </p>
                </div>
                {(entry.userId === user.id || user.role === "ADMIN") && (
                  <form action={deleteTimeAction}>
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="entryId" value={entry.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl px-3 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      {t("p3.timeMaterials.delete")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <h2 className="text-lg font-bold text-gray-900">📦 {t("p3.timeMaterials.materialTitle")}</h2>
          <p className="text-sm text-gray-600">
            {t("p3.timeMaterials.lines", { count: materialTotals.data.count })} · {currency.format(materialTotals.data.amount)}
          </p>
        </div>

        {canEdit && (
          <form action={addMaterialAction} className="mb-4 grid gap-2 sm:grid-cols-6">
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input
              name="name"
              required
              placeholder={t("p3.timeMaterials.name")}
              className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm text-gray-900 sm:col-span-2"
            />
            <input
              name="sku"
              placeholder={t("p3.timeMaterials.sku")}
              className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
            />
            <input
              type="number"
              name="quantity"
              required
              min="0.01"
              step="0.01"
              defaultValue="1"
              className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
            />
            {canSetPrice && (
              <input
                type="number"
                name="unitPrice"
                min="0"
                step="0.01"
                placeholder={t("p3.timeMaterials.price")}
                className="min-h-11 rounded-xl border border-gray-300 px-3 text-sm text-gray-900"
              />
            )}
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800"
            >
              {t("p3.timeMaterials.add")}
            </button>
          </form>
        )}

        {materials.length === 0 ? (
          <p className="text-sm italic text-gray-500">{t("p3.timeMaterials.noMaterials")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {materials.map((material) => (
              <li key={material.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {material.name}
                    {material.sku ? ` (${material.sku})` : ""}
                  </p>
                  <p className="text-xs text-gray-600">
                    {Number(material.quantity)} {material.unit} ×{" "}
                    {material.unitPrice == null
                      ? "–"
                      : currency.format(Number(material.unitPrice))}{" "}
                    ={" "}
                    {material.unitPrice == null
                      ? "–"
                      : currency.format(
                          Number(material.quantity) * Number(material.unitPrice),
                        )}
                  </p>
                </div>
                {canDeleteMaterial && (
                  <form action={deleteMaterialAction}>
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="materialId" value={material.id} />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl px-3 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      {t("p3.timeMaterials.delete")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
