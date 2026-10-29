import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import Link from "next/link";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/invite";
import {
  PASSWORD_MIN_LENGTH,
  validatePassword,
  type PasswordPolicyError,
} from "@/lib/password-policy";
import {
  clearRetryToken,
  readRetryToken,
  rememberRetryToken,
} from "@/lib/retry-token";
import { bumpSessionVersion } from "@/lib/session";
import { clearCalendarToken } from "@/server/calendar-feed";

const RETRY_TOKEN_COOKIE = "fsm-activate-token";

/** Feilkode i adressen – selve engangsnøkkelen skal aldri dit. */
function policyErrorCode(error: PasswordPolicyError): string {
  if (error === "too_short") return "for_kort";
  if (error === "too_long") return "for_lang";
  return "mellomrom";
}

export const dynamic = "force-dynamic";

export default async function ActivateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; success?: string }>;
}) {
  const { token, error, success } = await searchParams;
  const t = await getTranslations("common");

  // Ved en valideringsfeil legges nøkkelen i en kortlevd HttpOnly-cookie i
  // stedet for å skrives tilbake i adressefeltet. Da kan skjemaet vises på
  // nytt uten at nøkkelen havner i historikk, logger eller Referer.
  const retryToken = token ? null : await readRetryToken(RETRY_TOKEN_COOKIE);
  const effectiveToken = token || retryToken || undefined;

  // --- SERVER ACTION: sett eget passord ---
  async function setPassword(formData: FormData) {
    "use server";
    const newPassword = formData.get("password") as string;
    const confirmPassword = formData.get("confirm") as string;
    const formToken = (formData.get("token") as string | null)?.trim() ?? "";

    if (!formToken) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    const policyError = validatePassword(newPassword);
    if (policyError) {
      await rememberRetryToken(RETRY_TOKEN_COOKIE, formToken);
      redirect(`/aktiver-konto?error=${policyErrorCode(policyError)}`);
    }
    if (newPassword !== confirmPassword) {
      await rememberRetryToken(RETRY_TOKEN_COOKIE, formToken);
      redirect(`/aktiver-konto?error=ulike`);
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashToken(formToken),
        resetTokenExpiry: { gt: new Date() },
        // Bare invitasjoner til kontoer som ennå ikke er aktivert. En aktiv
        // bruker skal bruke «glemt passord», aldri en invitasjonslenke.
        isActive: false,
      },
    });

    if (!user) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Passordet lagres, men kontoen er fortsatt inaktiv til en administrator
    // aktiverer den. Nøkkelen kan bare brukes én gang. Sjekken gjentas i
    // UPDATE-en, slik at en samtidig aktivering ikke kan omgås.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: user.id,
          resetToken: hashToken(formToken),
          resetTokenExpiry: { gt: new Date() },
          isActive: false,
        },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
      });
      if (result.count !== 1) return false;

      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: `Bruker satte eget passord: ${user.name || user.email}`,
        actor: { id: user.id, name: user.name, email: user.email },
        metadata: { method: "activation_invite" },
      });
      return true;
    });
    if (!updated) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    await clearRetryToken(RETRY_TOKEN_COOKIE);
    await bumpSessionVersion(user.id);
    await clearCalendarToken(user.id);

    redirect("/aktiver-konto?success=true");
  }

  // --- SUKSESS ---
  if (success === "true") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">✅</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t("auth.activate.successTitle")}</h1>
          <p className="text-gray-600 mb-6">
            {t("auth.activate.successDesc")}
          </p>
          <Link
            href="/logg-inn"
            className="inline-block text-white px-6 py-2.5 rounded-xl font-bold"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {t("auth.activate.toLogin")}
          </Link>
        </div>
      </div>
    );
  }

  // --- MANGLER NØKKEL ---
  if (!effectiveToken) {
    const invalid = error === "ugyldig";
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">
            {invalid ? t("auth.activate.invalidTitle") : t("auth.activate.missingTitle")}
          </h1>
          <p className="text-gray-600 mb-6">
            {invalid ? t("auth.activate.invalidDesc") : t("auth.activate.missingDesc")}
          </p>
          <Link
            href="/logg-inn"
            className="inline-block bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold"
          >
            {t("auth.activate.toLogin")}
          </Link>
        </div>
      </div>
    );
  }

  // --- VALIDER NØKKEL ---
  const user = await prisma.user.findFirst({
    where: {
      resetToken: hashToken(effectiveToken),
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">{t("auth.activate.invalidTitle")}</h1>
          <p className="text-gray-600 mb-6">
            {t("auth.activate.invalidDesc")}
          </p>
          <Link
            href="/logg-inn"
            className="inline-block bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold"
          >
            {t("auth.activate.toLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("auth.activate.welcome")}</h1>
        <p className="text-gray-500 text-sm mb-6">
          {t.rich("auth.activate.desc", {
            email: user.email ?? "",
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>

        {error === "ugyldig" && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-red-200">
            {t("auth.activate.errors.invalid")}
          </div>
        )}
        {error === "for_kort" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            {t("auth.activate.errors.tooShort")}
          </div>
        )}
        {error === "for_lang" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            {t("auth.activate.errors.tooLong")}
          </div>
        )}
        {error === "mellomrom" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            {t("auth.activate.errors.whitespace")}
          </div>
        )}
        {error === "ulike" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            {t("auth.activate.errors.mismatch")}
          </div>
        )}

        <form action={setPassword} className="space-y-4">
          <input type="hidden" name="token" value={effectiveToken} />

          <div>
            <label htmlFor="activate-password" className="block text-sm font-semibold text-gray-700 mb-1">{t("auth.activate.newPassword")}</label>
            <input
              id="activate-password"
              type="password"
              name="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              placeholder={t("auth.activate.newPasswordPlaceholder")}
              className="w-full border p-3 rounded-xl text-gray-800"
            />
          </div>

          <div>
            <label htmlFor="activate-confirm" className="block text-sm font-semibold text-gray-700 mb-1">
              {t("auth.activate.confirm")}
            </label>
            <input
              id="activate-confirm"
              type="password"
              name="confirm"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              placeholder={t("auth.activate.confirmPlaceholder")}
              className="w-full border p-3 rounded-xl text-gray-800"
            />
          </div>

          <button
            type="submit"
            className="w-full text-white py-3 rounded-xl font-bold hover:opacity-90 transition"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {t("auth.activate.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
