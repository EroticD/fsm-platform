import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { readPendingTwoFactor } from "@/lib/session-token";
import { verifyTwoFactorAction } from "../actions";
import SubmitButton from "../SubmitButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("auth.twoFactor.title") };
}

const ERROR_CODES = new Set([
  "InvalidTwoFactor",
  "TwoFactorExpired",
  "TooManyAttempts",
]);

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  // Ingen gyldig «venter på 2FA»-cookie? Da skal man ikke være her.
  const userId = await readPendingTwoFactor();
  if (!userId) redirect("/logg-inn");

  const { error: errorParam, callbackUrl = "/" } = await searchParams;
  const t = await getTranslations("common");
  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName || "FSM System";
  const error = errorParam
    ? t(
        `auth.twoFactor.errors.${
          ERROR_CODES.has(errorParam) ? errorParam : "default"
        }`,
      )
    : null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm mb-3"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            🔐
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t("auth.twoFactor.title")}</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            {t("auth.twoFactor.desc", { companyName })}
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <form action={verifyTwoFactorAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label htmlFor="code" className="block text-sm font-bold text-gray-700 mb-1">
              {t("auth.twoFactor.codeLabel")}
            </label>
            <input
              id="code"
              type="text"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="000000"
              autoFocus
              className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.4em] text-gray-900 bg-white font-bold focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent outline-none"
            />
          </div>
          <SubmitButton
            idleLabel={t("auth.twoFactor.verify")}
            pendingLabel={t("auth.twoFactor.verifying")}
          />
        </form>

        <div className="text-center mt-6">
          <Link href="/logg-inn" className="text-sm font-medium text-gray-500 hover:text-gray-800 transition">
            {t("auth.twoFactor.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}
