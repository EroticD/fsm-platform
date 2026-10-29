import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import ErrorBanner from "@/components/ErrorBanner";
import { controlClassName } from "@/components/ui/controlStyles";
import { loginAction } from "./actions";
import SubmitButton from "./SubmitButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("loginTitle") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error: errorParam, callbackUrl = "/" } = await searchParams;
  const t = await getTranslations("common");

  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName || "FSM System";

  let error: string | null = null;
  if (errorParam) {
    switch (errorParam) {
      case "CredentialsSignin":
        error = t("loginErrorCredentials");
        break;
      case "AccountNotActivated":
        error = t("loginErrorInactive");
        break;
      case "AccessDenied":
        error = t("loginErrorAccessDenied");
        break;
      case "SessionRequired":
        error = t("loginErrorSessionRequired");
        break;
      case "TooManyAttempts":
        error = t("loginErrorTooMany");
        break;
      case "TwoFactorUnavailable":
        error = t("loginErrorTwoFactorUnavailable");
        break;
      case "TwoFactorExpired":
        error = t("auth.twoFactor.errors.TwoFactorExpired");
        break;
      default:
        error = t("loginErrorDefault");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas,#f4f5f2)] p-4 text-[var(--ink,#101310)] [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[20px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 shadow-[0_2px_0_rgba(20,17,11,0.08),0_18px_40px_rgba(20,17,11,0.08)] sm:p-8">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--signal,#d8ff3e)]"
        />
        <div className="mb-6 flex flex-col items-center">
          <div
            className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-xl font-bold text-[var(--paper,#f2efe6)] shadow-[2px_2px_0_var(--signal,#d8ff3e)]"
            suppressHydrationWarning
          >
            {companyName.charAt(0).toUpperCase()}
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
            />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)]">
            {t("loginTitle")}
          </h1>
          <p className="mt-1 text-center text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("loginDescCompany", { companyName })}
          </p>
        </div>

        <ErrorBanner id="login-error" message={error} className="mb-4 border" />

        {/*
          Skjemaet sender e-post og passord i selve forespørselen (POST) via en
          server-action, slik at passordet aldri havner i adressefeltet – og
          slik at innloggingen også virker på enheter der JavaScript ikke har
          rukket å laste/hydrere ennå.
        */}
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
            >
              {t("emailLabel")}
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="username"
              placeholder={t("emailPlaceholder")}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              className={controlClassName("min-h-11")}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
            >
              {t("passwordLabel")}
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              className={controlClassName("min-h-11")}
            />
          </div>

          <SubmitButton idleLabel={t("loginButton")} pendingLabel={t("loginPending")} />
        </form>

        <div className="text-center mt-6">
          <Link
            href="/glemt-passord"
            className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
          >
            {t("forgotPassword")}
          </Link>
        </div>
      </div>
    </div>
  );
}
