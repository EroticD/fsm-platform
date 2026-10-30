export const locales = ['nb', 'en', 'pl', 'de'] as const;
export const defaultLocale = 'nb' as const;

export const localeNames = {
  nb: 'Norsk',
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
};

/** Cookie used to persist the selected locale (no locale prefix in the URL). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export type Locale = (typeof locales)[number];
