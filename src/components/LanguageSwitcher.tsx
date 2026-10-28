"use client";

import { useI18n } from "@/i18n-hooks";
import { useTranslations } from "next-intl";

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
      className="flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
      aria-label={t("components.language.change")}
      title={t("components.language.change")}
    >
      <span aria-hidden>{locale === "nb" ? "🇳🇴" : "🇬🇧"}</span>
      <span>{localeNames[locale]}</span>
      <span aria-hidden className="text-xs text-gray-400">
        ⇄
      </span>
    </button>
  );
}
