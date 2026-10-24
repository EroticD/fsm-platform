"use client";

import { useI18n } from "@/i18n-hooks";
import { useTranslations } from "next-intl";

export default function LanguageSwitcher() {
  const t = useTranslations("common");
  const { locale, localeNames, changeLocale } = useI18n();
  const nextLocale = locale === "nb" ? "en" : "nb";

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => changeLocale(nextLocale)}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
        aria-label={t("components.language.change")}
      >
        {locale === "nb" ? "🇳🇴" : "🇬🇧"}
        <span>{localeNames[locale]}</span>
        <svg
          className="w-4 h-4 ml-1 text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          suppressHydrationWarning
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
            suppressHydrationWarning
          />
        </svg>
      </button>
    </div>
  );
}
