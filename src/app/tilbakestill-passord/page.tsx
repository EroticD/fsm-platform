import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import Icon, { type IconName } from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
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

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="office-app flex min-h-screen items-center justify-center p-4 text-[var(--ink,#101310)] [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[20px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 shadow-[0_2px_0_rgba(20,17,11,0.08),0_18px_40px_rgba(20,17,11,0.08)] sm:p-8">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--signal,#d8ff3e)]"
        />
        {children}
      </div>
    </div>
  );
}

function AuthHeader({
  icon,
  title,
  description,
  tone = "ink",
}: {
  icon: IconName;
  title: string;
  description: ReactNode;
  tone?: "ink" | "risk";
}) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <div
        className={`relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${
          tone === "risk"
            ? "border border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"
            : "border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)] shadow-[2px_2px_0_var(--signal,#d8ff3e)]"
        }`}
      >
        <Icon name={icon} className="h-5 w-5" />
        {tone === "ink" && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
          />
        )}
      </div>
      <h1
        className={`text-2xl font-extrabold tracking-tight ${
          tone === "risk"
            ? "text-[var(--risk-text,#b42318)]"
            : "text-[var(--ink,#101310)]"
        }`}
      >
        {title}
      </h1>
      <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
        {description}
      </p>
    </div>
  );
}

function AuthAlert({
  children,
  tone = "risk",
}: {
  children: ReactNode;
  tone?: "risk" | "warning";
}) {
  const toneClass =
    tone === "warning"
      ? "border-[#dfc98b] bg-[#fdf5e4] text-[#6b4808]"
      : "border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]";
  return (
    <div
      role="alert"
      className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${toneClass}`}
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
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
        <Link href="/glemt-passord" className="signal-button w-full">
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
        <AuthAlert>{t("auth.reset.invalid")}</AuthAlert>
      )}
      {error === "for_kort" && (
        <AuthAlert tone="warning">{t("auth.reset.tooShort")}</AuthAlert>
      )}
      {error === "for_lang" && (
        <AuthAlert tone="warning">{t("auth.reset.tooLong")}</AuthAlert>
      )}
      {error === "mellomrom" && (
        <AuthAlert tone="warning">{t("auth.reset.whitespace")}</AuthAlert>
      )}

      <form action={resetPassword} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div>
          <label
            htmlFor="reset-password"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("auth.reset.newPassword")}
          </label>
          <input
            id="reset-password"
            type="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.reset.placeholder")}
            className={controlClassName("min-h-11")}
          />
        </div>

        <button type="submit" className="signal-button w-full">
          {t("auth.reset.submit")}
        </button>
      </form>
    </AuthShell>
  );
}
