import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  AuthAlert,
  AuthHeader,
  AuthShell,
} from "@/components/auth/AuthShell";
import Button, { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
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
      <AuthShell>
        <AuthHeader
          icon="alert"
          tone="risk"
          title={
            invalid ? t("auth.reset.invalid") : t("auth.reset.missingTitle")
          }
          description={t("auth.reset.missingDesc")}
        />
        <Link
          href="/glemt-passord"
          className={`${buttonClassName()} w-full`}
        >
          {t("auth.reset.missingButton")}
        </Link>
      </AuthShell>
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
    <AuthShell>
      <AuthHeader
        icon="pen"
        title={t("auth.reset.title")}
        description={t("auth.reset.desc")}
      />

      {error === "ugyldig" && (
        <AuthAlert message={t("auth.reset.invalid")} />
      )}
      {error === "for_kort" && (
        <AuthAlert tone="warning" message={t("auth.reset.tooShort")} />
      )}
      {error === "for_lang" && (
        <AuthAlert tone="warning" message={t("auth.reset.tooLong")} />
      )}
      {error === "mellomrom" && (
        <AuthAlert tone="warning" message={t("auth.reset.whitespace")} />
      )}

      <form action={resetPassword} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <Field label={t("auth.reset.newPassword")} required>
          <Input
            type="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.reset.placeholder")}
          />
        </Field>

        <Button type="submit" className="w-full">
          {t("auth.reset.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
