"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { locales, defaultLocale, localeNames, LOCALE_COOKIE, type Locale } from "@/i18n";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

function normalizeLocale(value: string): Locale {
  return (locales as readonly string[]).includes(value) ? (value as Locale) : defaultLocale;
}

export function useI18n() {
  const t = useTranslations("common");
  const router = useRouter();
  const locale = normalizeLocale(useLocale());

  const changeLocale = (newLocale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=${ONE_YEAR_IN_SECONDS};samesite=lax`;
    // Re-render the server components with the new locale. No URL prefix is used.
    router.refresh();
  };

  return {
    t,
    locale,
    locales,
    localeNames,
    changeLocale,
    isRTL: false,
  };
}

export function useLanguage() {
  const { locale, locales, localeNames, changeLocale } = useI18n();
  return {
    locale,
    locales,
    localeNames,
    changeLocale,
  };
}
