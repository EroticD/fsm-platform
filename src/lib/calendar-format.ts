/**
 * Formateringshjelpere for FullCalendar-overskriftene.
 *
 * v7 slår automatisk over til én bokstavs ukedag når kolonnene blir smale
 * (mobil), og dayGrid-visninger med duration: { weeks: 2 } sender feil dato til
 * dayHeaderContent. Vi formaterer derfor ukedag og dato selv der datoen er
 * nødvendig for å forstå kolonnen.
 */

const CALENDAR_LOCALE_TAGS: Record<string, string> = {
  nb: "nb-NO",
  en: "en-GB",
  pl: "pl-PL",
  de: "de-DE",
};

/** ISO-ukenummer for en dato. */
export function isoWeekNumber(value: Date): number {
  const date = new Date(
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
  );
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Ukedag for kolonneoverskriften i to-ukersvisningen.
 *
 * FullCalendar sender en kunstig 1970-dato til dayHeaderContent for
 * dayGrid-visninger med duration: { weeks: 2 }. Ukedagen i den datoen er
 * riktig, men datoen er det ikke. Overskriften viser derfor bare ukedagen, og
 * den faktiske datoen settes i hver dagcelle i stedet.
 */
export function calendarWeekdayText(
  date: Date,
  locale: string,
  compact = false,
): string {
  const tag = CALENDAR_LOCALE_TAGS[locale] ?? "en-GB";
  return new Intl.DateTimeFormat(tag, {
    weekday: compact ? "narrow" : "short",
  }).format(date);
}

/**
 * Kompakt dato for dagcellene i to-ukersvisningen: «26/10» på desktop og
 * «26» når cellen er smal. Dag og måned hentes fra lokalens egen formattering,
 * men settes sammen med skråstrek slik at uttrykket blir like kort i alle
 * språk. FullCalendar sender den ekte datoen til dayCellTopContent.
 */
export function calendarCompactDate(
  date: Date,
  locale: string,
  narrow = false,
): string {
  const tag = CALENDAR_LOCALE_TAGS[locale] ?? "en-GB";
  const parts = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "numeric",
  }).formatToParts(date);
  // en-GB formaterer dag som «09»; vi vil ha «9» i den kompakte datoen.
  const day = String(
    Number(parts.find((part) => part.type === "day")?.value ?? ""),
  );
  const month = String(
    Number(parts.find((part) => part.type === "month")?.value ?? ""),
  );
  return narrow ? day : `${day}/${month}`;
}

/** «man. 2.11.» på desktop, «2.11.» når kolonnen er smal. */
export function calendarDayHeaderText(
  date: Date,
  locale: string,
  long = false,
  compact = false,
): string {
  const tag = CALENDAR_LOCALE_TAGS[locale] ?? "en-GB";
  const rest = new Intl.DateTimeFormat(
    tag,
    long && !compact
      ? { day: "numeric", month: "long" }
      : { day: "numeric", month: "numeric" },
  ).format(date);
  if (compact) return rest;
  const weekday = new Intl.DateTimeFormat(tag, {
    weekday: long ? "long" : "short",
  }).format(date);
  return `${weekday} ${rest}`;
}
