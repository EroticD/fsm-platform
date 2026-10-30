import Link from "next/link";
import { getTranslations } from "next-intl/server";

export type PortalTab =
  | "oversikt"
  | "bestillinger"
  | "rapporter"
  | "dokumenter"
  | "utstyr"
  | "avtaler"
  | "besok"
  | "meldinger"
  | "kontakt";

const TABS: Array<{ key: PortalTab; href: string }> = [
  { key: "oversikt", href: "/kundeportal" },
  { key: "bestillinger", href: "/kundeportal/bestillinger" },
  { key: "rapporter", href: "/kundeportal/rapporter" },
  { key: "dokumenter", href: "/kundeportal/dokumenter" },
  { key: "utstyr", href: "/kundeportal/utstyr" },
  { key: "avtaler", href: "/kundeportal/avtaler" },
  { key: "besok", href: "/kundeportal/besok" },
  { key: "meldinger", href: "/kundeportal/meldinger" },
  { key: "kontakt", href: "/kundeportal/kontakt" },
];

/**
 * Portalens hovednavigasjon. Alle fanene er egne, server-rendrede ruter, slik
 * at hver side kan ha avgrensede spørringer og egen tilgangskontroll.
 */
export default async function PortalTabs({ active }: { active: PortalTab }) {
  const t = await getTranslations("common");
  return (
    <nav
      aria-label={t("portal.expansion.tabs.label")}
      className="flex flex-wrap gap-1 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1.5 shadow-[0_2px_10px_rgba(20,17,11,0.06)]"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-bold transition-colors ${
              isActive
                ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                : "border-transparent text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
            }`}
          >
            {t(`portal.expansion.tabs.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
