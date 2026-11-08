import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type { SmsProviderInfo } from "@/lib/sms/provider";
import { SMS_EVENT_KEYS, SMS_LOCALES } from "@/lib/sms/templates";
import { formatDateTimeLocalized } from "@/lib/dates";

type Template = {
  id: string;
  eventKey: string;
  locale: string;
  body: string;
  variables: string[];
  isActive: boolean;
};

type Settings = {
  defaultLocale: string;
  optOutKeywords: string[];
  optInKeywords: string[];
  monthlyCap: number | null;
};

type ReminderRule = {
  id: string;
  departmentId: string;
  channel: string;
  offsetHours: number;
  templateKey: string;
  quietStartHour: number | null;
  quietEndHour: number | null;
  timezone: string;
  maxPerVisit: number;
  isActive: boolean;
  department: { id: string; name: string };
};

type ReminderDispatch = {
  id: string;
  channel: string;
  offsetHours: number;
  status: string;
  scheduledFor: Date;
  sentAt: Date | null;
  skipReason: string | null;
  lastError: string | null;
  attempts: number;
  locale: string;
  createdAt: Date;
  visit: {
    startsAt: Date;
    workOrder: { id: string; title: string };
  };
  department: { name: string } | null;
};

type ReminderView = {
  departments: Array<{ id: string; name: string }>;
  rules: ReminderRule[];
  dispatches: ReminderDispatch[];
};

type Props = {
  settings: Settings;
  templates: Template[];
  provider: SmsProviderInfo;
  senderId: string;
  reminders: ReminderView;
  error?: string;
  ok?: string;
  saveSettings: (formData: FormData) => Promise<void>;
  saveTemplate: (formData: FormData) => Promise<void>;
  saveReminder: (formData: FormData) => Promise<void>;
  deleteReminder: (formData: FormData) => Promise<void>;
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const CARD = "office-card space-y-4 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[#b42318] bg-transparent px-3 py-2 text-xs font-bold text-[#b42318]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";

export default async function SmsSettingsTab({
  settings,
  templates,
  provider,
  senderId,
  reminders,
  error,
  ok,
  saveSettings,
  saveTemplate,
  saveReminder,
  deleteReminder,
}: Props) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  const errorKey =
    error === "forbidden"
      ? "sms.settings.errorForbidden"
      : error === "conflict"
        ? "sms.reminders.conflict"
        : error
          ? "sms.settings.errorInvalid"
          : null;

  return (
    <div className="space-y-5">
      {errorKey && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[var(--risk-surface,#fdf4f2)] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(errorKey)}
        </p>
      )}
      {ok === "settings" && (
        <p className="rounded-xl border border-[#b9c99a] bg-[var(--success-surface,#eef7d6)] p-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("sms.settings.saved")}
        </p>
      )}
      {ok === "template" && (
        <p className="rounded-xl border border-[#b9c99a] bg-[var(--success-surface,#eef7d6)] p-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("sms.settings.templateSaved")}
        </p>
      )}
      {(ok === "reminder" || ok === "reminderDeleted") && (
        <p className="rounded-xl border border-[#b9c99a] bg-[var(--success-surface,#eef7d6)] p-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("sms.reminders.saved")}
        </p>
      )}

      <section className={CARD}>
        <div className="flex items-start gap-3">
          <Icon name="mail" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
              {t("sms.settings.title")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
              {t("sms.settings.description")}
            </p>
          </div>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className={LABEL}>{t("sms.settings.provider")}</dt>
            <dd className="font-bold text-[var(--ink,#101310)]">
              {provider.provider}
            </dd>
          </div>
          <div>
            <dt className={LABEL}>{t("sms.settings.sender")}</dt>
            <dd className="font-bold text-[var(--ink,#101310)]">{senderId}</dd>
          </div>
          <div>
            <dt className={LABEL}>{t("sms.settings.signature")}</dt>
            <dd className="font-bold text-[var(--ink,#101310)]">
              {provider.signatureConfigured
                ? t("sms.settings.signatureOn")
                : t("sms.settings.signatureOff")}
            </dd>
          </div>
        </dl>
        <p className={MUTED}>
          {provider.dryRun
            ? t("sms.settings.dryRunOn")
            : t("sms.settings.dryRunOff")}
        </p>

        <form action={saveSettings} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sms-default-locale" className={LABEL}>
              {t("sms.settings.defaultLocale")}
            </label>
            <select
              id="sms-default-locale"
              name="defaultLocale"
              defaultValue={settings.defaultLocale}
              className={INPUT}
            >
              {SMS_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {locale}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sms-monthly-cap" className={LABEL}>
              {t("sms.settings.monthlyCap")}
            </label>
            <input
              id="sms-monthly-cap"
              name="monthlyCap"
              type="number"
              min={0}
              max={1_000_000}
              defaultValue={settings.monthlyCap ?? 0}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("sms.settings.monthlyCapHint")}
            </p>
          </div>
          <div>
            <label htmlFor="sms-opt-out" className={LABEL}>
              {t("sms.settings.optOutKeywords")}
            </label>
            <textarea
              id="sms-opt-out"
              name="optOutKeywords"
              rows={3}
              defaultValue={settings.optOutKeywords.join("\n")}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="sms-opt-in" className={LABEL}>
              {t("sms.settings.optInKeywords")}
            </label>
            <textarea
              id="sms-opt-in"
              name="optInKeywords"
              rows={3}
              defaultValue={settings.optInKeywords.join("\n")}
              className={INPUT}
            />
          </div>
          <p className={`sm:col-span-2 ${MUTED}`}>
            {t("sms.settings.keywordsHint")}
          </p>
          <div className="sm:col-span-2">
            <button type="submit" className={BUTTON}>
              {t("sms.settings.save")}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="office-card p-4 sm:p-5">
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("sms.reminders.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
            {t("sms.reminders.description")}
          </p>
          <p className={`mt-2 ${MUTED}`}>{t("sms.reminders.quietHint")}</p>
        </div>

        {reminders.departments.length === 0 ? (
          <p className="office-card p-4 text-sm text-[var(--muted,#62685f)]">
            {t("sms.reminders.noDepartments")}
          </p>
        ) : (
          <form action={saveReminder} className={CARD}>
            <h3 className="font-extrabold text-[var(--ink,#101310)]">
              {t("sms.reminders.create")}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="reminder-department" className={LABEL}>
                  {t("sms.reminders.department")}
                </label>
                <select
                  id="reminder-department"
                  name="departmentId"
                  required
                  className={INPUT}
                >
                  {reminders.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reminder-channel" className={LABEL}>
                  {t("sms.reminders.channel")}
                </label>
                <select id="reminder-channel" name="channel" className={INPUT}>
                  {["SMS", "EMAIL", "BOTH"].map((channel) => (
                    <option key={channel} value={channel}>
                      {t(`sms.reminders.channels.${channel}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reminder-offset" className={LABEL}>
                  {t("sms.reminders.offsetHours")}
                </label>
                <input
                  id="reminder-offset"
                  name="offsetHours"
                  type="number"
                  min={1}
                  max={336}
                  defaultValue={24}
                  required
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="reminder-template" className={LABEL}>
                  {t("sms.reminders.templateKey")}
                </label>
                <select
                  id="reminder-template"
                  name="templateKey"
                  defaultValue="VISIT_REMINDER"
                  className={INPUT}
                >
                  {SMS_EVENT_KEYS.map((eventKey) => (
                    <option key={eventKey} value={eventKey}>
                      {t(`sms.events.${eventKey}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reminder-quiet-start" className={LABEL}>
                  {t("sms.reminders.quietStart")}
                </label>
                <input
                  id="reminder-quiet-start"
                  name="quietStartHour"
                  type="number"
                  min={0}
                  max={23}
                  placeholder="22"
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="reminder-quiet-end" className={LABEL}>
                  {t("sms.reminders.quietEnd")}
                </label>
                <input
                  id="reminder-quiet-end"
                  name="quietEndHour"
                  type="number"
                  min={0}
                  max={23}
                  placeholder="07"
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="reminder-timezone" className={LABEL}>
                  {t("sms.reminders.timezone")}
                </label>
                <input
                  id="reminder-timezone"
                  name="timezone"
                  defaultValue="Europe/Oslo"
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="reminder-max" className={LABEL}>
                  {t("sms.reminders.maxPerVisit")}
                </label>
                <input
                  id="reminder-max"
                  name="maxPerVisit"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={2}
                  className={INPUT}
                />
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--ink,#101310)]">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked
                className="h-4 w-4"
              />
              {t("sms.reminders.active")}
            </label>
            <button type="submit" className={BUTTON}>
              {t("sms.reminders.createButton")}
            </button>
          </form>
        )}

        {reminders.rules.length === 0 ? (
          <p className="office-card p-4 text-sm text-[var(--muted,#62685f)]">
            {t("sms.reminders.noRules")}
          </p>
        ) : (
          reminders.rules.map((rule) => (
            <div key={rule.id} className="space-y-2">
              <form action={saveReminder} className={CARD}>
                <input type="hidden" name="id" value={rule.id} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-extrabold text-[var(--ink,#101310)]">
                    {rule.department.name} ·{" "}
                    {t("sms.reminders.ruleSummary", {
                      hours: rule.offsetHours,
                      channel: t(`sms.reminders.channels.${rule.channel}`),
                    })}
                  </h3>
                  <label className="flex min-h-11 items-center gap-2 text-xs font-bold text-[var(--ink,#101310)]">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={rule.isActive}
                      className="h-4 w-4"
                    />
                    {t("sms.reminders.active")}
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`reminder-department-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.department")}
                    </label>
                    <select
                      id={`reminder-department-${rule.id}`}
                      name="departmentId"
                      defaultValue={rule.departmentId}
                      className={INPUT}
                    >
                      {reminders.departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-channel-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.channel")}
                    </label>
                    <select
                      id={`reminder-channel-${rule.id}`}
                      name="channel"
                      defaultValue={rule.channel}
                      className={INPUT}
                    >
                      {["SMS", "EMAIL", "BOTH"].map((channel) => (
                        <option key={channel} value={channel}>
                          {t(`sms.reminders.channels.${channel}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-offset-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.offsetHours")}
                    </label>
                    <input
                      id={`reminder-offset-${rule.id}`}
                      name="offsetHours"
                      type="number"
                      min={1}
                      max={336}
                      defaultValue={rule.offsetHours}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-template-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.templateKey")}
                    </label>
                    <select
                      id={`reminder-template-${rule.id}`}
                      name="templateKey"
                      defaultValue={rule.templateKey}
                      className={INPUT}
                    >
                      {SMS_EVENT_KEYS.map((eventKey) => (
                        <option key={eventKey} value={eventKey}>
                          {t(`sms.events.${eventKey}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-quiet-start-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.quietStart")}
                    </label>
                    <input
                      id={`reminder-quiet-start-${rule.id}`}
                      name="quietStartHour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={rule.quietStartHour ?? ""}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-quiet-end-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.quietEnd")}
                    </label>
                    <input
                      id={`reminder-quiet-end-${rule.id}`}
                      name="quietEndHour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={rule.quietEndHour ?? ""}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-timezone-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.timezone")}
                    </label>
                    <input
                      id={`reminder-timezone-${rule.id}`}
                      name="timezone"
                      defaultValue={rule.timezone}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`reminder-max-${rule.id}`}
                      className={LABEL}
                    >
                      {t("sms.reminders.maxPerVisit")}
                    </label>
                    <input
                      id={`reminder-max-${rule.id}`}
                      name="maxPerVisit"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={rule.maxPerVisit}
                      className={INPUT}
                    />
                  </div>
                </div>
                <button type="submit" className={BUTTON}>
                  {t("sms.reminders.save")}
                </button>
              </form>
              <form action={deleteReminder} className="px-1">
                <input type="hidden" name="id" value={rule.id} />
                <button type="submit" className={INK_BUTTON}>
                  {t("sms.reminders.delete")}
                </button>
              </form>
            </div>
          ))
        )}

        <div className="office-card space-y-3 p-4 sm:p-5">
          <h3 className="font-extrabold text-[var(--ink,#101310)]">
            {t("sms.reminders.history")}
          </h3>
          <p className={MUTED}>{t("sms.reminders.historyHint")}</p>
          {reminders.dispatches.length === 0 ? (
            <p className="text-sm text-[var(--muted,#62685f)]">
              {t("sms.reminders.noHistory")}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line,#dedcd1)] text-sm">
              {reminders.dispatches.map((dispatch) => (
                <li key={dispatch.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[var(--ink,#101310)]">
                      {dispatch.department?.name ?? "–"} ·{" "}
                      {t("sms.reminders.historyRow", {
                        hours: dispatch.offsetHours,
                        channel: t(
                          `sms.reminders.channels.${dispatch.channel}`,
                        ),
                      })}
                    </span>
                    <span className="rounded-full border border-[var(--line,#dedcd1)] px-2 py-0.5 text-xs font-bold">
                      {t(`sms.reminders.status.${dispatch.status}`)}
                    </span>
                  </div>
                  <p className={MUTED}>
                    {dispatch.visit.workOrder.title} ·{" "}
                    {formatDateTimeLocalized(
                      dispatch.visit.startsAt,
                      locale,
                    )}
                  </p>
                  <p className={MUTED}>
                    {dispatch.sentAt
                      ? t("sms.reminders.sentAt", {
                          time: formatDateTimeLocalized(
                            dispatch.sentAt,
                            locale,
                          ),
                        })
                      : t("sms.reminders.scheduledAt", {
                          time: formatDateTimeLocalized(
                            dispatch.scheduledFor,
                            locale,
                          ),
                        })}
                    {dispatch.skipReason
                      ? ` · ${t(
                          `sms.reminders.reasons.${dispatch.skipReason}`,
                        )}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="office-card p-4 sm:p-5">
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("sms.settings.templates")}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
            {t("sms.settings.templatesHint")}
          </p>
        </div>

        {SMS_EVENT_KEYS.map((eventKey) => (
          <div key={eventKey} className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]">
              {t(`sms.events.${eventKey}`)}
            </h3>
            {templates
              .filter((template) => template.eventKey === eventKey)
              .map((template) => (
                <form
                  key={template.id}
                  action={saveTemplate}
                  className={CARD}
                >
                  <input
                    type="hidden"
                    name="eventKey"
                    value={template.eventKey}
                  />
                  <input
                    type="hidden"
                    name="locale"
                    value={template.locale}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-0.5 text-xs font-bold uppercase text-[var(--ink,#101310)]">
                      {template.locale}
                    </span>
                    <label className="flex min-h-11 items-center gap-2 text-xs font-bold text-[var(--ink,#101310)]">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={template.isActive}
                        className="h-4 w-4"
                      />
                      {t("sms.settings.active")}
                    </label>
                  </div>

                  <div>
                    <label
                      htmlFor={`sms-template-${template.id}`}
                      className={LABEL}
                    >
                      {t("sms.settings.body")}
                    </label>
                    <textarea
                      id={`sms-template-${template.id}`}
                      name="body"
                      rows={4}
                      defaultValue={template.body}
                      className={INPUT}
                    />
                  </div>

                  <p className={MUTED}>
                    <span className="font-bold">
                      {t("sms.settings.variables")}:
                    </span>{" "}
                    {template.variables.join(", ")}
                  </p>

                  <button type="submit" className={BUTTON}>
                    {t("sms.settings.saveTemplate")}
                  </button>
                </form>
              ))}
          </div>
        ))}
        {templates.length === 0 && (
          <p className="office-card p-4 text-sm text-[var(--muted,#62685f)]">
            {t("sms.settings.noTemplates")}
          </p>
        )}
      </section>
    </div>
  );
}
