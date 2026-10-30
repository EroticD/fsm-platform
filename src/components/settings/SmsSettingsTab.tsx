import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type { SmsProviderInfo } from "@/lib/sms/provider";
import { SMS_EVENT_KEYS, SMS_LOCALES } from "@/lib/sms/templates";

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

type Props = {
  settings: Settings;
  templates: Template[];
  provider: SmsProviderInfo;
  senderId: string;
  error?: string;
  ok?: string;
  saveSettings: (formData: FormData) => Promise<void>;
  saveTemplate: (formData: FormData) => Promise<void>;
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const CARD = "office-card space-y-4 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";

export default async function SmsSettingsTab({
  settings,
  templates,
  provider,
  senderId,
  error,
  ok,
  saveSettings,
  saveTemplate,
}: Props) {
  const t = await getTranslations("common");

  const errorKey =
    error === "forbidden"
      ? "sms.settings.errorForbidden"
      : error
        ? "sms.settings.errorInvalid"
        : null;

  return (
    <div className="space-y-5">
      {errorKey && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(errorKey)}
        </p>
      )}
      {ok === "settings" && (
        <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
          {t("sms.settings.saved")}
        </p>
      )}
      {ok === "template" && (
        <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
          {t("sms.settings.templateSaved")}
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
