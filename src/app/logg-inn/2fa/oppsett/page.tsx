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
import {
  AuthAlert,
  AuthHeader,
  AuthShell,
} from "@/components/auth/AuthShell";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
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
    <AuthShell>
      <AuthHeader
        icon="shield"
        title={t("auth.enrollment.title")}
        description={t("auth.enrollment.desc", { companyName })}
      />

      <AuthAlert message={error ?? ""} />

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
              <Field label={t("auth.enrollment.codeLabel")} required>
                <Input
                  type="text"
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  autoFocus
                  className="text-center text-lg font-bold tracking-[0.4em]"
                />
              </Field>
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
    </AuthShell>
  );
}
