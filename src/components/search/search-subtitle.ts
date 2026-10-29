import {
  formatDateLocalized,
  formatDateTimeLocalized,
} from "@/lib/dates";
import { cleanSearchSnippet } from "./clean-snippet";

export type SearchSubtitlePart = {
  key?: string;
  params?: Record<string, string | number>;
  text?: string;
};

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const PURE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Renser rå søketekst og lokaliserer rene ISO-datoer. Backend sender datoer
 * som `YYYY-MM-DD` fordi den ikke kjenner brukerens språk.
 */
export function localizeSearchText(
  value: string | null | undefined,
  locale: string,
): string {
  const text = cleanSearchSnippet(value);
  if (!text) return "";

  if (PURE_DATE.test(text)) return formatDateLocalized(text, locale);
  if (DATE_TIME.test(text)) return formatDateTimeLocalized(text, locale);
  return text;
}

/** Setter sammen en undertittel fra i18n-deler, renset søketekst og datoer. */
export function formatSearchSubtitle(
  item: {
    subtitle?: string;
    subtitleKey?: string;
    subtitleParams?: Record<string, string | number>;
    subtitleParts?: SearchSubtitlePart[];
  },
  t: Translate,
  locale: string,
): string | undefined {
  if (item.subtitleParts?.length) {
    const text = item.subtitleParts
      .map((part) =>
        part.key ? t(part.key, part.params) : localizeSearchText(part.text, locale),
      )
      .filter(Boolean)
      .join(" • ");
    return text || undefined;
  }
  if (item.subtitleKey) return t(item.subtitleKey, item.subtitleParams);
  return localizeSearchText(item.subtitle, locale) || undefined;
}
