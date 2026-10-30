import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import Link from "next/link";
import Icon, { type IconName } from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/invite";
import {
  PASSWORD_MIN_LENGTH,
  validatePassword,
  type PasswordPolicyError,
} from "@/lib/password-policy";
import {
  clearRetryToken,
  readRetryToken,
  rememberRetryToken,
} from "@/lib/retry-token";
import { bumpSessionVersion } from "@/lib/session";
import { clearCalendarToken } from "@/server/calendar-feed";

const RETRY_TOKEN_COOKIE = "fsm-activate-token";

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

export default async function ActivateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; success?: string }>;
}) {
  const { token, error, success } = await searchParams;
  const t = await getTranslations("common");

  // Ved en valideringsfeil legges nøkkelen i en kortlevd HttpOnly-cookie i
  // stedet for å skrives tilbake i adressefeltet. Da kan skjemaet vises på
  // nytt uten at nøkkelen havner i historikk, logger eller Referer.
  const retryToken = token ? null : await readRetryToken(RETRY_TOKEN_COOKIE);
  const effectiveToken = token || retryToken || undefined;

  // --- SERVER ACTION: sett eget passord ---
  async function setPassword(formData: FormData) {
    "use server";
    const newPassword = formData.get("password") as string;
    const confirmPassword = formData.get("confirm") as string;
    const formToken = (formData.get("token") as string | null)?.trim() ?? "";

    if (!formToken) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    const policyError = validatePassword(newPassword);
    if (policyError) {
      await rememberRetryToken(RETRY_TOKEN_COOKIE, formToken);
      redirect(`/aktiver-konto?error=${policyErrorCode(policyError)}`);
    }
    if (newPassword !== confirmPassword) {
      await rememberRetryToken(RETRY_TOKEN_COOKIE, formToken);
      redirect(`/aktiver-konto?error=ulike`);
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashToken(formToken),
        resetTokenExpiry: { gt: new Date() },
        // Bare invitasjoner til kontoer som ennå ikke er aktivert. En aktiv
        // bruker skal bruke «glemt passord», aldri en invitasjonslenke.
        isActive: false,
      },
    });

    if (!user) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Passordet lagres, men kontoen er fortsatt inaktiv til en administrator
    // aktiverer den. Nøkkelen kan bare brukes én gang. Sjekken gjentas i
    // UPDATE-en, slik at en samtidig aktivering ikke kan omgås.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: user.id,
          resetToken: hashToken(formToken),
          resetTokenExpiry: { gt: new Date() },
          isActive: false,
        },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        },
      });
      if (result.count !== 1) return false;

      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: `Bruker satte eget passord: ${user.name || user.email}`,
        actor: { id: user.id, name: user.name, email: user.email },
        metadata: { method: "activation_invite" },
      });
      return true;
    });
    if (!updated) {
      await clearRetryToken(RETRY_TOKEN_COOKIE);
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    await clearRetryToken(RETRY_TOKEN_COOKIE);
    await bumpSessionVersion(user.id);
    await clearCalendarToken(user.id);

    redirect("/aktiver-konto?success=true");
  }

  // --- SUKSESS ---
  if (success === "true") {
    return (
      <AuthShell>
        <AuthHeader
          icon="check"
          title={t("auth.activate.successTitle")}
          description={t("auth.activate.successDesc")}
        />
        <Link href="/logg-inn" className="signal-button w-full">
          {t("auth.activate.toLogin")}
        </Link>
      </AuthShell>
    );
  }

  // --- MANGLER NØKKEL ---
  if (!effectiveToken) {
    const invalid = error === "ugyldig";
    return (
      <AuthShell>
        <AuthHeader
          icon="alert"
          tone="risk"
          title={
            invalid
              ? t("auth.activate.invalidTitle")
              : t("auth.activate.missingTitle")
          }
          description={
            invalid
              ? t("auth.activate.invalidDesc")
              : t("auth.activate.missingDesc")
          }
        />
        <Link href="/logg-inn" className="ink-button w-full">
          {t("auth.activate.toLogin")}
        </Link>
      </AuthShell>
    );
  }

  // --- VALIDER NØKKEL ---
  const user = await prisma.user.findFirst({
    where: {
      resetToken: hashToken(effectiveToken),
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    return (
      <AuthShell>
        <AuthHeader
          icon="alert"
          tone="risk"
          title={t("auth.activate.invalidTitle")}
          description={t("auth.activate.invalidDesc")}
        />
        <Link href="/logg-inn" className="ink-button w-full">
          {t("auth.activate.toLogin")}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeader
        icon="user"
        title={t("auth.activate.welcome")}
        description={t.rich("auth.activate.desc", {
          email: user.email ?? "",
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      />

      {error === "ugyldig" && (
        <AuthAlert>{t("auth.activate.errors.invalid")}</AuthAlert>
      )}
      {error === "for_kort" && (
        <AuthAlert tone="warning">{t("auth.activate.errors.tooShort")}</AuthAlert>
      )}
      {error === "for_lang" && (
        <AuthAlert tone="warning">{t("auth.activate.errors.tooLong")}</AuthAlert>
      )}
      {error === "mellomrom" && (
        <AuthAlert tone="warning">{t("auth.activate.errors.whitespace")}</AuthAlert>
      )}
      {error === "ulike" && (
        <AuthAlert tone="warning">{t("auth.activate.errors.mismatch")}</AuthAlert>
      )}

      <form action={setPassword} className="space-y-4">
        <input type="hidden" name="token" value={effectiveToken} />

        <div>
          <label
            htmlFor="activate-password"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("auth.activate.newPassword")}
          </label>
          <input
            id="activate-password"
            type="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.activate.newPasswordPlaceholder")}
            className={controlClassName("min-h-11")}
          />
        </div>

        <div>
          <label
            htmlFor="activate-confirm"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("auth.activate.confirm")}
          </label>
          <input
            id="activate-confirm"
            type="password"
            name="confirm"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.activate.confirmPlaceholder")}
            className={controlClassName("min-h-11")}
          />
        </div>

        <button type="submit" className="signal-button w-full">
          {t("auth.activate.submit")}
        </button>
      </form>
    </AuthShell>
  );
}
