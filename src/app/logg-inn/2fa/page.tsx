import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { readPendingTwoFactor } from "@/lib/session-token";
import { verifyRecoveryCodeAction, verifyTwoFactorAction } from "../actions";
import SubmitButton from "../SubmitButton";
import Icon from "@/components/icons";
import {
  AuthAlert,
  AuthHeader,
  AuthShell,
} from "@/components/auth/AuthShell";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";

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
    <AuthShell>
      <AuthHeader
        icon="shield"
        title={t("auth.twoFactor.title")}
        description={t("auth.twoFactor.desc", { companyName })}
      />

      <AuthAlert message={error ?? ""} />

      <form action={verifyTwoFactorAction} className="space-y-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Field label={t("auth.twoFactor.codeLabel")} required>
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
            <Field
              label={t("auth.twoFactor.recovery.label")}
              hint={t("auth.twoFactor.recovery.hint")}
              required
            >
              <Input
                type="text"
                name="recoveryCode"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={9}
                placeholder="XXXX-XXXX"
                className="text-center text-lg font-bold uppercase tracking-[0.2em]"
              />
            </Field>
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
    </AuthShell>
  );
}
