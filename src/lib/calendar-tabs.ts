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
};

// Kalendervisningene er én rute med `?vis=`-parameter. De gamle rutene
// (/kalender/maned, /uke og /uke-2) redirecter hit, slik at bokmerker virker.
const BASE_TABS: CalendarTabDefinition[] = [
  { key: "resources", href: "/kalender", labelKey: "calendar.common.resources" },
  {
    key: "month",
    href: "/kalender?vis=maned",
    labelKey: "calendar.common.month",
  },
  {
    key: "week",
    href: "/kalender?vis=uke",
    labelKey: "calendar.common.week",
  },
  {
    key: "biweekly",
    href: "/kalender?vis=2uker",
    labelKey: "calendar.common.biweekly",
  },
];

/**
 * Fanene som faktisk skal vises. Dispatch krever tildelingsrettighet – uten
 * den ville fanen bare sendt brukeren tilbake til dashbordet. Rapporter vises
 * bare med reports.view, og erstatter den gamle snarveien fra kalenderen.
 */
export function calendarTabsFor({
  canDispatch,
  canReports,
}: {
  canDispatch: boolean;
  canReports: boolean;
}): CalendarTabDefinition[] {
  return [
    ...BASE_TABS,
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
