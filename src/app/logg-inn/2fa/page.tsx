import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { readPendingTwoFactor } from "@/lib/session-token";
import { verifyRecoveryCodeAction, verifyTwoFactorAction } from "../actions";
import SubmitButton from "../SubmitButton";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";

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
    <div className="office-app flex min-h-screen items-center justify-center p-4 text-[var(--ink,#101310)] [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[20px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 shadow-[0_2px_0_rgba(20,17,11,0.08),0_18px_40px_rgba(20,17,11,0.08)] sm:p-8">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--signal,#d8ff3e)]"
        />

        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)] shadow-[2px_2px_0_var(--signal,#d8ff3e)]">
            <Icon name="shield" className="h-5 w-5" />
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
            />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)]">
            {t("auth.twoFactor.title")}
          </h1>
          <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("auth.twoFactor.desc", { companyName })}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-2 text-sm font-bold text-[var(--risk-text,#b42318)]"
          >
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form action={verifyTwoFactorAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label
              htmlFor="code"
              className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
            >
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
              className={controlClassName(
                "min-h-11 text-center text-lg font-bold tracking-[0.4em]",
              )}
            />
          </div>
          <SubmitButton
            idleLabel={t("auth.twoFactor.verify")}
            pendingLabel={t("auth.twoFactor.verifying")}
          />
        </form>

        <details
          open={recovery === "1" || errorParam === "InvalidRecoveryCode"}
          className="group mt-5 border-t border-[var(--line,#dedcd1)] pt-4"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:text-[var(--muted,#62685f)] [&::-webkit-details-marker]:hidden">
            {t("auth.twoFactor.recovery.link")}
            <Icon
              name="chevronDown"
              className="h-4 w-4 shrink-0 transition group-open:rotate-180"
            />
          </summary>
          <form action={verifyRecoveryCodeAction} className="mt-3 space-y-3">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <div>
              <label
                htmlFor="recoveryCode"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
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
                className={controlClassName(
                  "min-h-11 text-center text-lg font-bold uppercase tracking-[0.2em]",
                )}
              />
              <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                {t("auth.twoFactor.recovery.hint")}
              </p>
            </div>
            <SubmitButton
              idleLabel={t("auth.twoFactor.recovery.submit")}
              pendingLabel={t("auth.twoFactor.recovery.submitting")}
            />
          </form>
        </details>

        <div className="mt-6 text-center">
          <Link
            href="/logg-inn"
            className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
          >
            {t("auth.twoFactor.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}
