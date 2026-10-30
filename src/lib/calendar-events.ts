import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  dateOnlyInOslo,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import { workOrderStatusColor } from "@/lib/work-order-status-colors";

export type CalendarEventExtendedProps = {
  address: string;
  /** Oppdragets tittel, slik at klienten kan vise den også utenom hendelsen. */
  title?: string;
  /** Kundenavn, brukt i verktøytips og tastaturalternativet. */
  customer?: string;
  /** Oppdragsstatus. Styrer fargen og legendens telling. */
  status?: string;
  /** Visittens egen status (PLANNED, ON_SITE, DONE …). */
  visitStatus?: string;
  workOrderId?: string;
  /** Navnene på montørene som er satt på visitten. */
  technicians?: string[];
};

export type CalendarEventData = {
  id: string;
  title: string;
  start: string;
  /** Eksklusiv sluttdato for heldagshendelser, ISO-tidspunkt ellers. */
  end?: string;
  allDay: boolean;
  /** Statusfarge, slik at måneds- og ukevisning viser samme informasjon. */
  color: string;
  /** Lukkede oppdrag/visiter kan ikke flyttes, selv om kalenderen er redigerbar. */
  editable: boolean;
  startEditable: boolean;
  durationEditable: boolean;
  extendedProps: CalendarEventExtendedProps;
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
 * Eldre oppdrag kan mangle visiter (backfill dekker de fleste). Kalenderen
 * bruker visiter som kilde, men denne hjelperen beholdes for kompatibilitet og
 * for kallere som bare har oppdragets avledede datoperiode.
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
    extendedProps: {
      address: formatAddress(wo.customer),
      title: wo.title,
      status: wo.status,
      workOrderId: wo.id,
    },
  };
}

type VisitForCalendar = {
  id: string;
  workOrderId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  technicians: Array<{
    user: { name: string | null; email?: string | null };
  }>;
  workOrder: {
    id: string;
    title: string;
    status: string;
    customer: {
      name?: string | null;
      address: string | null;
      postalCode: string | null;
      city: string | null;
    } | null;
  };
};

function isClosedVisitStatus(status: string): boolean {
  return status === "DONE" || status === "CANCELLED";
}

function isClosedWorkOrderStatus(status: string): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/**
 * Gjør en visitt om til én FullCalendar-hendelse.
 *
 * Tidsstyrte visiter beholder klokkeslettet (`allDay: false`) og sendes som
 * ISO-tidspunkt, slik at nettleseren viser dem i sin lokale tidssone.
 * Heldagsvisiter sendes som rene datoer med eksklusiv sluttdato, slik
 * FullCalendar forventer. Datoene regnes i Europe/Oslo, fordi visittene lagres
 * som Oslo-midnatt og sommertid ellers kan flytte en dag.
 *
 * En visitt uten gyldig tidsrom gir ingen hendelse. Vi lager aldri en
 * syntetisk tid for et oppdrag som mangler visitt.
 */
export function toVisitCalendarEvent(
  visit: VisitForCalendar,
): CalendarEventData | null {
  if (
    !(visit.startsAt instanceof Date) ||
    !(visit.endsAt instanceof Date) ||
    Number.isNaN(visit.startsAt.getTime()) ||
    Number.isNaN(visit.endsAt.getTime()) ||
    visit.endsAt.getTime() <= visit.startsAt.getTime()
  ) {
    return null;
  }

  let start: string;
  let end: string;

  if (visit.allDay) {
    start = dateOnlyInOslo(visit.startsAt);
    const lastDay = dateOnlyInOslo(
      new Date(visit.endsAt.getTime() - 1),
    );
    const parsedLastDay = parseDateOnly(lastDay);
    if (!parseDateOnly(start) || !parsedLastDay) return null;
    end = toDateOnly(addDaysUtc(parsedLastDay, 1));
  } else {
    start = visit.startsAt.toISOString();
    end = visit.endsAt.toISOString();
  }

  const movable =
    !isClosedWorkOrderStatus(visit.workOrder.status) &&
    !isClosedVisitStatus(visit.status);

  const technicians = visit.technicians
    .map(
      (technician) =>
        technician.user.name || technician.user.email || "",
    )
    .filter((name) => name.length > 0);

  return {
    id: visit.id,
    title: visit.workOrder.title,
    start,
    end,
    allDay: visit.allDay,
    color: workOrderStatusColor(visit.workOrder.status),
    editable: movable,
    startEditable: movable,
    durationEditable: movable,
    extendedProps: {
      address: formatAddress(visit.workOrder.customer),
      title: visit.workOrder.title,
      customer: visit.workOrder.customer?.name ?? "",
      status: visit.workOrder.status,
      visitStatus: visit.status,
      workOrderId: visit.workOrder.id,
      technicians,
    },
  };
}
