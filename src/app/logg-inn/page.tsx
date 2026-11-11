import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import BrandMark from "@/components/BrandMark";
import LoginSsoButtons from "@/components/LoginSsoButtons";
import LoginSamlButtons from "@/components/LoginSamlButtons";
import {
  AuthAlert,
  AuthHeader,
  AuthShell,
} from "@/components/auth/AuthShell";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import { safeLoginCallbackTarget } from "@/lib/safe-redirect";
import { readSsoConfig } from "@/lib/sso";
import { samlProviderConfigs } from "@/lib/saml";
import { moduleEnabled } from "@/server/modules";
import { loginAction } from "./actions";
import SubmitButton from "./SubmitButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("loginTitle") };
}

const SSO_ERROR_KEYS: Record<string, string> = {
  SsoInvalidClaims: "sso.errors.invalidClaims",
  SsoMissingEmail: "sso.errors.missingEmail",
  SsoUnverifiedEmail: "sso.errors.unverifiedEmail",
  SsoDomainNotAllowed: "sso.errors.domainNotAllowed",
  SsoInactive: "sso.errors.inactive",
  SsoNotProvisioned: "sso.errors.notProvisioned",
  SsoRoleConflict: "sso.errors.roleConflict",
  SsoInvalidRole: "sso.errors.invalidRole",
  SsoInvalidDepartment: "sso.errors.invalidDepartment",
  SsoCustomerAccount: "sso.errors.customerAccount",
  SsoIdentityConflict: "sso.errors.identityConflict",
  SsoConfiguration: "sso.errors.configuration",
  SsoServerError: "sso.errors.serverError",
  SsoDisabled: "sso.errors.disabled",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error: errorParam, callbackUrl = "/" } = await searchParams;
  const t = await getTranslations("common");
  const safeCallbackUrl = safeLoginCallbackTarget(callbackUrl);
  const ssoEnabled = await moduleEnabled("sso");
  const sso = readSsoConfig();
  const ssoProviders = ssoEnabled
    ? sso.providers.map((provider) => ({
        id: provider.id,
        name: provider.displayName,
      }))
    : [];
  const samlProviders = ssoEnabled
    ? samlProviderConfigs().map((provider) => ({
        slug: provider.slug,
        name: provider.displayName,
      }))
    : [];

  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName || "FSM System";

  let error: string | null = null;
  if (errorParam) {
    const ssoKey = SSO_ERROR_KEYS[errorParam];
    if (ssoKey) {
      error = t(ssoKey);
    } else {
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
  }

  return (
    <AuthShell>
      <AuthHeader
        mark={<BrandMark size={48} />}
        title={t("loginTitle")}
        description={t("loginDescCompany", { companyName })}
      />

      <AuthAlert message={error ?? ""} />

      <LoginSsoButtons
        providers={ssoProviders}
        callbackUrl={safeCallbackUrl}
      />
      <LoginSamlButtons
        providers={samlProviders}
        callbackUrl={safeCallbackUrl}
      />

      {/*
        Skjemaet sender e-post og passord i selve forespørselen (POST) via en
        server-action, slik at passordet aldri havner i adressefeltet – og
        slik at innloggingen også virker på enheter der JavaScript ikke har
        rukket å laste/hydrere ennå.
      */}
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="callbackUrl" value={safeCallbackUrl} />

        <Field label={t("emailLabel")} required>
          <Input
            type="email"
            name="email"
            required
            autoComplete="username"
            placeholder={t("emailPlaceholder")}
            aria-invalid={error ? true : undefined}
          />
        </Field>

        <Field label={t("passwordLabel")} required>
          <Input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={error ? true : undefined}
          />
        </Field>

        <SubmitButton idleLabel={t("loginButton")} pendingLabel={t("loginPending")} />
      </form>

      <div className="mt-6 text-center">
        <Link
          href="/glemt-passord"
          className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
        >
          {t("forgotPassword")}
        </Link>
      </div>
    </AuthShell>
  );
}
