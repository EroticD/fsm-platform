import { formatAddress } from "@/lib/address";
import { addDaysUtc, parseDateOnly, toDateOnly } from "@/lib/dates";
import { workOrderStatusColor } from "@/lib/work-order-status-colors";

export type CalendarEventData = {
  id: string;
  title: string;
  start: string;
  /** Eksklusiv sluttdato, slik FullCalendar forventer for heldagshendelser. */
  end?: string;
  allDay: boolean;
  /** Statusfarge, slik at måneds- og ukevisning viser samme informasjon. */
  color: string;
  /** Lukkede oppdrag kan ikke flyttes, selv om kalenderen ellers er redigerbar. */
  editable: boolean;
  startEditable: boolean;
  durationEditable: boolean;
  extendedProps: { address: string };
};

/**
 * FullCalendar-innstillinger for redigering. Kalenderen skal aldri tilby
 * dra-og-slipp eller resize til en bruker som ikke kan lagre endringen.
 */
export function calendarEditingOptions(canEdit: boolean) {
  return {
    editable: canEdit,
    droppable: canEdit,
    eventDurationEditable: canEdit,
  };
}

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

  // Samme sperre som updateWorkOrderDate: fullførte og kansellerte oppdrag
  // kan ikke flyttes. FullCalendar får derfor redigering av per hendelse.
  const movable = wo.status !== "COMPLETED" && wo.status !== "CANCELLED";

  return {
    id: wo.id,
    title: wo.title,
    start,
    end,
    allDay: true,
    color: workOrderStatusColor(wo.status),
    editable: movable,
    startEditable: movable,
    durationEditable: movable,
    extendedProps: { address: formatAddress(wo.customer) },
  };
}
