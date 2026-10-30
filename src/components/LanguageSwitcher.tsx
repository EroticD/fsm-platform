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
      className="flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
      aria-label={t("components.language.change")}
      title={t("components.language.change")}
    >
      <span>{localeNames[locale]}</span>
      <Icon name="sync" className="h-3.5 w-3.5 text-gray-400" />
    </button>
  );
}
