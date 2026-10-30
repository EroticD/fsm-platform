import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { readPendingTwoFactor } from "@/lib/session-token";
import { verifyRecoveryCodeAction, verifyTwoFactorAction } from "../actions";
import SubmitButton from "../SubmitButton";
import Icon from "@/components/icons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("auth.twoFactor.title") };
}

const ERROR_CODES = new Set([
  "InvalidTwoFactor",
  "InvalidRecoveryCode",
  "TwoFactorExpired",
  "TooManyAttempts",
]);

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
    recovery?: string;
  }>;
}) {
  // Les feilen før cookie-sjekken: en utløpt «venter på 2FA»-cookie skal gi
  // en forklaring på innloggingssiden i stedet for en stille omdirigering.
  const {
    error: errorParam,
    callbackUrl = "/",
    recovery,
  } = await searchParams;

  const userId = await readPendingTwoFactor();
  if (!userId) {
    if (errorParam === "TwoFactorExpired") {
      const params = new URLSearchParams({ error: "TwoFactorExpired" });
      if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
      redirect(`/logg-inn?${params.toString()}`);
    }
    redirect("/logg-inn");
  }

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
            <Icon name="shield" className="h-6 w-6" />
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
              className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.4em] text-gray-900 bg-white font-bold focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent"
            />
          </div>
          <SubmitButton
            idleLabel={t("auth.twoFactor.verify")}
            pendingLabel={t("auth.twoFactor.verifying")}
          />
        </form>

        <details
          open={recovery === "1" || errorParam === "InvalidRecoveryCode"}
          className="mt-5 border-t pt-4"
        >
          <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900 transition">
            {t("auth.twoFactor.recovery.link")}
          </summary>
          <form action={verifyRecoveryCodeAction} className="space-y-3 mt-4">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <div>
              <label
                htmlFor="recoveryCode"
                className="block text-sm font-bold text-gray-700 mb-1"
              >
                {t("auth.twoFactor.recovery.label")}
              </label>
              <input
                id="recoveryCode"
                type="text"
                name="recoveryCode"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={9}
                placeholder="XXXX-XXXX"
                className="w-full border border-gray-300 p-2.5 rounded-xl text-center text-lg tracking-[0.2em] text-gray-900 bg-white font-bold uppercase focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t("auth.twoFactor.recovery.hint")}
              </p>
            </div>
            <SubmitButton
              idleLabel={t("auth.twoFactor.recovery.submit")}
              pendingLabel={t("auth.twoFactor.recovery.submitting")}
            />
          </form>
        </details>

        <div className="text-center mt-6">
          <Link href="/logg-inn" className="text-sm font-medium text-gray-500 hover:text-gray-800 transition">
            {t("auth.twoFactor.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}
