import { defaultLocale, type Locale } from "@/i18n";
import { messages } from "@/i18n/messages";

export type NotificationTextParams = Record<
  string,
  string | number | boolean | null | undefined
>;

function resolveKey(locale: Locale, key: string): string | null {
  let current: unknown = messages[locale]?.common;
  for (const segment of key.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : null;
}

function interpolate(text: string, params: NotificationTextParams): string {
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === null || value === undefined ? "" : String(value);
  });
}

/**
 * Oversetter en lagret varselnøkkel utenfor en request-kontekst. Brukes av
 * e-postkjøren og av varsel-API-et, der next-intl ikke har en cookie/request å
 * lese locale fra.
 */
export function translateNotificationText(
  locale: string | null | undefined,
  key: string | null | undefined,
  params: NotificationTextParams = {},
): string | null {
  if (!key) return null;
  const wanted = (locale ?? defaultLocale) as Locale;
  const direct = resolveKey(wanted, key);
  if (direct) return interpolate(direct, params);
  const fallback = resolveKey(defaultLocale, key);
  return fallback ? interpolate(fallback, params) : null;
}

export type NotificationTextSource = {
  title?: string | null;
  titleKey?: string | null;
  body?: string | null;
  bodyKey?: string | null;
  params?: unknown;
};

function paramsOf(value: unknown): NotificationTextParams {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as NotificationTextParams)
    : {};
}

/** Tittelen som skal vises: nøkkelen først, ellers den lagrede teksten. */
export function notificationTitleFor(
  notification: NotificationTextSource,
  locale: string | null | undefined,
): string {
  return (
    translateNotificationText(
      locale,
      notification.titleKey,
      paramsOf(notification.params),
    ) ??
    notification.title ??
    ""
  );
}

export function notificationBodyFor(
  notification: NotificationTextSource,
  locale: string | null | undefined,
): string | null {
  const translated = translateNotificationText(
    locale,
    notification.bodyKey,
    paramsOf(notification.params),
  );
  return translated ?? notification.body ?? null;
}
