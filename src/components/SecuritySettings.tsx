import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import CopyButton from "@/components/CopyButton";
import { buildTotpUri } from "@/lib/two-factor";
import { readRecoveryCodesForDisplay } from "@/lib/session-token";
import {
  cancelSetupAction,
  confirmSetupAction,
  disableTwoFactorAction,
  dismissRecoveryCodesAction,
  regenerateRecoveryCodesAction,
  startSetupAction,
} from "@/app/innstillinger/security-actions";

type SecurityUser = {
  id: string;
  email: string | null;
  name: string | null;
  isTwoFactorEnabled: boolean;
  twoFactorSecret: string | null;
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
  const recoveryCodes = await readRecoveryCodesForDisplay();
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
  if (setup === "1" && !isEnabled && user.twoFactorSecret) {
    manualKey = user.twoFactorSecret;
    const uri = buildTotpUri(user.twoFactorSecret, user.email || "konto");
    qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  }

  return (
    <div className="space-y-4">
      {ok === "enabled" && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-3 font-medium">
          {t("settings.security.enabled")}
        </div>
      )}
      {ok === "disabled" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 font-medium">
          {t("settings.security.disabled")}
        </div>
      )}
      {ok === "recovery" && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-3 font-medium">
          {t("settings.security.recoveryCodes.regenerated")}
        </div>
      )}

      {recoveryCodes && recoveryFile && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-amber-950">
              {t("settings.security.recoveryCodes.title")}
            </h2>
            <p className="text-sm text-amber-800 mt-1">
              {t("settings.security.recoveryCodes.desc")}
            </p>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code className="block bg-white border border-amber-200 rounded-lg px-3 py-2 font-mono text-sm tracking-wider text-gray-900 text-center">
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
              className="text-xs font-bold border border-gray-300 bg-white text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-100 transition text-center"
            >
              {t("settings.security.recoveryCodes.download")}
            </a>
          </div>
          <p className="text-xs font-semibold text-amber-900">
            {t("settings.security.recoveryCodes.warning")}
          </p>
          <form action={dismissRecoveryCodesAction}>
            <button
              type="submit"
              className="text-xs font-bold bg-amber-900 text-white px-3 py-2 rounded-lg hover:bg-amber-950 transition"
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
          className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3"
        >
          {t("settings.security.errorCode")}
        </div>
      )}
      {error === "passord" && (
        <div
          id="security-password-error"
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3"
        >
          {t("settings.security.errorPassword")}
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">{t("settings.security.title")}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {t("settings.security.desc")}
            </p>
          </div>
          <span
            className={`text-xs font-bold px-2 py-1 rounded-full uppercase whitespace-nowrap ${
              isEnabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
            }`}
          >
            {isEnabled ? t("settings.security.on") : t("settings.security.off")}
          </span>
        </div>

        {/* Oppsett */}
        {setup === "1" && !isEnabled && qrDataUrl && (
          <div className="border-t pt-4 space-y-4">
            <p className="text-sm text-gray-700">{t("settings.security.step1")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={t("settings.security.qrAlt")} className="mx-auto rounded-xl border border-gray-200 bg-white p-2" />
            <div className="text-xs text-gray-500">
              {t("settings.security.manual")}
              <code className="block mt-1 bg-gray-100 rounded-lg p-2 font-mono text-gray-900 break-all">{manualKey}</code>
            </div>
            <form action={confirmSetupAction} className="space-y-3 border-t pt-4">
              <label htmlFor="security-setup-code" className="block text-sm font-bold text-gray-700">{t("settings.security.step2")}</label>
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.4em] font-bold text-gray-900 bg-white"
              />
              <button type="submit" className="w-full bg-green-600 text-white py-2.5 rounded-xl font-bold hover:bg-green-700 transition">
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
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
              <button type="submit" className="w-full text-sm text-gray-500 hover:text-gray-800 transition">
                {t("settings.security.cancel")}
              </button>
            </form>
          </div>
        )}

        {/* Ikke satt opp */}
        {!isEnabled && setup !== "1" && (
          <form action={startSetupAction} className="border-t pt-4 space-y-3">
            <div>
              <label
                htmlFor="security-start-password"
                className="block text-sm font-bold text-gray-700 mb-1"
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <button type="submit" className="w-full bg-[var(--primary-color)] text-white py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
              {t("settings.security.enable")}
            </button>
          </form>
        )}

        {/* Slå av */}
        {isEnabled && (
          <form action={disableTwoFactorAction} className="border-t pt-4 space-y-3">
            <p className="text-sm text-gray-700">{t("settings.security.disableDesc")}</p>
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white"
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.4em] font-bold text-gray-900 bg-white"
              />
            </div>
            <button type="submit" className="w-full bg-white border-2 border-red-200 text-red-700 py-2.5 rounded-xl font-bold hover:bg-red-50 transition">
              {t("settings.security.disable")}
            </button>
          </form>
        )}

        {isEnabled && (
          <form action={regenerateRecoveryCodesAction} className="border-t pt-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-gray-700">
                {t("settings.security.recoveryCodes.regenerateTitle")}
              </p>
              <p className="text-xs text-gray-500 mt-1">
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
                className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-white border border-gray-300 text-gray-800 py-2.5 rounded-xl font-bold hover:bg-gray-50 transition"
            >
              {t("settings.security.recoveryCodes.regenerate")}
            </button>
          </form>
        )}
      </div>

      <div className="text-xs text-gray-500">
        {t("settings.security.loggedInAs", { name: user.name || user.email || "" })}
      </div>
    </div>
  );
}
