import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { portalBranding } from "@/lib/portal-branding";
import Icon from "@/components/icons";
import PortalTabs, { type PortalTab } from "./PortalTabs";

export type PortalShellCustomer = {
  id: string;
  name: string;
  brandColor: string | null;
  logoUrl: string | null;
};

/**
 * Felles ramme for kundeportalen. Kundens merkevarefarge brukes som aksent,
 * aldri som tekstbakgrunn, slik at kontrasten er forutsigbar. Logoen vises
 * bare når den er en trygg opplastings-URL.
 */
export default async function PortalShell({
  active,
  customer,
  userName,
  children,
}: {
  active: PortalTab;
  customer: PortalShellCustomer;
  userName: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const branding = portalBranding(customer);
  const brand = branding.color;
  const logo = branding.logo;
  const initial = branding.initial;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--canvas,#f4f5f2)] px-4 py-5 text-[var(--ink,#101310)] [--focus-ring:var(--ink,#101310)] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="relative overflow-hidden rounded-[20px] border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] px-5 py-6 text-[var(--paper,#f2efe6)] shadow-[4px_4px_0_var(--signal,#d8ff3e)] [--focus-ring:var(--signal,#d8ff3e)] sm:px-7 sm:py-7">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ backgroundColor: brand }}
          />
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={t("portal.expansion.branding.logoAlt", {
                    customerName: customer.name,
                  })}
                  className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold text-[var(--ink,#101310)]"
                  style={{ backgroundColor: brand }}
                >
                  {initial}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cfc8b9]">
                  {t("portal.headerEyebrow")}
                </p>
                <h1 className="mt-1 break-words text-2xl font-extrabold tracking-tight text-[var(--paper,#f2efe6)] md:text-3xl">
                  {t("portal.headerTitle", { customerName: customer.name })}
                </h1>
                <p className="mt-1 text-sm leading-6 text-[#ded8ca]">
                  {t("portal.headerWelcome", { userName })}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#5a5348] px-4 text-sm font-bold text-[var(--paper,#f2efe6)] transition hover:border-[#cfc8b9] hover:bg-[#2a261f]"
              >
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("portal.home")}
              </Link>
              <Link
                href="/innstillinger?tab=sikkerhet"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#5a5348] px-4 text-sm font-bold text-[var(--paper,#f2efe6)] transition hover:border-[#cfc8b9] hover:bg-[#2a261f]"
              >
                <Icon name="shield" className="h-4 w-4 shrink-0" />
                {t("nav.accountSecurity")}
              </Link>
            </div>
          </div>
          <p className="mt-3 text-xs text-[#a9a292]" lang={locale}>
            {t("portal.expansion.branding.poweredBy")}
          </p>
        </header>

        <PortalTabs active={active} />
        {children}
      </div>
    </div>
  );
}
