"use client";

import { useI18n } from "@/i18n-hooks";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { locales, type Locale } from "@/i18n";

/**
 * Språkvelger. En native select gir samme funksjon på tastatur, mobil og
 * lesebrett, og lar brukeren velge blant alle støttede språk uten en egen
 * popover som må fange fokus.
 */
export default function LanguageSwitcher() {
  const t = useTranslations("common");
  const { locale, localeNames, changeLocale } = useI18n();

  return (
    <label className="relative flex min-h-11 w-full items-center">
      <span className="sr-only">{t("components.language.change")}</span>
      <select
        value={locale}
        onChange={(event) => changeLocale(event.target.value as Locale)}
        aria-label={t("components.language.change")}
        title={t("components.language.change")}
        className="min-h-11 w-full appearance-none rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] py-2 pl-3 pr-9 text-sm font-semibold text-[var(--ink,#101310)] outline-none transition hover:bg-[var(--paper,#f2efe6)] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
      >
        {locales.map((candidate) => (
          <option key={candidate} value={candidate}>
            {localeNames[candidate]}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[var(--muted,#62685f)]"
      />
    </label>
  );
}
