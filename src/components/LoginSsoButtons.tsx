"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

type SsoProviderButton = {
  id: string;
  name: string;
};

/**
 * SSO-knapper for konfigurerte OIDC-leverandører.
 *
 * Selve omdirigeringen gjøres av NextAuth, som setter state, nonce og PKCE.
 * Passordskjemaet under blir alltid stående som break-glass.
 */
export default function LoginSsoButtons({
  providers,
  callbackUrl,
}: {
  providers: SsoProviderButton[];
  callbackUrl: string;
}) {
  const t = useTranslations("common");
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (providers.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--line,#dedcd1)]" />
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
          {t("sso.or")}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--line,#dedcd1)]" />
      </div>

      <div className="space-y-2">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => {
              setPendingId(provider.id);
              void signIn(provider.id, { callbackUrl });
            }}
            disabled={pendingId !== null}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--ink,#101310)] bg-[var(--surface,#fffdf8)] px-4 py-2.5 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:cursor-wait disabled:opacity-70"
          >
            <Icon name="shield" className="h-4 w-4 shrink-0" />
            {pendingId === provider.id
              ? t("sso.redirecting")
              : t("sso.signInWith", { provider: provider.name })}
          </button>
        ))}
      </div>
    </div>
  );
}
