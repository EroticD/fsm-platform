import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  PASSWORD_MIN_LENGTH,
  validatePassword,
  type PasswordPolicyError,
} from "@/lib/password-policy";
import { resetPasswordWithToken } from "@/lib/password-reset";
import {
  clearRetryToken,
  readRetryToken,
  rememberRetryToken,
} from "@/lib/retry-token";

const RETRY_TOKEN_COOKIE = "fsm-reset-token";

/** Feilkode i adressen – selve engangsnøkkelen skal aldri dit. */
function policyErrorCode(error: PasswordPolicyError): string {
  if (error === "too_short") return "for_kort";
  if (error === "too_long") return "for_lang";
  return "mellomrom";
}

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string, error?: string }> }) {
  const resolvedParams = await searchParams;
  const error = resolvedParams.error;
  // Ved valideringsfeil beholdes nøkkelen i en kortlevd HttpOnly-cookie, ikke
  // i adressefeltet. Da unngår vi at den havner i historikk og logger.
  const retryToken = resolvedParams.token
    ? null
    : await readRetryToken(RETRY_TOKEN_COOKIE);
  const token = resolvedParams.token || retryToken || undefined;
  const t = await getTranslations("common");

  // Sikkerhetssjekk: Kom de hit uten token?
  if (!token) {
    const invalid = error === "ugyldig";
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">
            {invalid ? t("auth.reset.invalid") : t("auth.reset.missingTitle")}
          </h1>
          <p className="text-gray-600 mb-6">{t("auth.reset.missingDesc")}</p>
          <Link href="/glemt-passord" className="bg-gray-800 text-white px-6 py-2 rounded-lg font-bold">{t("auth.reset.missingButton")}</Link>
        </div>
      </div>
    );
  }

  async function resetPassword(formData: FormData) {
    "use server";
    const newPassword = formData.get("password") as string;
    const formToken = (formData.get("token") as string | null)?.trim() ?? "";

    if (!formToken) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/tilbakestill-passord?error=ugyldig`);
    }

    const policyError = validatePassword(newPassword);
    if (policyError) {
      await rememberRetryToken(RETRY_TOKEN_COOKIE, formToken);
      redirect(`/tilbakestill-passord?error=${policyErrorCode(policyError)}`);
    }

    const result = await resetPasswordWithToken(formToken, newPassword);
    if (result === "invalid") {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/tilbakestill-passord?error=ugyldig`);
    }
    if (result !== "ok") {
      await rememberRetryToken(RETRY_TOKEN_COOKIE, formToken);
      redirect(`/tilbakestill-passord?error=${policyErrorCode(result)}`);
    }

    await clearRetryToken(RETRY_TOKEN_COOKIE);
    // Sender brukeren til innlogging
    redirect("/api/auth/signin");
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border">
        
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("auth.reset.title")}</h1>
        <p className="text-gray-500 text-sm mb-6">{t("auth.reset.desc")}</p>
        
        {error === "ugyldig" && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-red-200">
            {t("auth.reset.invalid")}
          </div>
        )}
        {error === "for_kort" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg border border-yellow-200 text-sm font-semibold mb-4">
            {t("auth.reset.tooShort")}
          </div>
        )}
        {error === "for_lang" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg border border-yellow-200 text-sm font-semibold mb-4">
            {t("auth.reset.tooLong")}
          </div>
        )}
        {error === "mellomrom" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg border border-yellow-200 text-sm font-semibold mb-4">
            {t("auth.reset.whitespace")}
          </div>
        )}

        <form action={resetPassword} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          
          <div>
            <label htmlFor="reset-password" className="block text-sm font-semibold text-gray-700 mb-1">{t("auth.reset.newPassword")}</label>
            <input id="reset-password" type="password" name="password" required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" placeholder={t("auth.reset.placeholder")} className="w-full border p-3 rounded-xl text-gray-800" />
          </div>
          
          <button type="submit" className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition">
            {t("auth.reset.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
