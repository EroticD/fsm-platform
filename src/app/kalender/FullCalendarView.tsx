"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Calendar,
  type EventDropInfo,
  type EventResizeDoneInfo,
  type LocaleInput,
} from 'fullcalendar';
import dayGridPlugin from 'fullcalendar/daygrid';
import timeGridPlugin from 'fullcalendar/timegrid';
import interactionPlugin from 'fullcalendar/interaction';
import classicThemePlugin from 'fullcalendar/themes/classic';
import nbLocale from 'fullcalendar/locales/nb';
import enLocale from 'fullcalendar/locales/en-gb';
import plLocale from 'fullcalendar/locales/pl';
import deLocale from 'fullcalendar/locales/de';
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateTimeLocalized,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from '@/lib/dates';
import {
  calendarEditingOptions,
  isShortTimedEvent,
} from '@/lib/calendar-events';
import {
  calendarCompactDate,
  calendarDayHeaderText,
  calendarWeekdayText,
  isoWeekNumber,
} from '@/lib/calendar-format';
import { VISIT_STATUS_LABEL_KEYS } from '@/lib/visit-status';
import type { VisitStatus } from '@prisma/client';
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
} from '@/lib/work-order-status-colors';
import CalendarLegend from '@/app/kalender/CalendarLegend';
import Icon from '@/components/icons';
import { useToast } from '@/components/ToastProvider';

type EventData = {
  id: string;
  title: string;
  start: string;
  /** Eksklusiv sluttdato for heldagshendelser, ISO-tidspunkt ellers. */
  end?: string;
  allDay: boolean;
  editable?: boolean;
  startEditable?: boolean;
  durationEditable?: boolean;
  extendedProps?: {
    address?: string;
    title?: string;
    customer?: string;
    status?: string;
    visitStatus?: string;
    workOrderId?: string;
    technicians?: string[];
  };
};

/**
 * FullCalendar v7 leveres uten innebygde oversettelser utover engelsk.
 * nb/en/pl/de må derfor registreres eksplisitt. Vi bruker en-GB for engelsk
 * slik at datoene følger samme dag/måned-rekkefølge som resten av appen.
 */
const CALENDAR_LOCALES: Record<string, LocaleInput> = {
  nb: nbLocale,
  en: enLocale,
  pl: plLocale,
  de: deLocale,
};

/** Dato som lokal kalenderdag. FullCalendar bruker lokal tid, ikke UTC. */
function toLocalDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Sjekker om en heldagshendelse overlapper perioden [start, end). */
function overlapsVisibleRange(
  event: EventData,
  start: string,
  end: string,
): boolean {
  const eventStart = event.start.slice(0, 10);
  if (!event.end) return eventStart >= start && eventStart < end;
  const eventEnd = event.end.slice(0, 10);
  return eventStart < end && eventEnd > start;
}

/**
 * Heldagsvisiter flyttes som rene datoer i FullCalendar. Databasen lagrer
 * Oslo-midnatt, så datoene må regnes om her – ikke med nettleserens tidssone,
 * som kan være en annen enn Europe/Oslo.
 */
function allDayInstants(
  startDate: string,
  endDateExclusive: string | null,
): { startsAt: Date; endsAt: Date } | null {
  const start = parseDateOnly(startDate);
  if (!start) return null;
  const end = endDateExclusive
    ? parseDateOnly(endDateExclusive)
    : addDaysUtc(start, 1);
  if (!end || end.getTime() <= start.getTime()) return null;
  return {
    startsAt: osloDayStart(toDateOnly(start)),
    endsAt: osloDayStart(toDateOnly(end)),
  };
}

/**
 * Merker den vertikalt rullbare beholderen i timegrid-visningene.
 *
 * v7 bruker obfuskerte klasse- og data-attributter, så vi finner elementet via
 * den faktiske overflyten i stedet for en intern klasse. Både tidsaksen og
 * hendelsesruten er vertikale scrollere og holdes synkronisert av FullCalendar;
 * den første treffer er derfor et gyldig anker for E2E.
 */
function markCalendarScroller(root: HTMLElement): void {
  for (const element of Array.from(
    root.querySelectorAll<HTMLElement>("*"),
  )) {
    const overflowY = window.getComputedStyle(element).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      element.setAttribute("data-testid", "calendar-scroller");
      return;
    }
  }
}

export default function FullCalendarView({
  events,
  view = 'dayGridWeek',
  initialDate,
  visParam,
  technician,
  status,
  unassigned,
  weekNumbers = true,
  canEdit = false,
  canOpenEditor = canEdit,
}: {
  events: EventData[];
  view?: string;
  /** Ankerdato fra URL-en, på formatet YYYY-MM-DD. */
  initialDate: string;
  /** Rute-parameteren for visningen (maned, uke eller 2uker). */
  visParam: string;
  technician?: string;
  status?: string;
  unassigned?: boolean;
  weekNumbers?: boolean;
  /** Kan brukeren lagre ny dato? Må samsvare med API-ets rettighet. */
  canEdit?: boolean;
  /** Kan brukeren åpne den fulle redigeringssiden? */
  canOpenEditor?: boolean;
}) {
  const calendarEl = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<Calendar | null>(null);
  const activeRangeRef = useRef<{ start: string; end: string } | null>(null);
  const eventsRef = useRef(events);
  const initialDateRef = useRef(initialDate);
  const urlStateRef = useRef({ visParam, technician, status, unassigned });
  const router = useRouter();
  const t = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const tRef = useRef(t);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>(
    {},
  );

  // Hold de nyeste verdiene i refs. Da kan kalenderen opprettes én gang uten
  // at hver URL-oppdatering river den ned og mister fokus/posisjon. Refs
  // oppdateres i en effekt (ikke under render), og effekten ligger først, slik
  // at kalender-effekten nedenfor alltid ser samme commit sine verdier.
  useEffect(() => {
    eventsRef.current = events;
    initialDateRef.current = initialDate;
    urlStateRef.current = { visParam, technician, status, unassigned };
    tRef.current = t;
  });

  const recomputeVisibleCounts = useCallback((start: string, end: string) => {
    const counts: Record<string, number> = {};
    for (const event of eventsRef.current) {
      const eventStatus = event.extendedProps?.status;
      if (!eventStatus || !overlapsVisibleRange(event, start, end)) continue;
      counts[eventStatus] = (counts[eventStatus] ?? 0) + 1;
    }
    setVisibleCounts(counts);
  }, []);

  // Nye data fra server (f.eks. etter filterbytte) oppdateres uten å bygge
  // kalenderen på nytt.
  useEffect(() => {
    eventsRef.current = events;
    const calendar = calendarRef.current;
    if (!calendar) return;
    calendar.setOption('events', events);
    const range = activeRangeRef.current;
    if (range) recomputeVisibleCounts(range.start, range.end);
  }, [events, recomputeVisibleCounts]);

  useEffect(() => {
    if (!calendarEl.current) return;

    // Lagrer nytt tidsrom etter drag eller resize. FullCalendar bruker
    // eksklusiv sluttdato for heldagshendelser, mens databasen lagrer et
    // halvåpent tidsintervall. Tidsstyrte visiter sendes som ISO-tidspunkt;
    // heldagsvisiter mappes til Oslo-midnatt.
    async function saveVisitDates(info: EventDropInfo | EventResizeDoneInfo) {
      // Ekstra vakt: hendelsen skal aldri kunne flyttes uten lagringsrett.
      if (!canEdit || !info.event.startEditable || !info.event.start) {
        info.revert();
        return;
      }

      const allDay = info.oldEvent?.allDay ?? info.event.allDay;
      let startsAt: Date | null = null;
      let endsAt: Date | null = null;

      if (allDay) {
        const instants = allDayInstants(
          info.event.startStr.slice(0, 10),
          info.event.endStr ? info.event.endStr.slice(0, 10) : null,
        );
        if (instants) {
          startsAt = instants.startsAt;
          endsAt = instants.endsAt;
        }
      } else if (info.event.end) {
        startsAt = info.event.start;
        endsAt = info.event.end;
      }

      if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
        info.revert();
        toast(tRef.current('calendar.client.visitErrorInvalid'), 'error');
        return;
      }

      document.body.style.cursor = 'wait';
      try {
        const response = await fetch(
          `/api/visits/${encodeURIComponent(info.event.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
            }),
          },
        );
        if (!response.ok) {
          info.revert();
          const payload = (await response.json().catch(() => null)) as {
            code?: string;
          } | null;
          toast(
            visitSaveErrorMessage(response.status, payload?.code),
            'error',
          );
        }
      } catch {
        info.revert();
        toast(tRef.current('calendar.client.visitErrorUnknown'), 'error');
      } finally {
        document.body.style.cursor = 'default';
      }
    }

    function visitSaveErrorMessage(status: number, code?: string): string {
      const translate = tRef.current;
      if (status === 401) return translate('calendar.client.visitErrorSession');
      if (status === 403) return translate('calendar.client.visitErrorForbidden');
      if (status === 404) return translate('calendar.client.visitErrorNotFound');
      if (status === 429) return translate('calendar.client.visitErrorRateLimited');
      if (status === 400) return translate('calendar.client.visitErrorInvalid');

      switch (code) {
        case 'visits.errors.overlap':
          return translate('calendar.client.visitErrorOverlap');
        case 'visits.errors.legalHold':
          return translate('visits.errors.legalHold');
        case 'visits.errors.workOrderLocked':
          return translate('visits.errors.workOrderLocked');
        case 'visits.errors.visitLocked':
          return translate('visits.errors.visitLocked');
        case 'visits.errors.invalidTimeRange':
        case 'visits.errors.durationTooLong':
          return translate('calendar.client.visitErrorInvalid');
        default:
          return translate('calendar.client.visitErrorConflict');
      }
    }

    const calendar = new Calendar(calendarEl.current, {
      plugins: [
        dayGridPlugin,
        timeGridPlugin,
        interactionPlugin,
        classicThemePlugin,
      ],
      initialView: view,
      initialDate: initialDateRef.current,
      // v7 har headerToolbar avslått som standard, og seksjonene heter
      // start/center/end. Vi beholder samme plassering som i v6: navigasjon
      // til venstre og periodetittelen rett ved siden av.
      headerToolbar: {
        start: 'prev,next today',
        center: 'title',
        end: '',
      },
      views: {
        dayGridMonth: {
          className: 'kal-view kal-view-month',
        },
        dayGridWeek: {
          className: 'kal-view kal-view-week',
          dayHeaderFormat: {
            weekday: "short",
            day: "numeric",
            month: "numeric",
          },
          titleFormat: {
            year: "numeric",
            month: "short",
            day: "numeric",
          },
          // v7 viser ikke ukenummer i enraders dayGrid-visninger. Ukevisningen
          // får derfor et lite ukenummer i mandagens kolonneoverskrift, slik
          // at uken fortsatt kan leses uten å bytte visning.
          dayHeaderContent: function(info) {
            const nodes: HTMLElement[] = [];
            if (info.date.getDay() === 1) {
              const week = document.createElement('span');
              week.className = 'kal-day-header-week';
              week.textContent = `${tRef.current("calendar.client.week")} ${isoWeekNumber(info.date)}`;
              nodes.push(week);
            }
            const label = document.createElement('span');
            label.className = 'kal-day-header-label';
            label.textContent = calendarDayHeaderText(
              info.date,
              locale,
              false,
              info.isNarrow,
            );
            nodes.push(label);
            return { domNodes: nodes };
          },
        },
        biweekly: {
          type: 'dayGrid',
          duration: { weeks: 2 },
          className: 'kal-view kal-view-biweekly',
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
          // v7 sender en kunstig 1970-dato til dayHeaderContent for
          // dayGrid-visninger med duration: { weeks: 2 }. Datoen er feil, men
          // ukedagen er riktig. Overskriften viser derfor bare ukedagen; den
          // ekte datoen settes på hver dagcelle i dayCellTopContent under.
          dayHeaderContent: function(info) {
            const label = document.createElement('span');
            label.className = 'kal-day-header-label';
            label.textContent = calendarWeekdayText(
              info.date,
              locale,
              info.isNarrow,
            );
            return { domNodes: [label] };
          },
          // Dagcellene får den ekte datoen fra info.date, også i den andre
          // ukeraden. Uten dette ville begge radene manglet dato på mobil.
          dayCellTopContent: function(info) {
            const nodes: HTMLElement[] = [];
            // FullCalendar skjuler ukenummerkolonnen når cellene er smale
            // (mobil). Vis ukenummeret i den første cellen i hver ukerad i
            // stedet, slik at begge ukene kan leses også på 390 px.
            if (info.isNarrow && info.date.getDay() === 1) {
              const week = document.createElement('span');
              week.className = 'kal-biweekly-week';
              week.dataset.weekNumber = String(isoWeekNumber(info.date));
              week.textContent = `${tRef.current("calendar.client.week")} ${isoWeekNumber(info.date)}`;
              nodes.push(week);
            }
            const date = document.createElement('span');
            date.className = 'kal-biweekly-date';
            date.textContent = calendarCompactDate(
              info.date,
              locale,
              info.isNarrow,
            );
            nodes.push(date);
            return { domNodes: nodes };
          },
          // Ukenummeret vises i starten av hver ukerad. FullCalendar kaller
          // dette én gang per rad, så begge ukene får sitt eget ISO-nummer.
          inlineWeekNumberContent: function(info) {
            const label = document.createElement('span');
            label.textContent = `${tRef.current("calendar.client.week")} ${info.num}`;
            return { domNodes: [label] };
          },
          inlineWeekNumberDidMount: function(info) {
            info.el.setAttribute('data-week-number', String(info.num));
          },
          titleFormat: {
            year: "numeric",
            month: "short",
            day: "numeric",
          },
        },
        // Timegrid-visningene viser visittens faktiske klokkeslett og har en
        // egen heldagsbane. FullCalendar bruker kalenderens locale for både
        // tidsaksen og heldagslabelen. Ukenummer og ISO-uker er de samme som i
        // de øvrige kalendervisningene.
        timeGridWeek: {
          className: 'kal-view kal-view-timeweek',
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
          allDaySlot: true,
          nowIndicator: true,
          scrollTime: '07:00:00',
          slotMinTime: '00:00:00',
          slotMaxTime: '24:00:00',
          slotMinHeight: 28,
          dayHeaderFormat: {
            weekday: "short",
            day: "numeric",
            month: "numeric",
          },
          dayHeaderContent: function(info) {
            const label = document.createElement('span');
            label.className = 'kal-day-header-label';
            label.textContent = calendarDayHeaderText(
              info.date,
              locale,
              false,
              info.isNarrow,
            );
            return { domNodes: [label] };
          },
          titleFormat: {
            year: "numeric",
            month: "short",
            day: "numeric",
          },
        },
        timeGridDay: {
          className: 'kal-view kal-view-timeday',
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
          allDaySlot: true,
          nowIndicator: true,
          scrollTime: '07:00:00',
          slotMinTime: '00:00:00',
          slotMaxTime: '24:00:00',
          slotMinHeight: 28,
          dayHeaderFormat: {
            weekday: "long",
            day: "numeric",
            month: "long",
          },
          dayHeaderContent: function(info) {
            const label = document.createElement('span');
            label.className = 'kal-day-header-label';
            label.textContent = calendarDayHeaderText(
              info.date,
              locale,
              true,
              info.isNarrow,
            );
            return { domNodes: [label] };
          },
          titleFormat: {
            year: "numeric",
            month: "long",
            day: "numeric",
          },
        },
      },
      events: eventsRef.current,
      // Dag- og ukerutenettet skal vokse med innholdet i stedet for å skjule
      // de nederste ukene bak et internt rullefelt; de får høyden fra
      // min-height-reglene lenger ned. Timegrid må derimot ha en begrenset
      // høyde, ellers lager FullCalendar ingen vertikal scrollflate og
      // scrollTime 07:00 blir ignorert. `view` er med i effektens
      // avhengigheter, så kalenderen bygges på nytt når visningen byttes.
      height: view.startsWith("timeGrid")
        ? "clamp(20rem, 58vh, 32.5rem)"
        : "auto",
      // Korte hendelser må fortsatt ha en lesbar minimumshøyde. FullCalendar
      // bruker eventShortHeight for hendelser som er lavere enn innholdet.
      eventMinHeight: 18,
      eventShortHeight: 36,
      // Timegrid skal åpne på arbeidsdagen, ikke ved midnatt. Bare kalenderens
      // toppnivå-alternativ styrer initial scroll; visningskonfigurasjonen
      // arver det.
      scrollTime: '07:00:00',
      scrollTimeReset: false,
      locale: CALENDAR_LOCALES[locale] ?? CALENDAR_LOCALES.en,
      weekNumbers: weekNumbers,
      weekNumberCalculation: 'ISO',
      // v7 viser «W45» som standard. Resten av grensesnittet sier «uke 45».
      weekNumberFormat: { week: 'numeric' },
      // Klassene under er v7s offentlige styling-hooks. FullCalendar fjernet
      // de gamle .fc-* klassene, så all kalenderstyling henger på disse.
      headerToolbarClass: 'kal-toolbar',
      toolbarSectionClass: 'kal-toolbar-section',
      toolbarTitleClass: 'kal-toolbar-title',
      buttonClass: 'kal-button',
      buttonGroupClass: 'kal-button-group',
      tableClass: 'kal-table',
      tableHeaderClass: 'kal-table-header',
      tableBodyClass: 'kal-table-body',
      dayHeaderRowClass: 'kal-day-header-row',
      dayRowClass: 'kal-day-row',
      dayHeaderClass: (info) =>
        `kal-day-header${info.isToday ? ' kal-day-header-today' : ''}`,
      dayHeaderInnerClass: 'kal-day-header-inner',
      dayCellClass: (info) =>
        [
          'kal-day-cell',
          info.isOther ? 'kal-day-cell-other' : '',
          info.isToday ? 'kal-day-cell-today' : '',
          info.isPast ? 'kal-day-cell-past' : '',
        ]
          .filter(Boolean)
          .join(' '),
      dayCellTopClass: 'kal-day-top',
      dayCellTopInnerClass: 'kal-day-number',
      dayCellInnerClass: 'kal-day-events',
      dayCellBottomClass: 'kal-day-bottom',
      inlineWeekNumberClass: 'kal-week-number',
      slotHeaderRowClass: 'kal-slot-header-row',
      slotHeaderClass: 'kal-slot-header',
      slotHeaderInnerClass: 'kal-slot-header-inner',
      slotLaneClass: 'kal-slot-lane',
      dayLaneClass: (info) =>
        [
          'kal-day-lane',
          info.isOther ? 'kal-day-lane-other' : '',
          info.isToday ? 'kal-day-lane-today' : '',
        ]
          .filter(Boolean)
          .join(' '),
      dayLaneInnerClass: 'kal-day-lane-inner',
      allDayHeaderClass: 'kal-allday-header',
      allDayHeaderInnerClass: 'kal-allday-header-inner',
      allDayDividerClass: 'kal-allday-divider',
      weekNumberHeaderClass: 'kal-week-header',
      weekNumberHeaderInnerClass: 'kal-week-header-inner',
      nowIndicatorLineClass: 'kal-now-line',
      nowIndicatorHeaderClass: 'kal-now-header',
      highlightClass: 'kal-highlight',
      moreLinkClass: 'kal-more-link',
      moreLinkInnerClass: 'kal-more-link-inner',
      popoverClass: 'kal-popover',
      popoverCloseClass: 'kal-popover-close',
      eventClass: (info) =>
        `kal-event${info.event.startEditable ? '' : ' kal-event-locked'}`,
      rowEventClass: 'kal-row-event',
      listItemEventClass: 'kal-list-item-event',
      listItemEventBeforeClass: 'kal-event-dot',
      columnEventClass: 'kal-column-event',
      eventInnerClass: 'kal-event-inner',
      eventTimeClass: 'kal-event-time',
      eventTitleClass: 'kal-event-title',
      // v7 bruker start/end-hint på knappene i stedet for buttonHints, og
      // knappetekst per visning i stedet for buttonText.
      buttons: {
        today: {
          text: tRef.current("calendar.client.today"),
          hint: tRef.current("calendar.a11y.today"),
          className: 'kal-nav-today',
        },
        prev: {
          hint: tRef.current("calendar.a11y.previous"),
          className: 'kal-nav-prev',
        },
        next: {
          hint: tRef.current("calendar.a11y.next"),
          className: 'kal-nav-next',
        },
        dayGridMonth: { text: tRef.current("calendar.client.month") },
        dayGridWeek: { text: tRef.current("calendar.client.week") },
        biweekly: { text: tRef.current("calendar.common.biweekly") },
        timeGridWeek: { text: tRef.current("calendar.client.timeWeek") },
        timeGridDay: { text: tRef.current("calendar.client.timeDay") },
      },
      // Oppdaterer ?dato=... uten full sidelasting. Ankerdatoen er
      // kalenderens gjeldende dato, slik at refresh og deling beholder
      // samme uke/måned. router.replace gir ingen ny historikk-oppføring.
      datesSet: function(info) {
        const rangeStart = toLocalDateOnly(info.view.activeStart);
        const rangeEnd = toLocalDateOnly(info.view.activeEnd);
        activeRangeRef.current = { start: rangeStart, end: rangeEnd };
        recomputeVisibleCounts(rangeStart, rangeEnd);

        const state = urlStateRef.current;
        const params = new URLSearchParams();
        params.set("vis", state.visParam);
        params.set("dato", toLocalDateOnly(info.view.calendar.getDate()));
        if (state.technician) params.set("tekniker", state.technician);
        if (state.status) params.set("status", state.status);
        if (state.unassigned) params.set("ufordelt", "1");

        const target = `/kalender?${params.toString()}`;
        if (`${window.location.pathname}${window.location.search}` !== target) {
          router.replace(target, { scroll: false });
        }
      },
      // FullCalendar lager et rutenett uten lesbart navn. Gi det et navn som
      // sier hvilken periodevisning som er aktiv, slik at skjermlesere ikke
      // annonserer en navnløs tabell. v7 har role=table på visningsroten.
      viewDidMount: function(info) {
        if (info.view.type.startsWith("timeGrid")) {
          markCalendarScroller(info.el);
        }
        const viewLabels: Record<string, string> = {
          dayGridMonth: tRef.current("calendar.client.month"),
          dayGridWeek: tRef.current("calendar.client.week"),
          biweekly: tRef.current("calendar.client.biweekly"),
          timeGridWeek: tRef.current("calendar.client.timeWeek"),
          timeGridDay: tRef.current("calendar.client.timeDay"),
        };
        const grid =
          info.el.matches('[role="table"], [role="grid"]')
            ? info.el
            : info.el.querySelector<HTMLElement>(
                '[role="table"], [role="grid"]',
              );
        if (!grid) return;
        grid.removeAttribute("aria-labelledby");
        grid.setAttribute(
          "aria-label",
          tRef.current("calendar.a11y.gridLabel", {
            view: (viewLabels[info.view.type] ?? info.view.title).toLocaleLowerCase(
              locale,
            ),
          }),
        );
      },
      // Vis tid, tittel og adresse på hver hendelse. Bygges som DOM-noder
      // (ikke HTML-strenger) slik at brukerstyrte titler og adresser aldri
      // tolkes som markup. Status vises som prikk og tekst i tillegg til
      // fargen, slik at kalenderen ikke er avhengig av farge alene.
      eventContent: function(arg) {
        const extendedProps = arg.event.extendedProps as {
          address?: string;
          status?: string;
          visitStatus?: string;
        };
        const address = extendedProps.address;
        const eventStatus = extendedProps.status;
        const visitStatus = extendedProps.visitStatus;

        const content = document.createElement('div');
        content.className = 'fc-event-content';

        // FullCalendar gir lokaliserte klokkeslett for tidsstyrte hendelser.
        // Slutten kommer fra hendelsens faktiske `end` (backendens reelle
        // varighet), slik at måneds- og ukevisningen viser hele økten og ikke
        // bare starttiden. Heldagshendelser har ingen tid og får ingen linje.
        if (arg.timeText) {
          const endText =
            !arg.event.allDay && arg.event.end
              ? formatDateLocalized(arg.event.end, locale, {
                  timeStyle: 'short',
                  hourCycle: 'h23',
                })
              : '';
          const timeLine = document.createElement('div');
          timeLine.className = 'fc-event-time-line';
          timeLine.textContent =
            endText && endText !== arg.timeText
              ? `${arg.timeText}–${endText}`
              : arg.timeText;
          content.appendChild(timeLine);
        }

        if (eventStatus) {
          const statusLine = document.createElement('div');
          statusLine.className = 'fc-event-status-line';

          // Monokrom statusprikk i samme farge som forklaringen. Fargen er
          // aldri eneste signal – statusnavnet står ved siden av.
          const dot = document.createElement('span');
          dot.className = 'fc-event-status-dot';
          dot.setAttribute('aria-hidden', 'true');
          dot.style.backgroundColor = arg.event.color || '#101310';
          statusLine.appendChild(dot);

          const statusText = document.createElement('span');
          const labelKey =
            WORK_ORDER_STATUS_LABEL_KEYS[
              eventStatus as keyof typeof WORK_ORDER_STATUS_LABEL_KEYS
            ];
          const workOrderText = labelKey
            ? tRef.current(labelKey)
            : eventStatus;

          const visitLabelKey =
            VISIT_STATUS_LABEL_KEYS[visitStatus as VisitStatus];
          const visitText = visitLabelKey
            ? tRef.current(visitLabelKey)
            : undefined;
          // Ikke gjenta samme status to ganger når oppdrag og visitt begge er
          // «planlagt». Ulike statuser vises med begge begrepene.
          statusText.textContent =
            visitText && visitText !== workOrderText
              ? `${workOrderText} · ${visitText}`
              : workOrderText;
          statusLine.appendChild(statusText);

          content.appendChild(statusLine);
        }

        const title = document.createElement('div');
        title.className = 'fc-event-title-line';
        title.textContent = arg.event.title;
        content.appendChild(title);

        if (address) {
          const addressLine = document.createElement('div');
          addressLine.className = 'fc-event-address';
          addressLine.textContent = address;
          content.appendChild(addressLine);
        }

        return { domNodes: [content] };
      },
      // R2-08: dra, slipp og resize styres av samme rettighet som
      // visitt-API-et krever. Lukkede oppdrag/visiter sperres per hendelse.
      ...calendarEditingOptions(canEdit),
      // En heldagsvisitt skal ikke kunne dras inn i tidsrutenettet (eller
      // omvendt): tidsrommet har en annen betydning, og API-et flytter bare
      // tidspunktet, ikke allDay-flagget.
      eventAllow: (dropInfo, draggedEvent) =>
        !draggedEvent || draggedEvent.allDay === dropInfo.allDay,
      eventDidMount: function(info) {
        // Kortet er papir/ink, men beholder statusfargen som en tynn
        // venstrekant. Fargen settes per hendelse, ikke som bakgrunn.
        info.el.style.setProperty(
          "--event-accent",
          info.event.color || "var(--ink, #101310)",
        );
        // Stabile kroker for E2E. FullCalendar v7 har ikke lenger .fc-event.
        if (!info.isMirror) {
          info.el.dataset.testid = 'calendar-event';
          info.el.dataset.eventId = info.event.id;
          if (
            !info.event.allDay &&
            isShortTimedEvent(info.event.start, info.event.end)
          ) {
            info.el.dataset.short = 'true';
          }
        }
      },
      // v7 fjernet .fc-daygrid-day. data-date settes eksplisitt, slik at
      // dra-og-slipp-tester og hjelpeverktøy kan finne dagceller uten å
      // kjenne FullCalendars interne klasser.
      dayCellDidMount: function(info) {
        info.el.setAttribute('data-date', toLocalDateOnly(info.date));
      },
      dayLaneDidMount: function(info) {
        info.el.setAttribute('data-date', toLocalDateOnly(info.date));
      },
      eventClick: function(info) {
        const extendedProps = info.event.extendedProps as {
          workOrderId?: string;
        };
        router.push(`/oppdrag/${extendedProps.workOrderId ?? info.event.id}`);
      },
      eventDrop: canEdit ? saveVisitDates : undefined,
      eventResize: canEdit ? saveVisitDates : undefined,
    });

    calendarRef.current = calendar;
    calendar.render();

    return () => {
      calendar.destroy();
      if (calendarRef.current === calendar) calendarRef.current = null;
    };
  }, [view, weekNumbers, canEdit, locale, toast, router, recomputeVisibleCounts]);

  // Holder kalenderen i takt med URL-en ved tilbake/neste i nettleseren og
  // når en fane bytter visning uten at komponenten remonteres.
  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;
    const currentDate = toLocalDateOnly(calendar.getDate());
    if (currentDate !== initialDate) {
      calendar.gotoDate(initialDate);
    }
  }, [initialDate]);

  const legendItems = WORK_ORDER_STATUS_ORDER.filter(
    (candidate) => candidate !== "CANCELLED",
  ).map((candidate) => ({
    status: candidate,
    label: t(WORK_ORDER_STATUS_LABEL_KEYS[candidate]),
    count: visibleCounts[candidate] ?? 0,
  }));

  return (
    <div className="space-y-3">
      <CalendarLegend
        title={t("calendar.legend.visibleTitle")}
        items={legendItems}
      />
      <div className="office-card p-3 text-[var(--ink,#101310)] sm:p-4">
        <div
          ref={calendarEl}
          className={`kalender-container${canEdit ? " kalender-editable" : ""}`}
        ></div>
        <details className="mt-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-[var(--ink,#101310)] [&::-webkit-details-marker]:hidden">
            <Icon name="menu" className="h-4 w-4" />
            {t("calendar.a11y.keyboardTitle")}
          </summary>
          <p className="mt-2 text-xs text-[var(--muted,#62685f)]">
            {canEdit
              ? t("calendar.a11y.keyboardAlternative")
              : t("calendar.a11y.keyboardAlternativeReadOnly")}
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {events.slice(0, 100).map((event) => (
              <li key={event.id}>
                <Link
                  href={
                    canOpenEditor
                      ? `/oppdrag/${event.extendedProps?.workOrderId ?? event.id}/rediger`
                      : `/oppdrag/${event.extendedProps?.workOrderId ?? event.id}`
                  }
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 py-1.5 font-medium text-[var(--ink,#101310)] transition hover:bg-[var(--surface,#fffdf8)]"
                >
                  <span className="truncate">{event.title}</span>
                  <span className="shrink-0 text-xs text-[var(--muted,#62685f)]">
                    {canOpenEditor
                      ? t("calendar.a11y.openInEditor")
                      : t("calendar.a11y.openWorkOrder")}{" "}
                    ·{" "}
                    {event.allDay
                      ? formatDateLocalized(event.start, locale)
                      : formatDateTimeLocalized(event.start, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
        <style jsx global>{`
          .kalender-container {
            /* Classic er valgt fordi den er nærmest den eksisterende
               papir/ink-kalenderen: rutenett, kolonneoverskrifter og
               verktøylinje har samme struktur som v6-designet. v7-klassene
               under er de offentlige styling-hookene; de gamle .fc-* klassene
               finnes ikke lenger. */
            --fc-classic-background: var(--surface, #fffdf8);
            --fc-classic-foreground: var(--ink, #101310);
            --fc-classic-border: var(--line, #dedcd1);
            --fc-classic-strong-border: var(--ink, #101310);
            --fc-classic-muted: var(--paper, #f2efe6);
            --fc-classic-muted-foreground: var(--muted, #62685f);
            --fc-classic-faint: color-mix(
              in srgb,
              var(--paper, #f2efe6) 45%,
              var(--surface, #fffdf8)
            );
            --fc-classic-faint-foreground: var(--muted, #62685f);
            --fc-classic-strong: color-mix(
              in srgb,
              var(--line, #dedcd1) 70%,
              var(--paper, #f2efe6)
            );
            --fc-classic-today: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 22%,
              var(--surface, #fffdf8)
            );
            --fc-classic-highlight: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 28%,
              transparent
            );
            --fc-classic-now: var(--risk, #f04427);
            --fc-classic-primary: var(--ink, #101310);
            --fc-classic-primary-foreground: var(--paper, #f2efe6);
            --fc-classic-button: transparent;
            --fc-classic-button-border: var(--ink, #101310);
            --fc-classic-button-foreground: var(--ink, #101310);
            --fc-classic-button-strong: var(--ink, #101310);
            --fc-classic-button-strong-border: var(--ink, #101310);
            --fc-classic-ring-color: var(--focus-ring, #2563eb);
            color: var(--ink, #101310);
            font-family: inherit;
          }
          .kalender-container .kal-view {
            overflow: hidden;
            border: 1px solid var(--line, #dedcd1) !important;
            border-radius: 12px;
            background: var(--surface, #fffdf8);
            color: var(--ink, #101310);
          }
          .kalender-container .kal-table-header {
            background: var(--ink, #101310);
          }

          /* Verktøylinje og knapper */
          .kalender-container .kal-toolbar {
            margin-bottom: 0.75rem !important;
            gap: 0.75rem;
            flex-wrap: wrap;
            align-items: center;
          }
          .kalender-container .kal-toolbar-section {
            display: flex;
            align-items: center;
            gap: 0.4rem;
          }
          .kalender-container .kal-toolbar-section:nth-child(2) {
            text-align: left;
          }
          .kalender-container .kal-button-group {
            display: flex;
            gap: 0.25rem;
          }
          .kalender-container .kal-toolbar-title {
            color: var(--ink, #101310);
            font-size: 1rem;
            font-weight: 800;
            text-transform: capitalize;
          }
          .kalender-container .kal-button {
            display: inline-flex;
            min-height: 36px;
            align-items: center;
            justify-content: center;
            padding: 0.35rem 0.75rem;
            border: 1px solid var(--ink, #101310) !important;
            border-radius: 9px !important;
            background: transparent !important;
            color: var(--ink, #101310) !important;
            box-shadow: none !important;
            font-size: 0.75rem;
            font-weight: 800;
            line-height: 1.2;
            text-transform: none;
            transition:
              background-color 120ms ease,
              color 120ms ease;
          }
          .kalender-container .kal-button:hover:not(:disabled) {
            background: var(--ink, #101310) !important;
            color: var(--paper, #f2efe6) !important;
          }
          .kalender-container .kal-button:disabled {
            cursor: default;
            opacity: 0.45;
          }
          .kalender-container .kal-nav-prev,
          .kalender-container .kal-nav-next {
            padding-inline: 0.55rem;
          }
          .kalender-container .kal-nav-prev svg,
          .kalender-container .kal-nav-next svg {
            width: 1rem;
            height: 1rem;
          }
          .kalender-container .kal-nav-today {
            border-color: var(--ink, #101310) !important;
            background: var(--signal, #d8ff3e) !important;
            color: var(--ink, #101310) !important;
          }
          .kalender-container .kal-nav-today:hover:not(:disabled) {
            background: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 82%,
              var(--ink, #101310)
            ) !important;
            color: var(--ink, #101310) !important;
          }

          /* Dagoverskrifter */
          .kalender-container .kal-day-header {
            border-color: var(--ink, #101310) !important;
            border-bottom: 2px solid var(--signal, #d8ff3e) !important;
            background: var(--ink, #101310);
            color: var(--paper, #f2efe6);
            text-align: center;
          }
          .kalender-container .kal-day-header-inner {
            display: flex;
            flex-direction: column;
            gap: 1px;
            align-items: center;
            padding: 0.55rem 0.35rem !important;
            color: var(--paper, #f2efe6) !important;
            font-size: 0.68rem;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-decoration: none !important;
            text-transform: uppercase;
          }
          .kalender-container .kal-day-header-week {
            color: var(--signal, #d8ff3e);
            font-size: 0.6rem;
            letter-spacing: 0.06em;
          }
          .kalender-container .kal-day-header-today {
            background: var(--ink, #101310);
          }
          .kalender-container
            .kal-day-header-today
            .kal-day-header-inner {
            color: var(--signal, #d8ff3e) !important;
          }

          /* Rutenett og dagnumre */
          .kalender-container .kal-day-cell {
            background: var(--surface, #fffdf8);
            transition: background-color 120ms ease;
          }
          /* v7 setter min-height: 0 !important på dagnettets celler. Uten
             !important blir høyde-reglene under stille ignorert, og uke- og
             to-ukersvisningen kollapser til innholdshøyde. */
          .kalender-container .kal-view-month .kal-day-cell {
            min-height: clamp(4.5rem, 10vw, 7rem) !important;
          }
          .kalender-container .kal-view-week .kal-day-cell {
            min-height: 60vh !important;
          }
          .kalender-container .kal-view-biweekly .kal-day-cell {
            min-height: 30vh !important;
          }
          .kalender-container .kal-day-cell:hover {
            background: color-mix(
              in srgb,
              var(--paper, #f2efe6) 55%,
              var(--surface, #fffdf8)
            );
          }
          .kalender-container .kal-day-top {
            padding: 2px 3px 0 0;
          }
          .kalender-container .kal-day-number {
            display: inline-flex;
            min-width: 1.7rem;
            min-height: 1.7rem;
            align-items: center;
            justify-content: center;
            margin: 1px;
            padding: 0 0.35rem;
            border-radius: 9999px;
            color: var(--ink, #101310) !important;
            font-weight: 800;
            text-decoration: none !important;
          }
          /* To-ukersvisningen viser en kompakt dato i hver dagcelle, i begge
             ukeradene. FullCalendar sender den ekte datoen til
             dayCellTopContent, også når kolonneoverskriften bare viser
             ukedagen. */
          .kalender-container .kal-biweekly-date {
            font-size: 0.78rem;
            font-weight: 800;
            font-variant-numeric: tabular-nums;
            letter-spacing: 0.01em;
            line-height: 1;
            white-space: nowrap;
          }
          .kalender-container .kal-biweekly-week {
            display: block;
            color: var(--muted, #62685f);
            font-size: 0.62rem;
            font-weight: 800;
            line-height: 1.1;
            white-space: nowrap;
          }
          .kalender-container .kal-view-biweekly .kal-day-number {
            max-width: calc(100% - 2px);
            overflow: hidden;
          }
          .kalender-container .kal-day-cell-today {
            background: var(--fc-classic-today) !important;
          }
          .kalender-container
            .kal-day-cell-today
            .kal-day-number {
            background: var(--ink, #101310);
            color: var(--signal, #d8ff3e) !important;
          }
          /* Ukevisningen viser datoen i kolonneoverskriften. FullCalendar
             setter igjen en dagnummer-celle for «i dag»; skjul den, slik at
             markøren ikke blir en tom svart sirkel. */
          .kalender-container
            .kal-view-week
            .kal-day-cell-today
            .kal-day-number {
            display: none;
          }
          .kalender-container .kal-day-cell-other {
            background: color-mix(
              in srgb,
              var(--paper, #f2efe6) 45%,
              var(--surface, #fffdf8)
            );
          }
          .kalender-container
            .kal-day-cell-other
            .kal-day-number {
            color: var(--muted, #62685f) !important;
          }
          .kalender-container .kal-week-number {
            background: var(--paper, #f2efe6) !important;
            color: var(--muted, #62685f) !important;
            font-size: 0.75rem;
            font-weight: 800;
            text-align: center;
            white-space: nowrap;
          }
          .kalender-container .kal-day-events {
            margin: 0 2px 2px;
          }

          /* Timegrid: tydelige timer, markert nå-linje og egen heldagsbane. */
          .kalender-container .kal-slot-header-inner,
          .kalender-container .kal-week-header-inner {
            color: var(--muted, #62685f);
            font-size: 0.68rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }
          .kalender-container .kal-week-header,
          .kalender-container .kal-allday-header {
            background: var(--paper, #f2efe6);
          }
          .kalender-container .kal-allday-header-inner {
            color: var(--muted, #62685f);
            font-size: 0.68rem;
            font-weight: 700;
          }
          .kalender-container .kal-slot-lane {
            background: var(--surface, #fffdf8);
          }
          .kalender-container .kal-day-lane-today {
            background: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 12%,
              var(--surface, #fffdf8)
            );
          }
          .kalender-container .kal-day-lane-other {
            background: color-mix(
              in srgb,
              var(--paper, #f2efe6) 30%,
              var(--surface, #fffdf8)
            );
          }
          .kalender-container .kal-now-line {
            border-color: var(--risk, #f04427);
            border-width: 2px;
          }
          .kalender-container .kal-now-header {
            border-color: var(--risk, #f04427);
            border-width: 6px;
          }
          .kalender-container .kal-allday-divider {
            padding: 0;
            border-color: var(--line, #dedcd1);
          }
          .kalender-container .kal-highlight {
            background: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 28%,
              transparent
            ) !important;
          }

          /* Oppdragskort */
          .kalender-container .kal-event {
            margin: 1px 2px;
            padding: 3px 5px;
            overflow: hidden;
            border: 1px solid var(--line, #dedcd1) !important;
            border-left: 3px solid
              var(--event-accent, var(--ink, #101310)) !important;
            border-radius: 7px !important;
            background: var(--surface, #fffdf8) !important;
            color: var(--ink, #101310) !important;
            box-shadow: 0 1px 0 rgb(16 19 16 / 0.06);
            font-weight: 500;
          }
          .kalender-container .kal-event:hover {
            border-color: var(--ink, #101310) !important;
            border-left-color: var(--event-accent, var(--ink, #101310)) !important;
            box-shadow: 2px 2px 0 var(--signal, #d8ff3e);
          }
          .kalender-container .kal-event-inner {
            padding: 0;
            overflow: hidden;
            color: var(--ink, #101310) !important;
          }
          .kalender-container .kal-event-dot {
            display: none;
          }
          .kalender-container .kal-row-event,
          .kalender-container .kal-list-item-event,
          .kalender-container .kal-column-event {
            white-space: normal;
          }
          .kalender-container .kal-column-event .kal-event-inner {
            padding: 2px 4px;
          }
          .kalender-editable .kal-event {
            cursor: grab !important;
          }
          .kalender-editable .kal-event:active {
            cursor: grabbing !important;
            opacity: 0.8;
          }
          .kalender-editable .kal-event-locked {
            cursor: default !important;
          }
          .kalender-container .fc-event-content {
            display: flex;
            flex-direction: column;
            gap: 1px;
            white-space: normal;
          }
          .kalender-container .fc-event-time-line {
            color: var(--ink, #101310);
            font-size: 0.68em;
            font-weight: 800;
            line-height: 1.1;
            letter-spacing: 0.02em;
          }
          .kalender-container .fc-event-status-line {
            display: flex;
            align-items: center;
            gap: 4px;
            color: var(--muted, #62685f);
            font-size: 0.64em;
            font-weight: 800;
            letter-spacing: 0.05em;
            line-height: 1.1;
            text-transform: uppercase;
          }
          .kalender-container .fc-event-status-dot {
            display: inline-block;
            width: 0.42rem;
            height: 0.42rem;
            flex-shrink: 0;
            border-radius: 9999px;
          }
          .kalender-container .fc-event-title-line {
            color: var(--ink, #101310);
            font-weight: 800;
            line-height: 1.15;
            overflow-wrap: anywhere;
          }
          .kalender-container .fc-event-address {
            color: var(--muted, #62685f);
            font-size: 0.72em;
            font-weight: 500;
            line-height: 1.1;
            overflow-wrap: anywhere;
          }
          /* Tidsstyrte hendelser under 30 minutter har ikke plass til hele
             innholdsbunken. Adresse og statuslinje skjules; klokkeslett og
             tittel beholdes, og kortet klippes fortsatt til sin egen rute. */
          .kalender-container .kal-event[data-short="true"] {
            padding: 1px 4px;
          }
          .kalender-container
            .kal-event[data-short="true"]
            .fc-event-address,
          .kalender-container
            .kal-event[data-short="true"]
            .fc-event-status-line {
            display: none;
          }
          .kalender-container
            .kal-event[data-short="true"]
            .fc-event-content {
            gap: 0;
          }
          .kalender-container
            .kal-event[data-short="true"]
            .fc-event-time-line {
            font-size: 0.75rem;
            line-height: 1.1;
          }
          .kalender-container
            .kal-event[data-short="true"]
            .fc-event-title-line {
            overflow: hidden;
            font-size: 0.75rem;
            line-height: 1.1;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .kalender-container .kal-more-link {
            color: var(--ink, #101310);
            font-size: 0.7rem;
            font-weight: 800;
          }
          .kalender-container .kal-popover {
            border: 1px solid var(--line, #dedcd1);
            border-radius: 12px;
            background: var(--surface, #fffdf8);
            color: var(--ink, #101310);
            box-shadow: 0 18px 40px -24px rgb(16 19 16 / 0.45);
          }

          @media (max-width: 640px) {
            /* Månedsrutenettet har svært smale celler på mobil. Klipp hver
               linje i stedet for at titler og adresser brekkes bokstav for
               bokstav; hele innholdet nås ved å åpne oppdraget. */
            .kalender-container .kal-toolbar {
              margin-bottom: 0.5rem !important;
              gap: 0.4rem;
            }
            .kalender-container .kal-button {
              min-height: 32px;
              padding: 0.3rem 0.55rem;
              font-size: 0.68rem;
            }
            .kalender-container .kal-day-header-inner {
              padding: 0.4rem 0.15rem !important;
              font-size: 0.58rem;
              letter-spacing: 0.04em;
            }
            .kalender-container .kal-day-number {
              min-width: 1.35rem;
              min-height: 1.35rem;
              font-size: 0.75rem;
            }
            .kalender-container .kal-event {
              margin: 1px;
              padding: 2px 3px;
            }
            .kalender-container .fc-event-title-line,
            .kalender-container .fc-event-address,
            .kalender-container .fc-event-status-line {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .kalender-container .fc-event-status-line {
              font-size: 0.62em;
            }
            /* To-ukersvisningen viser bare dagnummer når cellen er smal.
               Fortsatt synlig, slik at den andre ukeraden har dato. */
            .kalender-container .kal-biweekly-date {
              font-size: 0.75rem;
              letter-spacing: 0;
            }
            .kalender-container .kal-view-week .kal-day-cell {
              min-height: 42vh !important;
            }
            .kalender-container .kal-view-biweekly .kal-day-cell {
              min-height: 24vh !important;
            }
            .kalender-container .kal-view-month .kal-day-cell {
              min-height: 4.25rem !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
