import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import CopyButton from "@/components/CopyButton";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import { buildTotpUri, isTwoFactorSetupFresh } from "@/lib/two-factor";
import { readRecoveryCodesForDisplay } from "@/lib/session-token";
import {
  cancelSetupAction,
  confirmSetupAction,
  disableTwoFactorAction,
  dismissRecoveryCodesAction,
  regenerateRecoveryCodesAction,
  startSetupAction,
} from "@/app/innstillinger/security-actions";

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button w-full text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";

type SecurityUser = {
  id: string;
  email: string | null;
  name: string | null;
  isTwoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  twoFactorSetupStartedAt: Date | null;
};

export default async function SecuritySettings({
  user,
  setup,
  error,
  ok,
}: {
  user: SecurityUser;
  setup?: string;
  error?: string;
  ok?: string;
}) {
  const isEnabled = Boolean(user.isTwoFactorEnabled);
  const t = await getTranslations("common");
  const recoveryCodes = await readRecoveryCodesForDisplay(user.id);
  // Et påbegynt oppsett skal ikke vise en hemmelighet som er utløpt.
  const setupActive =
    setup === "1" &&
    !isEnabled &&
    Boolean(user.twoFactorSecret) &&
    isTwoFactorSetupFresh(user.twoFactorSetupStartedAt);
  const recoveryFile =
    recoveryCodes && recoveryCodes.length > 0
      ? `data:text/plain;charset=utf-8,${encodeURIComponent(
          `${t("settings.security.recoveryCodes.fileHeader", {
            name: user.email || user.name || "",
          })}\n\n${recoveryCodes.join("\n")}\n\n${t(
            "settings.security.recoveryCodes.fileWarning",
          )}\n`,
        )}`
      : null;

  let qrDataUrl: string | null = null;
  let manualKey: string | null = null;
  if (setupActive && user.twoFactorSecret) {
    manualKey = user.twoFactorSecret;
    const uri = buildTotpUri(user.twoFactorSecret, user.email || "konto");
    qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  }

  return (
    <div className="space-y-4">
      {ok === "enabled" && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] px-4 py-3 text-sm font-bold text-[var(--ink,#101310)]">
          <Icon name="check" className="h-4 w-4 shrink-0" />
          {t("settings.security.enabled")}
        </div>
      )}
      {ok === "disabled" && (
        <div className="flex items-center gap-2 rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] px-4 py-3 text-sm font-bold text-[#6b4a05]">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {t("settings.security.disabled")}
        </div>
      )}
      {ok === "recovery" && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] px-4 py-3 text-sm font-bold text-[var(--ink,#101310)]">
          <Icon name="check" className="h-4 w-4 shrink-0" />
          {t("settings.security.recoveryCodes.regenerated")}
        </div>
      )}

      {recoveryCodes && recoveryFile && (
        <div className="space-y-4 rounded-card border border-[#e2cf9b] bg-[#fbf1d2] p-5">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-[#4a3304]">
              <Icon name="shield" className="h-4 w-4 shrink-0" />
              {t("settings.security.recoveryCodes.title")}
            </h2>
            <p className="mt-1 text-sm text-[#6b4a05]">
              {t("settings.security.recoveryCodes.desc")}
            </p>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code className="block rounded-lg border border-[#e2cf9b] bg-[var(--surface,#fffdf8)] px-3 py-2 text-center font-mono text-sm tracking-wider text-[var(--ink,#101310)]">
                  {code}
                </code>
              </li>
            ))}
          </ul>
          <div className="flex flex-col sm:flex-row gap-2">
            <CopyButton
              value={recoveryCodes.join("\n")}
              label={t("settings.security.recoveryCodes.copy")}
            />
            <a
              href={recoveryFile}
              download="gjenopprettingskoder.txt"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-center text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
            >
              {t("settings.security.recoveryCodes.download")}
            </a>
          </div>
          <p className="text-xs font-semibold text-[#6b4a05]">
            {t("settings.security.recoveryCodes.warning")}
          </p>
          <form action={dismissRecoveryCodesAction}>
            <button
              type="submit"
              className="inline-flex min-h-9 items-center rounded-lg border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85"
            >
              {t("settings.security.recoveryCodes.saved")}
            </button>
          </form>
        </div>
      )}
      {error === "kode" && (
        <div
          id="security-code-error"
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t("settings.security.errorCode")}
        </div>
      )}
      {error === "passord" && (
        <div
          id="security-password-error"
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t("settings.security.errorPassword")}
        </div>
      )}
      {error === "setup-expired" && (
        <div
          id="security-setup-expired-error"
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t("settings.security.errorSetupExpired")}
        </div>
      )}

      <div className="office-card space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
          <div>
            <h2 className="flex items-center gap-2 font-extrabold text-[var(--ink,#101310)]">
              <Icon name="shield" className="h-4 w-4 shrink-0" />
              {t("settings.security.title")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
              {t("settings.security.desc")}
            </p>
          </div>
          <span
            className={`rounded-full border px-2 py-1 text-xs font-bold uppercase whitespace-nowrap ${
              isEnabled
                ? "border-[#c7d98e] bg-[#f3fbd1] text-[#283509]"
                : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
            }`}
          >
            {isEnabled ? t("settings.security.on") : t("settings.security.off")}
          </span>
        </div>

        {/* Oppsett */}
        {setupActive && qrDataUrl && (
          <div className="space-y-4 border-t border-[var(--line,#dedcd1)] pt-4">
            <p className="text-sm text-[var(--ink,#101310)]">{t("settings.security.step1")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={t("settings.security.qrAlt")} className="mx-auto rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2" />
            <div className="text-xs text-[var(--muted,#62685f)]">
              {t("settings.security.manual")}
              <code className="mt-1 block break-all rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2 font-mono text-[var(--ink,#101310)]">{manualKey}</code>
            </div>
            <form action={confirmSetupAction} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
              <div>
                <label htmlFor="security-setup-password" className={LABEL}>
                  {t("settings.security.passwordLabel")}
                </label>
                <input
                  id="security-setup-password"
                  type="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  placeholder={t("settings.security.passwordPlaceholder")}
                  aria-invalid={error === "passord" || undefined}
                  aria-describedby={error === "passord" ? "security-password-error" : undefined}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor="security-setup-code" className={LABEL}>{t("settings.security.step2")}</label>
                <input
                  id="security-setup-code"
                  type="text"
                  name="code"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  aria-invalid={error === "kode" || undefined}
                  aria-describedby={error === "kode" ? "security-code-error" : undefined}
                  className={controlClassName("min-h-11 text-center text-lg font-bold tracking-[0.4em]")}
                />
              </div>
              <button type="submit" className={SIGNAL_BUTTON}>
                {t("settings.security.confirm")}
              </button>
            </form>
            <form action={cancelSetupAction} className="space-y-2">
              <label htmlFor="security-cancel-password" className="sr-only">
                {t("settings.security.passwordLabel")}
              </label>
              <input
                id="security-cancel-password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder={t("settings.security.cancelPlaceholder")}
                aria-invalid={error === "passord" || undefined}
                aria-describedby={error === "passord" ? "security-password-error" : undefined}
                className={FIELD}
              />
              <button type="submit" className="min-h-11 w-full text-sm text-[var(--muted,#62685f)] transition hover:text-[var(--ink,#101310)]">
                {t("settings.security.cancel")}
              </button>
            </form>
          </div>
        )}

        {/* Ikke satt opp */}
        {!isEnabled && !setupActive && (
          <form action={startSetupAction} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
            <div>
              <label
                htmlFor="security-start-password"
                className={LABEL}
              >
                {t("settings.security.passwordConfirm")}
              </label>
              <input
                id="security-start-password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder={t("settings.security.passwordPlaceholder")}
                aria-invalid={error === "passord" || undefined}
                aria-describedby={error === "passord" ? "security-password-error" : undefined}
                className={FIELD}
              />
            </div>
            <button type="submit" className={SIGNAL_BUTTON}>
              {t("settings.security.enable")}
            </button>
          </form>
        )}

        {/* Slå av */}
        {isEnabled && (
          <form action={disableTwoFactorAction} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
            <p className="text-sm text-[var(--ink,#101310)]">{t("settings.security.disableDesc")}</p>
            <div>
              <label htmlFor="security-disable-password" className="sr-only">
                {t("settings.security.passwordLabel")}
              </label>
              <input
                id="security-disable-password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder={t("settings.security.passwordPlaceholder")}
                aria-invalid={error === "passord" || undefined}
                aria-describedby={error === "passord" ? "security-password-error" : undefined}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="security-disable-code" className="sr-only">
                {t("settings.security.codeLabel")}
              </label>
              <input
                id="security-disable-code"
                type="text"
                name="code"
                required
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="000000"
                aria-invalid={error === "kode" || undefined}
                aria-describedby={error === "kode" ? "security-code-error" : undefined}
                className={controlClassName("min-h-11 text-center text-lg font-bold tracking-[0.4em]")}
              />
            </div>
            <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center rounded-[10px] border border-[#e7b7a4] bg-[#fae8e0] py-2.5 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf]">
              {t("settings.security.disable")}
            </button>
          </form>
        )}

        {isEnabled && (
          <form action={regenerateRecoveryCodesAction} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
            <div>
              <p className="text-sm font-bold text-[var(--ink,#101310)]">
                {t("settings.security.recoveryCodes.regenerateTitle")}
              </p>
              <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("settings.security.recoveryCodes.regenerateDesc")}
              </p>
            </div>
            <div>
              <label htmlFor="security-regenerate-password" className="sr-only">
                {t("settings.security.passwordLabel")}
              </label>
              <input
                id="security-regenerate-password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder={t("settings.security.passwordPlaceholder")}
                aria-invalid={error === "passord" || undefined}
                aria-describedby={error === "passord" ? "security-password-error" : undefined}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="security-regenerate-code" className="sr-only">
                {t("settings.security.codeLabel")}
              </label>
              <input
                id="security-regenerate-code"
                type="text"
                name="code"
                required
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="000000"
                aria-invalid={error === "kode" || undefined}
                aria-describedby={error === "kode" ? "security-code-error" : undefined}
                className={controlClassName("min-h-11 text-center text-lg font-bold tracking-[0.4em]")}
              />
            </div>
            <button
              type="submit"
              className={`${INK_BUTTON} w-full`}
            >
              {t("settings.security.recoveryCodes.regenerate")}
            </button>
          </form>
        )}
      </div>

      <div className="text-xs text-[var(--muted,#62685f)]">
        {t("settings.security.loggedInAs", { name: user.name || user.email || "" })}
      </div>
    </div>
  );
}
