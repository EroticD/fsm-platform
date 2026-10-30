/**
 * Presentasjonsopplysninger for varsler. Holdes adskilt fra serverkoden slik
 * at både varsellisten og tester kan bruke samme kilde til etiketter og ikoner.
 */

export type NotificationTone =
  | "blue"
  | "amber"
  | "red"
  | "green"
  | "purple"
  | "gray";

export type NotificationTypePresentation = {
  /** Ikon som vises ved siden av typeetiketten. */
  icon: string;
  /** Full i18n-nøkkel til den korte typeetiketten. */
  labelKey: string;
  /** Fargetone på merket, slik at hendelsestypene blir visuelt forskjellige. */
  tone: NotificationTone;
};

export const NOTIFICATION_TYPE_PRESENTATION: Record<
  string,
  NotificationTypePresentation
> = {
  ASSIGNMENT: {
    icon: "🧰",
    labelKey: "p3.notifications.types.ASSIGNMENT",
    tone: "blue",
  },
  DATE_CHANGED: {
    icon: "📅",
    labelKey: "p3.notifications.types.DATE_CHANGED",
    tone: "amber",
  },
  CANCELLED: {
    icon: "🚫",
    labelKey: "p3.notifications.types.CANCELLED",
    tone: "red",
  },
  REPORT_READY: {
    icon: "📄",
    labelKey: "p3.notifications.types.REPORT_READY",
    tone: "green",
  },
  BOOKING: {
    icon: "📆",
    labelKey: "p3.notifications.types.BOOKING",
    tone: "purple",
  },
  CONTRACT_DUE: {
    icon: "🛠️",
    labelKey: "p3.notifications.types.CONTRACT_DUE",
    tone: "amber",
  },
  OVERDUE: {
    icon: "⏰",
    labelKey: "p3.notifications.types.OVERDUE",
    tone: "red",
  },
  CONTACT_UPDATE: {
    icon: "👤",
    labelKey: "p3.notifications.types.CONTACT_UPDATE",
    tone: "gray",
  },
  SLA_AT_RISK: {
    icon: "⏳",
    labelKey: "p3.notifications.types.SLA_AT_RISK",
    tone: "amber",
  },
  SLA_BREACHED: {
    icon: "🚨",
    labelKey: "p3.notifications.types.SLA_BREACHED",
    tone: "red",
  },
  WARRANTY: {
    icon: "🛡️",
    labelKey: "p3.notifications.types.WARRANTY",
    tone: "amber",
  },
  MESSAGE: {
    icon: "💬",
    labelKey: "sms.notifications.type",
    tone: "blue",
  },
};

/**
 * Slår opp presentasjonen for en varseltype. Ukjente typer (f.eks. en type
 * lagt til i serveren før UI-et er oppdatert) får ingen etikett og faller
 * tilbake til den rå typen i komponenten.
 */
export function notificationTypePresentation(
  type: string,
): NotificationTypePresentation | null {
  return NOTIFICATION_TYPE_PRESENTATION[type] ?? null;
}

/**
 * Menneskevennlig kildelinje. `sourceLabel` er frosset ved opprettelse, men
 * eldre varsler kan mangle den. Da viser vi en nøytral standardetikett i
 * stedet for en tom linje.
 */
export function notificationSourceText(
  sourceLabel: string | null | undefined,
  fallback: string,
): string {
  const label = typeof sourceLabel === "string" ? sourceLabel.trim() : "";
  return label.length > 0 ? label : fallback;
}
