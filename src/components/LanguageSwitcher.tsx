"use client";

import { useI18n } from "@/i18n-hooks";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

/**
 * Bytter språk umiddelbart. Den skal ikke se ut som en nedtrekksmeny, siden
 * den ikke åpner noe – derfor ingen chevron, bare gjeldende språk og et
 * bytte-ikon.
 */
export default function LanguageSwitcher() {
  const t = useTranslations("common");
  const { locale, localeNames, changeLocale } = useI18n();
  const nextLocale = locale === "nb" ? "en" : "nb";

  return (
    <button
      type="button"
      onClick={() => changeLocale(nextLocale)}
      className="flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 text-sm font-semibold text-[var(--ink,#101310)] transition-colors hover:bg-[var(--paper,#f2efe6)]"
      aria-label={t("components.language.change")}
      title={t("components.language.change")}
    >
      <span>{localeNames[locale]}</span>
      <Icon name="sync" className="h-3.5 w-3.5 text-[var(--muted,#62685f)]" />
    </button>
  );
}
