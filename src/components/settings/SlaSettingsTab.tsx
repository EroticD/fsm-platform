import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { formatDateLocalized } from "@/lib/dates";

type Policy = {
  id: string;
  name: string;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  responseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
  isActive: boolean;
  _count: { contracts: number; clocks: number };
};

type Department = { id: string; name: string; isDefault: boolean };

type Holiday = {
  id: string;
  date: Date;
  name: string;
  department: { id: string; name: string } | null;
};

type PriceList = {
  id: string;
  name: string;
  isActive: boolean;
  items: Array<{
    id: string;
    code: string;
    label: string;
    unit: string;
    amount: { toString(): string } | number;
  }>;
  _count: { contracts: number };
};

type Props = {
  policies: Policy[];
  departments: Department[];
  departmentId: string | null;
  hours: Array<{
    weekday: number;
    openMinute: number;
    closeMinute: number;
  }>;
  holidays: Holiday[];
  priceLists: PriceList[];
  canManageContracts: boolean;
  error?: string;
  ok?: string;
  savePolicy: (formData: FormData) => Promise<void>;
  deactivatePolicy: (formData: FormData) => Promise<void>;
  saveHours: (formData: FormData) => Promise<void>;
  saveHoliday: (formData: FormData) => Promise<void>;
  deleteHoliday: (formData: FormData) => Promise<void>;
  createPriceList: (formData: FormData) => Promise<void>;
  addPriceItem: (formData: FormData) => Promise<void>;
  deletePriceItem: (formData: FormData) => Promise<void>;
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const CARD =
  "office-card space-y-4 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";

function minuteToTime(minute: number): string {
  if (!Number.isFinite(minute) || minute <= 0) return "";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

function defaultHours(weekday: number) {
  if (weekday >= 5) return { openMinute: 0, closeMinute: 0 };
  return { openMinute: 8 * 60, closeMinute: 16 * 60 };
}

export default async function SlaSettingsTab({
  policies,
  departments,
  departmentId,
  hours,
  holidays,
  priceLists,
  canManageContracts,
  error,
  ok,
  savePolicy,
  deactivatePolicy,
  saveHours,
  saveHoliday,
  deleteHoliday,
  createPriceList,
  addPriceItem,
  deletePriceItem,
}: Props) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const hoursByWeekday = new Map(hours.map((row) => [row.weekday, row]));
  const selectedDepartment = departments.find(
    (department) => department.id === departmentId,
  );

  const errorKey =
    error === "forbidden"
      ? "settings.sla.errors.forbidden"
      : error === "not_found"
        ? "settings.sla.errors.notFound"
        : error === "conflict"
          ? "settings.sla.errors.conflict"
          : error
            ? "settings.sla.errors.invalid"
            : null;
  const okKey =
    ok === "policy"
      ? "settings.sla.feedback.policy"
      : ok === "policy-deactivated"
        ? "settings.sla.feedback.policyDeactivated"
        : ok === "hours"
          ? "settings.sla.feedback.hours"
          : ok === "holiday"
            ? "settings.sla.feedback.holiday"
            : ok === "holiday-deleted"
              ? "settings.sla.feedback.holidayDeleted"
              : ok === "price-list"
                ? "settings.sla.feedback.priceList"
                : ok === "price-item"
                  ? "settings.sla.feedback.priceItem"
                  : ok === "price-item-deleted"
                    ? "settings.sla.feedback.priceItemDeleted"
                    : null;

  return (
    <div className="space-y-4">
      {errorKey ? (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(errorKey)}
        </p>
      ) : null}
      {okKey ? (
        <p
          role="status"
          className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]"
        >
          {t(okKey)}
        </p>
      ) : null}

      <section className={CARD} aria-labelledby="sla-policies-title">
        <div>
          <h2
            id="sla-policies-title"
            className="flex items-center gap-2 text-base font-black"
          >
            <Icon name="clock" className="h-4 w-4" />
            {t("settings.sla.sections.policies")}
          </h2>
          <p className={`mt-1 ${MUTED}`}>
            {t("settings.sla.sections.policiesHint")}
          </p>
        </div>

        <form action={savePolicy} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="sla-name" className={LABEL}>
              {t("settings.sla.policy.name")}
            </label>
            <input
              id="sla-name"
              name="name"
              required
              maxLength={200}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="sla-department" className={LABEL}>
              {t("settings.sla.policy.department")}
            </label>
            <select
              id="sla-department"
              name="departmentId"
              defaultValue=""
              className={INPUT}
            >
              <option value="">{t("settings.sla.policy.global")}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sla-active" className={LABEL}>
              {t("settings.sla.policy.active")}
            </label>
            <input
              id="sla-active"
              name="isActive"
              type="checkbox"
              defaultChecked
              className="h-11 w-11"
            />
          </div>
          <div>
            <label htmlFor="sla-response" className={LABEL}>
              {t("settings.sla.policy.responseMinutes")}
            </label>
            <input
              id="sla-response"
              name="responseMinutes"
              type="number"
              min={1}
              max={43200}
              required
              defaultValue={240}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="sla-resolution" className={LABEL}>
              {t("settings.sla.policy.resolutionMinutes")}
            </label>
            <input
              id="sla-resolution"
              name="resolutionMinutes"
              type="number"
              min={1}
              max={43200}
              required
              defaultValue={1440}
              className={INPUT}
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold sm:col-span-2">
            <input
              type="checkbox"
              name="businessHoursOnly"
              defaultChecked
              className="h-5 w-5"
            />
            {t("settings.sla.policy.businessHoursOnly")}
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className={BUTTON}>
              <Icon name="plus" className="h-4 w-4" />
              {t("settings.sla.policy.create")}
            </button>
          </div>
        </form>

        {policies.length === 0 ? (
          <p className={MUTED}>{t("settings.sla.policy.empty")}</p>
        ) : (
          <div className="space-y-2">
            {policies.map((policy) => (
              <details
                key={policy.id}
                className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
              >
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm font-bold">
                  <span>{policy.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${
                      policy.isActive
                        ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
                        : "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]"
                    }`}
                  >
                    {policy.isActive
                      ? t("settings.sla.policy.activeLabel")
                      : t("settings.sla.policy.inactiveLabel")}
                  </span>
                  <span className={MUTED}>
                    {t("settings.sla.policy.linked", {
                      contracts: policy._count.contracts,
                      clocks: policy._count.clocks,
                    })}
                  </span>
                </summary>
                <form
                  action={savePolicy}
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                >
                  <input type="hidden" name="id" value={policy.id} />
                  <div className="sm:col-span-2">
                    <label
                      htmlFor={`sla-name-${policy.id}`}
                      className={LABEL}
                    >
                      {t("settings.sla.policy.name")}
                    </label>
                    <input
                      id={`sla-name-${policy.id}`}
                      name="name"
                      required
                      maxLength={200}
                      defaultValue={policy.name}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`sla-department-${policy.id}`}
                      className={LABEL}
                    >
                      {t("settings.sla.policy.department")}
                    </label>
                    <select
                      id={`sla-department-${policy.id}`}
                      name="departmentId"
                      defaultValue={policy.departmentId ?? ""}
                      className={INPUT}
                    >
                      <option value="">
                        {t("settings.sla.policy.global")}
                      </option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={policy.isActive}
                        className="h-5 w-5"
                      />
                      {t("settings.sla.policy.active")}
                    </label>
                  </div>
                  <div>
                    <label
                      htmlFor={`sla-response-${policy.id}`}
                      className={LABEL}
                    >
                      {t("settings.sla.policy.responseMinutes")}
                    </label>
                    <input
                      id={`sla-response-${policy.id}`}
                      name="responseMinutes"
                      type="number"
                      min={1}
                      max={43200}
                      required
                      defaultValue={policy.responseMinutes}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`sla-resolution-${policy.id}`}
                      className={LABEL}
                    >
                      {t("settings.sla.policy.resolutionMinutes")}
                    </label>
                    <input
                      id={`sla-resolution-${policy.id}`}
                      name="resolutionMinutes"
                      type="number"
                      min={1}
                      max={43200}
                      required
                      defaultValue={policy.resolutionMinutes}
                      className={INPUT}
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-bold sm:col-span-2">
                    <input
                      type="checkbox"
                      name="businessHoursOnly"
                      defaultChecked={policy.businessHoursOnly}
                      className="h-5 w-5"
                    />
                    {t("settings.sla.policy.businessHoursOnly")}
                  </label>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <button type="submit" className={BUTTON}>
                      <Icon name="check" className="h-4 w-4" />
                      {t("save")}
                    </button>
                    {policy.isActive ? (
                      <button
                        type="submit"
                        formAction={deactivatePolicy}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[#e7b5ae] bg-[#fbe9e7] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)]"
                      >
                        <Icon name="close" className="h-4 w-4" />
                        {t("settings.sla.policy.deactivate")}
                      </button>
                    ) : null}
                  </div>
                </form>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className={CARD} aria-labelledby="sla-hours-title">
        <div>
          <h2
            id="sla-hours-title"
            className="flex items-center gap-2 text-base font-black"
          >
            <Icon name="calendar" className="h-4 w-4" />
            {t("settings.sla.sections.hours")}
          </h2>
          <p className={`mt-1 ${MUTED}`}>
            {t("settings.sla.sections.hoursHint")}
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="sla" />
          <div className="min-w-56 flex-1">
            <label htmlFor="hours-department" className={LABEL}>
              {t("settings.sla.hours.department")}
            </label>
            <select
              id="hours-department"
              name="department"
              defaultValue={departmentId ?? ""}
              className={INPUT}
            >
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={BUTTON}>
            {t("settings.sla.hours.show")}
          </button>
        </form>

        {departmentId ? (
          <form action={saveHours} className="space-y-2">
            <input type="hidden" name="departmentId" value={departmentId} />
            {Array.from({ length: 7 }, (_, weekday) => {
              const row = hoursByWeekday.get(weekday);
              const fallback = defaultHours(weekday);
              const openMinute = row?.openMinute ?? fallback.openMinute;
              const closeMinute = row?.closeMinute ?? fallback.closeMinute;
              const closed = closeMinute <= openMinute;
              return (
                <div
                  key={weekday}
                  className="grid grid-cols-[minmax(6rem,1fr)_auto_auto_auto] items-end gap-2"
                >
                  <span className="min-h-11 py-3 text-sm font-bold">
                    {t(`settings.sla.weekdays.${weekday}`)}
                  </span>
                  <div>
                    <label
                      htmlFor={`open-${weekday}`}
                      className={LABEL}
                    >
                      {t("settings.sla.hours.open")}
                    </label>
                    <input
                      id={`open-${weekday}`}
                      name={`open-${weekday}`}
                      type="time"
                      defaultValue={minuteToTime(openMinute) || "08:00"}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`close-${weekday}`}
                      className={LABEL}
                    >
                      {t("settings.sla.hours.close")}
                    </label>
                    <input
                      id={`close-${weekday}`}
                      name={`close-${weekday}`}
                      type="time"
                      defaultValue={minuteToTime(closeMinute) || "16:00"}
                      className={INPUT}
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-2 pb-2 text-xs font-bold">
                    <input
                      type="checkbox"
                      name={`closed-${weekday}`}
                      defaultChecked={closed}
                      className="h-5 w-5"
                    />
                    {t("settings.sla.hours.closed")}
                  </label>
                </div>
              );
            })}
            <button type="submit" className={BUTTON}>
              <Icon name="check" className="h-4 w-4" />
              {t("settings.sla.hours.save")}
            </button>
            {selectedDepartment ? (
              <p className={MUTED}>
                {t("settings.sla.hours.forDepartment", {
                  department: selectedDepartment.name,
                })}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      <section className={CARD} aria-labelledby="sla-holidays-title">
        <div>
          <h2
            id="sla-holidays-title"
            className="flex items-center gap-2 text-base font-black"
          >
            <Icon name="flag" className="h-4 w-4" />
            {t("settings.sla.sections.holidays")}
          </h2>
          <p className={`mt-1 ${MUTED}`}>
            {t("settings.sla.sections.holidaysHint")}
          </p>
        </div>

        <form
          action={saveHoliday}
          className="grid gap-3 sm:grid-cols-[1fr_1.5fr_1fr_auto]"
        >
          <div>
            <label htmlFor="holiday-date" className={LABEL}>
              {t("settings.sla.holidays.date")}
            </label>
            <input
              id="holiday-date"
              name="date"
              type="date"
              required
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="holiday-name" className={LABEL}>
              {t("settings.sla.holidays.name")}
            </label>
            <input
              id="holiday-name"
              name="name"
              required
              maxLength={200}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="holiday-department" className={LABEL}>
              {t("settings.sla.holidays.department")}
            </label>
            <select
              id="holiday-department"
              name="departmentId"
              defaultValue=""
              className={INPUT}
            >
              <option value="">{t("settings.sla.holidays.global")}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className={BUTTON}>
              <Icon name="plus" className="h-4 w-4" />
              {t("settings.sla.holidays.add")}
            </button>
          </div>
        </form>

        {holidays.length === 0 ? (
          <p className={MUTED}>{t("settings.sla.holidays.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--line,#dedcd1)]">
            {holidays.map((holiday) => (
              <li
                key={holiday.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="text-sm">
                  <span className="font-bold">
                    {formatDateLocalized(holiday.date, locale, {
                      dateStyle: "medium",
                    })}
                  </span>{" "}
                  {holiday.name}
                  <span className={MUTED}>
                    {" "}
                    ·{" "}
                    {holiday.department?.name ??
                      t("settings.sla.holidays.global")}
                  </span>
                </span>
                <form action={deleteHoliday}>
                  <input type="hidden" name="id" value={holiday.id} />
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[#e7b5ae] bg-[#fbe9e7] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)]"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                    {t("delete")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageContracts ? (
        <section className={CARD} aria-labelledby="sla-prices-title">
          <div>
            <h2
              id="sla-prices-title"
              className="flex items-center gap-2 text-base font-black"
            >
              <Icon name="file" className="h-4 w-4" />
              {t("settings.sla.sections.priceLists")}
            </h2>
            <p className={`mt-1 ${MUTED}`}>
              {t("settings.sla.priceLists.referenceOnly")}
            </p>
          </div>

          <form action={createPriceList} className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label htmlFor="price-list-name" className={LABEL}>
                {t("settings.sla.priceLists.name")}
              </label>
              <input
                id="price-list-name"
                name="name"
                required
                maxLength={200}
                className={INPUT}
              />
            </div>
            <button type="submit" className={BUTTON}>
              <Icon name="plus" className="h-4 w-4" />
              {t("settings.sla.priceLists.create")}
            </button>
          </form>

          {priceLists.length === 0 ? (
            <p className={MUTED}>{t("settings.sla.priceLists.empty")}</p>
          ) : (
            <div className="space-y-3">
              {priceLists.map((list) => (
                <details
                  key={list.id}
                  className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                >
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm font-bold">
                    {list.name}
                    <span className={MUTED}>
                      {t("settings.sla.priceLists.linked", {
                        count: list._count.contracts,
                      })}
                    </span>
                  </summary>
                  {list.items.length === 0 ? (
                    <p className={`mt-2 ${MUTED}`}>
                      {t("settings.sla.priceLists.noItems")}
                    </p>
                  ) : (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[var(--line,#dedcd1)]">
                            <th className="py-1">
                              {t("settings.sla.priceLists.code")}
                            </th>
                            <th className="py-1">
                              {t("settings.sla.priceLists.label")}
                            </th>
                            <th className="py-1">
                              {t("settings.sla.priceLists.unit")}
                            </th>
                            <th className="py-1">
                              {t("settings.sla.priceLists.amount")}
                            </th>
                            <th className="py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {list.items.map((item) => (
                            <tr
                              key={item.id}
                              className="border-b border-[var(--line,#dedcd1)]"
                            >
                              <td className="py-1.5 font-mono">{item.code}</td>
                              <td className="py-1.5">{item.label}</td>
                              <td className="py-1.5">{item.unit}</td>
                              <td className="py-1.5 tabular-nums">
                                {Number(item.amount.toString()).toLocaleString(
                                  locale,
                                  { minimumFractionDigits: 2 },
                                )}
                              </td>
                              <td className="py-1.5 text-right">
                                <form action={deletePriceItem}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="priceListId"
                                    value={list.id}
                                  />
                                  <button
                                    type="submit"
                                    className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--risk-text,#b42318)]"
                                  >
                                    <Icon name="trash" className="h-3.5 w-3.5" />
                                    {t("delete")}
                                  </button>
                                </form>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <form
                    action={addPriceItem}
                    className="mt-3 grid gap-2 sm:grid-cols-[0.7fr_1.6fr_0.7fr_0.7fr_auto]"
                  >
                    <input type="hidden" name="priceListId" value={list.id} />
                    <div>
                      <label
                        htmlFor={`item-code-${list.id}`}
                        className={LABEL}
                      >
                        {t("settings.sla.priceLists.code")}
                      </label>
                      <input
                        id={`item-code-${list.id}`}
                        name="code"
                        required
                        maxLength={60}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`item-label-${list.id}`}
                        className={LABEL}
                      >
                        {t("settings.sla.priceLists.label")}
                      </label>
                      <input
                        id={`item-label-${list.id}`}
                        name="label"
                        required
                        maxLength={200}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`item-unit-${list.id}`}
                        className={LABEL}
                      >
                        {t("settings.sla.priceLists.unit")}
                      </label>
                      <input
                        id={`item-unit-${list.id}`}
                        name="unit"
                        required
                        maxLength={30}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`item-amount-${list.id}`}
                        className={LABEL}
                      >
                        {t("settings.sla.priceLists.amount")}
                      </label>
                      <input
                        id={`item-amount-${list.id}`}
                        name="amount"
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        className={INPUT}
                      />
                    </div>
                    <div className="flex items-end">
                      <button type="submit" className={BUTTON}>
                        <Icon name="plus" className="h-4 w-4" />
                        {t("settings.sla.priceLists.addItem")}
                      </button>
                    </div>
                  </form>
                </details>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
