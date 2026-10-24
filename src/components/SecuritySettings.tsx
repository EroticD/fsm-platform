import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import prisma from "@/lib/prisma";
import { actorName, bumpSessionVersion, getCurrentUser } from "@/lib/session";
import { buildTotpUri, createTotpSecret, verifyTotp } from "@/lib/two-factor";
import { cleanText } from "@/lib/sanitize";

type SecurityUser = {
  id: string;
  email: string | null;
  name: string | null;
  isTwoFactorEnabled: boolean;
  twoFactorSecret: string | null;
};

const BASE = "/innstillinger?tab=sikkerhet";

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

  /**
   * Krever at innlogget bruker er den samme som fanen gjelder, og at
   * nåværende passord oppgis. Det hindrer at en kapret økt kan starte eller
   * avbryte 2FA-oppsett uten å kjenne passordet.
   */
  async function verifyOwnPassword(formData: FormData): Promise<boolean> {
    const current = await getCurrentUser();
    if (!current || current.id !== user.id) return false;
    const password = String(formData.get("password") ?? "");
    if (!current.password || !password) return false;
    return bcrypt.compare(password, current.password);
  }

  async function startSetup(formData: FormData) {
    "use server";
    if (!(await verifyOwnPassword(formData))) {
      redirect(`${BASE}&error=passord`);
    }

    const secret = createTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret, isTwoFactorEnabled: false },
    });
    revalidatePath("/innstillinger");
    redirect(`${BASE}&setup=1`);
  }

  async function confirmSetup(formData: FormData) {
    "use server";
    const current = await getCurrentUser();
    if (!current || current.id !== user.id) return;

    const code = cleanText(formData.get("code"), { maxLength: 10 });
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorSecret: true },
    });
    if (!dbUser?.twoFactorSecret || !verifyTotp(dbUser.twoFactorSecret, code)) {
      redirect(`${BASE}&setup=1&error=kode`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isTwoFactorEnabled: true },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: user.id,
        action: "Slå på to-trinns verifisering",
        userName: await actorName(),
      },
    });
    revalidatePath("/innstillinger");
    redirect(`${BASE}&ok=enabled`);
  }

  async function cancelSetup(formData: FormData) {
    "use server";
    if (!(await verifyOwnPassword(formData))) {
      redirect(`${BASE}&error=passord`);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: null, isTwoFactorEnabled: false },
    });
    revalidatePath("/innstillinger");
    redirect(BASE);
  }

  async function disableTwoFactor(formData: FormData) {
    "use server";
    const current = await getCurrentUser();
    if (!current || current.id !== user.id) return;

    const code = cleanText(formData.get("code"), { maxLength: 10 });
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorSecret: true, isTwoFactorEnabled: true },
    });
    if (
      !dbUser?.isTwoFactorEnabled ||
      !dbUser.twoFactorSecret ||
      !verifyTotp(dbUser.twoFactorSecret, code)
    ) {
      redirect(`${BASE}&error=kode`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isTwoFactorEnabled: false, twoFactorSecret: null },
    });
    // Ugyldiggjør eksisterende økter når 2FA slås av.
    await bumpSessionVersion(user.id);
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: user.id,
        action: "Slå av to-trinns verifisering",
        userName: await actorName(),
      },
    });
    revalidatePath("/innstillinger");
    redirect(`${BASE}&ok=disabled`);
  }

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
      {error === "kode" && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {t("settings.security.errorCode")}
        </div>
      )}
      {error === "passord" && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
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
            className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase whitespace-nowrap ${
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
            <form action={confirmSetup} className="space-y-3 border-t pt-4">
              <label className="block text-sm font-bold text-gray-700">{t("settings.security.step2")}</label>
              <input
                type="text"
                name="code"
                required
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="000000"
                className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.4em] font-bold text-gray-900 bg-white"
              />
              <button type="submit" className="w-full bg-green-600 text-white py-2.5 rounded-xl font-bold hover:bg-green-700 transition">
                {t("settings.security.confirm")}
              </button>
            </form>
            <form action={cancelSetup} className="space-y-2">
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder={t("settings.security.cancelPlaceholder")}
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
          <form action={startSetup} className="border-t pt-4 space-y-3">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                {t("settings.security.passwordConfirm")}
              </label>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder={t("settings.security.passwordPlaceholder")}
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
          <form action={disableTwoFactor} className="border-t pt-4 space-y-3">
            <p className="text-sm text-gray-700">{t("settings.security.disableDesc")}</p>
            <input
              type="text"
              name="code"
              required
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="000000"
              className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.4em] font-bold text-gray-900 bg-white"
            />
            <button type="submit" className="w-full bg-white border-2 border-red-200 text-red-700 py-2.5 rounded-xl font-bold hover:bg-red-50 transition">
              {t("settings.security.disable")}
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
