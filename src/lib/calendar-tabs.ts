import type { IconName } from "@/components/icons";
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateRangeLocalized,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";

export type CalendarTabKey =
  | "resources"
  | "month"
  | "week"
  | "biweekly"
  | "dispatch"
  | "reports";

export type CalendarTabDefinition = {
  key: CalendarTabKey;
  href: string;
  labelKey: string;
  /** Monokromt ikon fra det felles ikonsettet. */
  icon: IconName;
  /** Rute-parameteren for visninger på /kalender, f.eks. «maned». */
  viewParam?: string;
};

/**
 * Dato- og filtertilstand som skal følge med mellom kalendervisningene.
 * Feltene er valgfrie, slik at ressursoversikten og gamle bokmerker uten
 * parametere beholder de korte, stabile adressene.
 */
export type CalendarTabQuery = {
  /** Ankerdato for visningen, på formatet YYYY-MM-DD. */
  date?: string | null;
  /** Montørens bruker-id. */
  technician?: string | null;
  /** Oppdragsstatus, f.eks. PLANNED. */
  status?: string | null;
  /** Vis bare oppdrag uten montør. */
  unassigned?: boolean;
};

/**
 * Datoer på formatet YYYY-MM-DD, men også datoer JavaScript ville normalisert
 * (31. februar blir 3. mars) skal avvises. Roundtrip- sammenligningen fanger det.
 */
function isValidDateOnly(value: string): boolean {
  const parsed = parseDateOnly(value);
  return parsed !== null && toDateOnly(parsed) === value;
}

/** Godtar bare gyldige rene datoer, ellers brukes fallback-datoen. */
export function normalizeCalendarDate(
  value: string | null | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  return trimmed && isValidDateOnly(trimmed) ? trimmed : fallback;
}

/**
 * Bygger URL-en for en kalendervisning. `vis` utelates for ressursoversikten,
 * som fortsatt bor på den korte /kalender-adressen.
 */
export function calendarViewHref(
  view: string | null | undefined,
  query: CalendarTabQuery = {},
): string {
  const params = new URLSearchParams();
  if (view) params.set("vis", view);

  const date = query.date?.trim();
  if (date && isValidDateOnly(date)) params.set("dato", date);
  if (query.technician) params.set("tekniker", query.technician);
  if (query.status) params.set("status", query.status);
  if (query.unassigned) params.set("ufordelt", "1");

  const search = params.toString();
  return search ? `/kalender?${search}` : "/kalender";
}

// Kalendervisningene er én rute med `?vis=`-parameter. De gamle rutene
// (/kalender/maned, /uke og /uke-2) redirecter hit, slik at bokmerker virker.
const BASE_TABS: CalendarTabDefinition[] = [
  {
    key: "resources",
    href: "/kalender",
    labelKey: "calendar.common.resources",
    icon: "grid",
  },
  {
    key: "month",
    href: calendarViewHref("maned"),
    labelKey: "calendar.common.month",
    icon: "calendar",
    viewParam: "maned",
  },
  {
    key: "week",
    href: calendarViewHref("uke"),
    labelKey: "calendar.common.week",
    icon: "list",
    viewParam: "uke",
  },
  {
    key: "biweekly",
    href: calendarViewHref("2uker"),
    labelKey: "calendar.common.biweekly",
    icon: "columns",
    viewParam: "2uker",
  },
];

/**
 * Fanene som faktisk skal vises. Dispatch krever tildelingsrettighet – uten
 * den ville fanen bare sendt brukeren tilbake til dashbordet. Rapporter vises
 * bare med reports.view, og erstatter den gamle snarveien fra kalenderen.
 *
 * `query` gjør at dato og filtre følger med når brukeren bytter mellom måned,
 * uke og to uker. Ressursoversikten, dispatch og rapporter er egne sider og
 * skal ikke arve kalenderens periode.
 */
export function calendarTabsFor({
  canDispatch,
  canReports,
  query,
}: {
  canDispatch: boolean;
  canReports: boolean;
  query?: CalendarTabQuery;
}): CalendarTabDefinition[] {
  return [
    ...BASE_TABS.map((tab) =>
      tab.viewParam
        ? { ...tab, href: calendarViewHref(tab.viewParam, query) }
        : tab,
    ),
    ...(canDispatch
      ? [
          {
            key: "dispatch" as const,
            href: "/kalender/dispatch",
            labelKey: "calendar.common.dispatch",
            icon: "users" as const,
          },
        ]
      : []),
    ...(canReports
      ? [
          {
            key: "reports" as const,
            href: "/rapporter",
            labelKey: "calendar.common.reports",
            icon: "chart" as const,
          },
        ]
      : []),
  ];
}

/** ISO-ukenummer (1–53) for en dato som allerede er UTC-midnatt. */
function isoWeekNumber(date: Date): number {
  const copy = new Date(date.getTime());
  // ISO-uken tilhører uken som inneholder torsdagen. Flytt til torsdag, og
  // regn deretter antall uker siden 1. januar i ISO-året.
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((copy.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
}

/** Mandagen i ISO-uken som datoen ligger i. */
function startOfIsoWeek(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return addDaysUtc(date, 1 - day);
}

/**
 * Lesbar periode for kalenderhodet. Månedsvisningen viser måned og år, mens
 * uke og to uker viser ISO-ukenummer og datointervallet. Ressursoversikten og
 * dispatch har egne perioder og får `null` her.
 */
export function calendarPeriodLabel({
  view,
  date,
  locale,
  weekLabel,
}: {
  view: string | null | undefined;
  date: string;
  locale?: string | null;
  weekLabel: string;
}): string | null {
  const anchor = parseDateOnly(date);
  if (!anchor) return null;

  if (view === "maned") {
    return formatDateLocalized(anchor, locale, {
      month: "long",
      year: "numeric",
    });
  }

  if (view === "uke" || view === "2uker") {
    const start = startOfIsoWeek(anchor);
    const end = addDaysUtc(start, view === "uke" ? 6 : 13);
    const firstWeek = isoWeekNumber(start);
    const lastWeek =
      view === "uke"
        ? firstWeek
        : isoWeekNumber(addDaysUtc(start, 7));
    const weeks =
      firstWeek === lastWeek ? `${firstWeek}` : `${firstWeek}–${lastWeek}`;
    const range = formatDateRangeLocalized(start, end, locale);
    return range ? `${weekLabel} ${weeks} · ${range}` : `${weekLabel} ${weeks}`;
  }

  return null;
}
