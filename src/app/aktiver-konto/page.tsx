import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import Link from "next/link";
import {
  AuthAlert,
  AuthHeader,
  AuthShell,
} from "@/components/auth/AuthShell";
import Button, { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
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
        <Link href="/logg-inn" className={`${buttonClassName()} w-full`}>
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
        <Link
          href="/logg-inn"
          className={`${buttonClassName({ variant: "secondary" })} w-full`}
        >
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
        <Link
          href="/logg-inn"
          className={`${buttonClassName({ variant: "secondary" })} w-full`}
        >
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
        <AuthAlert message={t("auth.activate.errors.invalid")} />
      )}
      {error === "for_kort" && (
        <AuthAlert
          tone="warning"
          message={t("auth.activate.errors.tooShort")}
        />
      )}
      {error === "for_lang" && (
        <AuthAlert
          tone="warning"
          message={t("auth.activate.errors.tooLong")}
        />
      )}
      {error === "mellomrom" && (
        <AuthAlert
          tone="warning"
          message={t("auth.activate.errors.whitespace")}
        />
      )}
      {error === "ulike" && (
        <AuthAlert
          tone="warning"
          message={t("auth.activate.errors.mismatch")}
        />
      )}

      <form action={setPassword} className="space-y-4">
        <input type="hidden" name="token" value={effectiveToken} />

        <Field label={t("auth.activate.newPassword")} required>
          <Input
            type="password"
            name="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.activate.newPasswordPlaceholder")}
          />
        </Field>

        <Field label={t("auth.activate.confirm")} required>
          <Input
            type="password"
            name="confirm"
            required
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            placeholder={t("auth.activate.confirmPlaceholder")}
          />
        </Field>

        <Button type="submit" className="w-full">
          {t("auth.activate.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
