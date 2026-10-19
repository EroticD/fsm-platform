import { formatAddress } from "@/lib/address";
import { addDaysUtc, parseDateOnly, toDateOnly } from "@/lib/dates";

export type CalendarEventData = {
  id: string;
  title: string;
  start: string;
  /** Eksklusiv sluttdato, slik FullCalendar forventer for heldagshendelser. */
  end?: string;
  allDay: boolean;
  /** Statusfarge, slik at måneds- og ukevisning viser samme informasjon. */
  color: string;
  extendedProps: { address: string };
};

/** Farge per oppdragsstatus. Faller tilbake til blå for ukjente statuser. */
const STATUS_COLORS: Record<string, string> = {
  OPEN: "#9333ea",
  PENDING: "#d97706",
  PLANNED: "#ca8a04",
  WAITING: "#ea580c",
  IN_PROGRESS: "#2563eb",
  COMPLETED: "#16a34a",
  CANCELLED: "#dc2626",
};

type WorkOrderForCalendar = {
  id: string;
  title: string;
  status: string;
  scheduledFor: Date | null;
  scheduledTo: Date | null;
  customer: {
    address: string | null;
    postalCode: string | null;
    city: string | null;
  } | null;
};

/**
 * Gjør et oppdrag om til en FullCalendar-hendelse.
 *
 * `scheduledTo` er inklusiv siste dag, mens FullCalendar vil ha en eksklusiv
 * sluttdato. Derfor legges det på én dag når oppdraget varer over flere dager.
 * Éndagsoppdrag får ingen `end`, slik at de ikke tegnes som en strek over to
 * dager.
 */
export function toCalendarEvent(wo: WorkOrderForCalendar): CalendarEventData | null {
  if (!wo.scheduledFor) return null;

  const start = toDateOnly(wo.scheduledFor);
  const lastDay = toDateOnly(wo.scheduledTo);
  let end: string | undefined;

  if (lastDay && lastDay > start) {
    const lastDayDate = parseDateOnly(lastDay);
    if (lastDayDate) end = toDateOnly(addDaysUtc(lastDayDate, 1));
  }

  return {
    id: wo.id,
    title: wo.title,
    start,
    end,
    allDay: true,
    color: STATUS_COLORS[wo.status] ?? "#2563eb",
    extendedProps: { address: formatAddress(wo.customer) },
  };
}
