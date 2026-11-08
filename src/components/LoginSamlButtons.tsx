"use client";

import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

export type SamlProviderButton = {
  slug: string;
  name: string;
};

/**
 * SAML-knapper. NextAuth håndterer ikke SAML, så knappen går til vår egen
 * login-rute som lager AuthnRequest og RelayState. Passordskjemaet består.
 */
export default function LoginSamlButtons({
  providers,
  callbackUrl,
}: {
  providers: SamlProviderButton[];
  callbackUrl: string;
}) {
  const t = useTranslations("common");
  if (providers.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {providers.map((provider) => {
        const href = `/api/auth/saml/${encodeURIComponent(
          provider.slug,
        )}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        return (
          <a
            key={provider.slug}
            href={href}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-4 py-2.5 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
          >
            <Icon name="shield" className="h-4 w-4 shrink-0" />
            {t("saml.signInWith", { provider: provider.name })}
          </a>
        );
      })}
    </div>
  );
}
