import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import ErrorBanner from "@/components/ErrorBanner";
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
      default:
        error = t("loginErrorDefault");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm mb-3"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {companyName.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t("loginTitle")}</h1>
          <p className="text-sm text-gray-500 mt-1">
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
              className="block text-sm font-bold text-gray-700 mb-1"
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
              className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-bold text-gray-700 mb-1"
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
              className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent"
            />
          </div>

          <SubmitButton idleLabel={t("loginButton")} pendingLabel={t("loginPending")} />
        </form>

        <div className="text-center mt-6">
          <Link
            href="/glemt-passord"
            className="text-sm font-medium text-gray-500 hover:text-gray-800 transition"
          >
            {t("forgotPassword")}
          </Link>
        </div>
      </div>
    </div>
  );
}
