import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { EMAIL_EVENT_KEYS, type EmailEventKey } from "@/lib/email-events";
import type { EmailSettingsView } from "@/server/email-outbox";

type Props = {
  settings: EmailSettingsView;
  smtpConfigured: boolean;
  error?: string;
  ok?: string;
  saveSettings: (formData: FormData) => Promise<void>;
  sendTest: (formData: FormData) => Promise<void>;
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const CARD = "office-card space-y-4 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";

const EVENT_LABEL_KEYS: Record<EmailEventKey, string> = {
  quoteSent: "email.settings.events.quoteSent",
  invoiceSent: "email.settings.events.invoiceSent",
  paymentReceived: "email.settings.events.paymentReceived",
  bookingRequested: "email.settings.events.bookingRequested",
  bookingConfirmed: "email.settings.events.bookingConfirmed",
  bookingCancelled: "email.settings.events.bookingCancelled",
  workOrderAssigned: "email.settings.events.workOrderAssigned",
};

function errorKey(error: string | undefined): string | null {
  if (error === "forbidden") return "email.settings.errorForbidden";
  if (error === "invalid") return "email.settings.errorInvalid";
  if (error === "smtp_not_configured") return "email.settings.errorSmtp";
  if (error === "send_failed" || error === "enqueue_failed") {
    return "email.settings.errorSend";
  }
  return error ? "email.settings.errorSend" : null;
}

export default async function EmailSettingsTab({
  settings,
  smtpConfigured,
  error,
  ok,
  saveSettings,
  sendTest,
}: Props) {
  const t = await getTranslations("common");
  const errorMessage = errorKey(error);

  return (
    <div data-email-settings className="space-y-5">
      {errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(errorMessage)}
        </p>
      )}
      {ok === "settings" && (
        <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
          {t("email.settings.saved")}
        </p>
      )}
      {ok === "test" && (
        <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
          {t("email.settings.testSent")}
        </p>
      )}

      <section className={CARD}>
        <div className="flex items-start gap-3">
          <Icon name="mail" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
              {t("email.settings.title")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
              {t("email.settings.description")}
            </p>
          </div>
        </div>

        <p
          className={`rounded-xl border p-3 text-sm font-bold ${
            smtpConfigured
              ? "border-[#b9c99a] bg-[#eef7d6] text-[#283509]"
              : "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]"
          }`}
        >
          {smtpConfigured
            ? t("email.settings.smtpOn")
            : t("email.settings.smtpOff")}
        </p>
        <p className={MUTED}>{t("email.settings.smtpHint")}</p>

        <form action={saveSettings} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="email-from-name" className={LABEL}>
                {t("email.settings.fromName")}
              </label>
              <input
                id="email-from-name"
                name="fromName"
                defaultValue={settings.fromName ?? ""}
                maxLength={200}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="email-from-address" className={LABEL}>
                {t("email.settings.fromAddress")}
              </label>
              <input
                id="email-from-address"
                name="fromAddress"
                type="email"
                defaultValue={settings.fromAddress ?? ""}
                maxLength={254}
                placeholder={t("email.settings.fromPlaceholder")}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="email-reply-to" className={LABEL}>
                {t("email.settings.replyTo")}
              </label>
              <input
                id="email-reply-to"
                name="replyTo"
                type="email"
                defaultValue={settings.replyTo ?? ""}
                maxLength={254}
                placeholder={t("email.settings.replyPlaceholder")}
                className={INPUT}
              />
            </div>
          </div>
          <p className={MUTED}>{t("email.settings.fromHint")}</p>

          <div>
            <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
              {t("email.settings.eventsTitle")}
            </h3>
            <p className={`mt-1 ${MUTED}`}>
              {t("email.settings.eventsHint")}
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {EMAIL_EVENT_KEYS.map((eventKey) => (
                <li key={eventKey}>
                  <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]">
                    <input
                      type="checkbox"
                      name={`event_${eventKey}`}
                      defaultChecked={settings.events[eventKey]}
                      className="h-4 w-4"
                    />
                    {t(EVENT_LABEL_KEYS[eventKey])}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <button type="submit" className={BUTTON}>
            {t("email.settings.save")}
          </button>
        </form>
      </section>

      <section className={CARD}>
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("email.settings.testTitle")}
        </h2>
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("email.settings.testHint")}
        </p>
        <form action={sendTest} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="email-test-to" className={LABEL}>
              {t("email.settings.testRecipient")}
            </label>
            <input
              id="email-test-to"
              name="to"
              type="email"
              required
              maxLength={254}
              className={INPUT}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className={BUTTON}>
              {t("email.settings.testSend")}
            </button>
          </div>
        </form>
        <p className={MUTED}>{t("email.settings.testPrivacy")}</p>
      </section>
    </div>
  );
}
