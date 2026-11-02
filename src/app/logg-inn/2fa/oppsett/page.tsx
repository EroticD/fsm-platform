import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import prisma from "@/lib/prisma";
import {
  clearPendingTwoFactor,
  readPendingTwoFactor,
} from "@/lib/session-token";
import { buildTotpUri, isTwoFactorSetupFresh } from "@/lib/two-factor";
import { controlClassName } from "@/components/ui/controlStyles";
import Icon from "@/components/icons";
import SubmitButton from "../../SubmitButton";
import {
  confirmRequiredEnrollmentAction,
  startRequiredEnrollmentAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("auth.enrollment.title") };
}

const ERROR_KEYS = new Set([
  "expired",
  "invalid_code",
  "setup_expired",
  "forbidden",
  "already_enabled",
  "TooManyAttempts",
]);

export default async function RequiredEnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await readPendingTwoFactor();
  if (!userId) redirect("/logg-inn");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      isTwoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorSetupStartedAt: true,
    },
  });
  if (!user?.isActive) {
    await clearPendingTwoFactor();
    redirect("/logg-inn");
  }
  if (user.isTwoFactorEnabled) redirect("/logg-inn/2fa");

  const { error: errorParam } = await searchParams;
  const t = await getTranslations("common");
  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName || "FSM System";

  const setupActive =
    Boolean(user.twoFactorSecret) &&
    isTwoFactorSetupFresh(user.twoFactorSetupStartedAt);
  const uri = setupActive
    ? buildTotpUri(
        user.twoFactorSecret!,
        user.email || user.name || "bruker",
      )
    : null;
  const qrDataUrl = uri
    ? await QRCode.toDataURL(uri, { margin: 1, width: 220 })
    : null;

  const error = errorParam
    ? t(`auth.enrollment.errors.${ERROR_KEYS.has(errorParam) ? errorParam : "default"}`)
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
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)]">
            {t("auth.enrollment.title")}
          </h1>
          <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("auth.enrollment.desc", { companyName })}
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

        {!setupActive || !qrDataUrl ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--muted,#62685f)]">
              {t("auth.enrollment.startDesc")}
            </p>
            <form action={startRequiredEnrollmentAction}>
              <SubmitButton
                idleLabel={t("auth.enrollment.start")}
                pendingLabel={t("auth.enrollment.starting")}
              />
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-bold text-[var(--ink,#101310)]">
              {t("auth.enrollment.step1")}
            </p>
            <img
              src={qrDataUrl}
              alt={t("auth.enrollment.qrAlt")}
              className="mx-auto rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2"
            />
            <details className="text-sm text-[var(--muted,#62685f)]">
              <summary className="flex min-h-11 cursor-pointer items-center font-bold text-[var(--ink,#101310)]">
                {t("auth.enrollment.manualToggle")}
              </summary>
              <code className="mt-2 block break-all rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 font-mono text-xs text-[var(--ink,#101310)]">
                {user.twoFactorSecret}
              </code>
            </details>

            <form action={confirmRequiredEnrollmentAction} className="space-y-3">
              <label
                htmlFor="code"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
              >
                {t("auth.enrollment.codeLabel")}
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
              <SubmitButton
                idleLabel={t("auth.enrollment.confirm")}
                pendingLabel={t("auth.enrollment.confirming")}
              />
            </form>
          </div>
        )}

        <div className="mt-6 text-center">
          <Link
            href="/logg-inn"
            className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
          >
            {t("auth.enrollment.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}
