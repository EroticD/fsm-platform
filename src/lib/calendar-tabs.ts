import { parseDateOnly, toDateOnly } from "@/lib/dates";

export type CalendarTabKey =
  | "resources"
  | "month"
  | "week"
  | "biweekly"
  | "dispatch"
  | "reports";

type CalendarTabDefinition = {
  key: CalendarTabKey;
  href: string;
  labelKey: string;
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
  { key: "resources", href: "/kalender", labelKey: "calendar.common.resources" },
  {
    key: "month",
    href: calendarViewHref("maned"),
    labelKey: "calendar.common.month",
    viewParam: "maned",
  },
  {
    key: "week",
    href: calendarViewHref("uke"),
    labelKey: "calendar.common.week",
    viewParam: "uke",
  },
  {
    key: "biweekly",
    href: calendarViewHref("2uker"),
    labelKey: "calendar.common.biweekly",
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
          },
        ]
      : []),
    ...(canReports
      ? [
          {
            key: "reports" as const,
            href: "/rapporter",
            labelKey: "calendar.common.reports",
          },
        ]
      : []),
  ];
}
