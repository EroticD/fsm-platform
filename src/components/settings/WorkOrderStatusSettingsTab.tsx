import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { WORK_ORDER_STATUS_LABEL_KEYS } from "@/lib/work-order-status-colors";
import type { WorkOrderStatusSettingsView } from "@/server/work-order-status-settings";
import type { WorkOrderStatusCategory } from "@/lib/work-order-status";

const LABEL = "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const INPUT =
  "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1.5 text-sm";

const CATEGORIES: WorkOrderStatusCategory[] = ["OPEN", "PLANNED", "CLOSED"];

export default async function WorkOrderStatusSettingsTab({
  view,
  error,
  ok,
  save,
  reset,
}: {
  view: WorkOrderStatusSettingsView;
  error?: string;
  ok?: string;
  save: (formData: FormData) => Promise<void>;
  reset: () => Promise<void>;
}) {
  const t = await getTranslations("common");

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl border border-[#e7b5ae] bg-[var(--risk-surface,#fdf4f2)] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
          {t("settings.workOrderStatus.error")}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="rounded-xl border border-[#b9c99a] bg-[var(--success-surface,#eef7d6)] p-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("settings.workOrderStatus.saved")}
        </p>
      ) : null}

      <form action={save} className="office-card space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
          <Icon name="settings" className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-base font-extrabold">{t("settings.workOrderStatus.title")}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted,#62685f)]">
              {t("settings.workOrderStatus.description")}
            </p>
          </div>
        </div>

        <label className="block max-w-md">
          <span className={LABEL}>{t("settings.workOrderStatus.defaultStatus")}</span>
          <select name="defaultStatus" defaultValue={view.defaultStatus} className={INPUT}>
            {view.rows
              .filter((row) => row.category !== "CLOSED")
              .map((row) => (
                <option key={row.status} value={row.status}>
                  {t(WORK_ORDER_STATUS_LABEL_KEYS[row.status])}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("settings.workOrderStatus.defaultHint")}
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line,#dedcd1)] text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                <th scope="col" className="px-2 py-2">{t("settings.workOrderStatus.status")}</th>
                <th scope="col" className="px-2 py-2">{t("settings.workOrderStatus.category")}</th>
                <th scope="col" className="px-2 py-2">{t("settings.workOrderStatus.order")}</th>
                <th scope="col" className="px-2 py-2">{t("settings.workOrderStatus.active")}</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.status} className="border-b border-[var(--line,#dedcd1)] last:border-0">
                  <th scope="row" className="px-2 py-2 text-left font-bold">
                    {t(WORK_ORDER_STATUS_LABEL_KEYS[row.status])}
                    <code className="ml-1 text-2xs font-normal text-[var(--muted,#62685f)]">{row.status}</code>
                  </th>
                  <td className="px-2 py-2">
                    <select
                      name={`category_${row.status}`}
                      defaultValue={row.category}
                      aria-label={`${t("settings.workOrderStatus.category")}: ${t(WORK_ORDER_STATUS_LABEL_KEYS[row.status])}`}
                      className={INPUT}
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {t(`settings.workOrderStatus.categories.${category}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      name={`sortOrder_${row.status}`}
                      min={0}
                      max={9999}
                      defaultValue={row.sortOrder}
                      aria-label={`${t("settings.workOrderStatus.order")}: ${t(WORK_ORDER_STATUS_LABEL_KEYS[row.status])}`}
                      className={`${INPUT} w-24 text-center tabular-nums`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      name={`active_${row.status}`}
                      defaultChecked={row.isActive}
                      aria-label={`${t("settings.workOrderStatus.active")}: ${t(WORK_ORDER_STATUS_LABEL_KEYS[row.status])}`}
                      className="h-5 w-5"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("settings.workOrderStatus.hint")}
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="signal-button min-h-11 text-xs">
            <Icon name="check" className="h-4 w-4" />
            {t("settings.workOrderStatus.save")}
          </button>
          <button
            type="submit"
            formAction={reset}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold"
          >
            {t("settings.workOrderStatus.reset")}
          </button>
        </div>
      </form>
    </div>
  );
}
