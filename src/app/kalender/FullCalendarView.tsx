"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar, type EventDropArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import { formatDateLocalized, inclusiveLastDay } from '@/lib/dates';
import { calendarEditingOptions } from '@/lib/calendar-events';
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
  /** Eksklusiv sluttdato for heldagshendelser. */
  end?: string;
  allDay: boolean;
  editable?: boolean;
  startEditable?: boolean;
  durationEditable?: boolean;
  extendedProps?: { address?: string; status?: string };
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

    // Lagrer ny start- og sluttdato etter drag eller resize. FullCalendar
    // bruker eksklusiv sluttdato, mens databasen lagrer siste inkluderte dag.
    async function saveDates(info: EventDropArg | EventResizeDoneArg) {
      // Ekstra vakt: hendelsen skal aldri kunne flyttes uten lagringsrett.
      if (!canEdit || !info.event.startEditable || !info.event.start) {
        info.revert();
        return;
      }

      const newDate = info.event.startStr.slice(0, 10);
      const lastDay = info.event.endStr ? inclusiveLastDay(info.event.endStr) : "";
      const newEnd = lastDay && lastDay > newDate ? lastDay : null;

      document.body.style.cursor = 'wait';
      try {
        const response = await fetch(`/api/oppdrag/${info.event.id}/date`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newDate, newEnd }),
        });
        if (!response.ok) {
          info.revert();
          toast(tRef.current("calendar.client.saveError"), "error");
        }
      } catch {
        info.revert();
        toast(tRef.current("calendar.client.saveError"), "error");
      } finally {
        document.body.style.cursor = 'default';
      }
    }

    const calendar = new Calendar(calendarEl.current, {
      plugins: [dayGridPlugin, interactionPlugin],
      initialView: view,
      initialDate: initialDateRef.current,
      headerToolbar: {
        left: 'prev,next today',
        // Perioden vises i sidehodet. FullCalendar skal ikke gjenta den som en
        // egen tittel, og visningsbyttet ligger i fanene over kalenderen.
        center: '',
        right: '',
      },
      views: {
        dayGridWeek: {
          dayHeaderFormat: {
            weekday: "short",
            day: "numeric",
            month: "numeric",
          },
        },
        biweekly: {
          type: 'dayGrid',
          duration: { weeks: 2 },
          buttonText: tRef.current("calendar.common.biweekly"),
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
          // To-ukersvisningen skjuler dagnumrene på mobil. Da må
          // kolonneoverskriften vise både ukedag og dato.
          dayHeaderFormat: {
            weekday: "short",
            day: "numeric",
            month: "numeric",
          },
        },
      },
      events: eventsRef.current,
      // La kalenderen vokse med innholdet i stedet for å skjule de nederste
      // ukene bak en intern rullefelt. Uke og to uker får høyden fra
      // min-height-reglene lenger ned.
      height: 'auto',
      locale: locale,
      weekNumbers: weekNumbers,
      weekNumberCalculation: 'ISO',
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
      // annonserer en navnløs tabell.
      viewDidMount: function(info) {
        const viewLabels: Record<string, string> = {
          dayGridMonth: tRef.current("calendar.client.month"),
          dayGridWeek: tRef.current("calendar.client.week"),
          biweekly: tRef.current("calendar.client.biweekly"),
        };
        const grid = calendarEl.current?.querySelector<HTMLElement>(
          '[role="grid"], .fc-scrollgrid',
        );
        grid?.setAttribute(
          "aria-label",
          tRef.current("calendar.a11y.gridLabel", {
            view: (viewLabels[info.view.type] ?? info.view.title).toLocaleLowerCase(
              locale,
            ),
          }),
        );
      },
      // Vis tittel og adresse på hver hendelse. Bygges som DOM-noder (ikke
      // HTML-strenger) slik at brukerstyrte titler og adresser aldri tolkes
      // som markup. Status vises som prikk og tekst i tillegg til fargen,
      // slik at kalenderen ikke er avhengig av farge alene.
      eventContent: function(arg) {
        const extendedProps = arg.event.extendedProps as {
          address?: string;
          status?: string;
        };
        const address = extendedProps.address;
        const eventStatus = extendedProps.status;

        const content = document.createElement('div');
        content.className = 'fc-event-content';

        if (eventStatus) {
          const statusLine = document.createElement('div');
          statusLine.className = 'fc-event-status-line';

          // Monokrom statusprikk i samme farge som forklaringen. Fargen er
          // aldri eneste signal – statusnavnet står ved siden av.
          const dot = document.createElement('span');
          dot.className = 'fc-event-status-dot';
          dot.setAttribute('aria-hidden', 'true');
          dot.style.backgroundColor = arg.event.backgroundColor || '#101310';
          statusLine.appendChild(dot);

          const statusText = document.createElement('span');
          const labelKey =
            WORK_ORDER_STATUS_LABEL_KEYS[
              eventStatus as keyof typeof WORK_ORDER_STATUS_LABEL_KEYS
            ];
          statusText.textContent = labelKey
            ? tRef.current(labelKey)
            : eventStatus;
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
      buttonText: {
        today: tRef.current("calendar.client.today"),
        week: tRef.current("calendar.client.week"),
        month: tRef.current("calendar.client.month"),
      },
      buttonHints: {
        prev: tRef.current("calendar.a11y.previous"),
        next: tRef.current("calendar.a11y.next"),
        today: tRef.current("calendar.a11y.today"),
      },
      // R2-08: dra, slipp og resize styres av samme rettighet som
      // dato-API-et krever. Lukkede oppdrag sperres per hendelse.
      ...calendarEditingOptions(canEdit),
      eventClassNames: (arg) =>
        arg.event.startEditable ? [] : ["fc-event-locked"],
      eventDidMount: function(info) {
        // Kortet er papir/ink, men beholder statusfargen som en tynn
        // venstrekant. Fargen settes per hendelse, ikke som bakgrunn.
        info.el.style.setProperty(
          "--event-accent",
          info.event.backgroundColor || "var(--ink, #101310)",
        );
      },
      eventClick: function(info) {
        router.push(`/oppdrag/${info.event.id}`);
      },
      eventDrop: canEdit ? saveDates : undefined,
      eventResize: canEdit ? saveDates : undefined,
    });

    calendarRef.current = calendar;
    calendar.render();

    // FullCalendar lager ikon-knapper uten lesbar etikett. Gi knappene et
    // eksplisitt aria-label og skjul selve chevron-ikonet for skjermlesere,
    // slik at de ikke leses som tomme knapper.
    const toolbar = calendarEl.current.querySelector('.fc-toolbar');
    const labelButton = (selector: string, label: string) => {
      toolbar?.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
        button.setAttribute('aria-label', label);
      });
    };
    labelButton('.fc-prev-button', tRef.current("calendar.a11y.previous"));
    labelButton('.fc-next-button', tRef.current("calendar.a11y.next"));
    labelButton('.fc-today-button', tRef.current("calendar.a11y.today"));
    toolbar?.querySelectorAll('.fc-icon').forEach((icon) => {
      icon.setAttribute('aria-hidden', 'true');
    });

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
                      ? `/oppdrag/${event.id}/rediger`
                      : `/oppdrag/${event.id}`
                  }
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 py-1.5 font-medium text-[var(--ink,#101310)] transition hover:bg-[var(--surface,#fffdf8)]"
                >
                  <span className="truncate">{event.title}</span>
                  <span className="shrink-0 text-xs text-[var(--muted,#62685f)]">
                    {canOpenEditor
                      ? t("calendar.a11y.openInEditor")
                      : t("calendar.a11y.openWorkOrder")}{" "}
                    · {formatDateLocalized(event.start, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
        <style jsx global>{`
          .kalender-container {
            --fc-border-color: var(--line, #dedcd1);
            --fc-page-bg-color: var(--surface, #fffdf8);
            --fc-neutral-bg-color: var(--paper, #f2efe6);
            --fc-neutral-text-color: var(--muted, #62685f);
            --fc-today-bg-color: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 18%,
              var(--surface, #fffdf8)
            );
            --fc-event-bg-color: var(--surface, #fffdf8);
            --fc-event-border-color: var(--line, #dedcd1);
            --fc-event-text-color: var(--ink, #101310);
            --fc-button-bg-color: transparent;
            --fc-button-border-color: var(--ink, #101310);
            --fc-button-text-color: var(--ink, #101310);
            --fc-button-hover-bg-color: var(--ink, #101310);
            --fc-button-hover-border-color: var(--ink, #101310);
            --fc-button-hover-text-color: var(--paper, #f2efe6);
            --fc-button-active-bg-color: var(--ink, #101310);
            --fc-button-active-border-color: var(--ink, #101310);
            --fc-button-active-text-color: var(--signal, #d8ff3e);
            color: var(--ink, #101310);
          }
          .kalender-container .fc {
            font-family: inherit;
            color: var(--ink, #101310);
          }
          .kalender-container .fc-scrollgrid {
            overflow: hidden;
            border-color: var(--line, #dedcd1) !important;
            border-radius: 12px;
            background: var(--surface, #fffdf8);
          }
          .kalender-container .fc-theme-standard td,
          .kalender-container .fc-theme-standard th {
            border-color: var(--line, #dedcd1);
          }

          /* Verktøylinje og knapper */
          .kalender-container .fc-toolbar {
            margin-bottom: 0.75rem !important;
            gap: 0.5rem;
            flex-wrap: wrap;
          }
          .kalender-container .fc-toolbar-chunk {
            display: flex;
            gap: 0.4rem;
          }
          .kalender-container .fc-button {
            min-height: 36px;
            padding: 0.35rem 0.75rem;
            border-radius: 9px !important;
            border: 1px solid var(--ink, #101310) !important;
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
          .kalender-container .fc-button:hover:not(:disabled) {
            background: var(--ink, #101310) !important;
            color: var(--paper, #f2efe6) !important;
          }
          .kalender-container .fc-today-button {
            border-color: var(--ink, #101310) !important;
            background: var(--signal, #d8ff3e) !important;
            color: var(--ink, #101310) !important;
          }
          .kalender-container .fc-today-button:hover:not(:disabled) {
            background: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 82%,
              var(--ink, #101310)
            ) !important;
            color: var(--ink, #101310) !important;
          }
          .kalender-container .fc-button:disabled {
            opacity: 0.45;
          }
          .kalender-container .fc-icon {
            font-size: 0.9em;
          }
          .kalender-container .fc-toolbar-title {
            font-size: 1rem;
            font-weight: 800;
          }

          /* Dagoverskrifter */
          .kalender-container .fc-col-header-cell {
            background: var(--ink, #101310);
            border-color: var(--ink, #101310) !important;
            border-bottom: 2px solid var(--signal, #d8ff3e) !important;
          }
          .kalender-container .fc-col-header-cell-cushion {
            display: block;
            padding: 0.55rem 0.35rem !important;
            color: var(--paper, #f2efe6) !important;
            font-size: 0.68rem;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-decoration: none !important;
            text-transform: uppercase;
          }
          .kalender-container .fc-col-header-cell.fc-day-today {
            background: var(--ink, #101310);
          }
          .kalender-container .fc-col-header-cell.fc-day-today .fc-col-header-cell-cushion {
            color: var(--signal, #d8ff3e) !important;
          }

          /* Rutenett og dagnumre */
          .kalender-container .fc-daygrid-day {
            background: var(--surface, #fffdf8);
            transition: background-color 120ms ease;
          }
          .kalender-container .fc-dayGridMonth-view .fc-daygrid-day-frame {
            min-height: clamp(4.5rem, 10vw, 7rem);
          }
          .kalender-container .fc-dayGridWeek-view .fc-daygrid-day-frame {
            min-height: 60vh;
          }
          .kalender-container .fc-biweekly-view .fc-daygrid-day-frame {
            min-height: 30vh;
          }
          .kalender-container .fc-daygrid-day:hover {
            background: color-mix(
              in srgb,
              var(--paper, #f2efe6) 55%,
              var(--surface, #fffdf8)
            );
          }
          .kalender-container .fc-daygrid-day-top {
            padding: 2px 3px 0 0;
          }
          .kalender-container .fc-daygrid-day-number {
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
          .kalender-container td.fc-day-today {
            background: var(--fc-today-bg-color) !important;
          }
          .kalender-container td.fc-day-today .fc-daygrid-day-number {
            background: var(--ink, #101310);
            color: var(--signal, #d8ff3e) !important;
          }
          /* Ukevisningen viser datoen i kolonneoverskriften. FullCalendar
             setter igjen en tom dagnummer-celle for «i dag»; skjul den, slik
             at markøren ikke blir en tom svart sirkel. */
          .kalender-container .fc-dayGridWeek-view td.fc-day-today .fc-daygrid-day-number {
            display: none;
          }
          .kalender-container .fc-day-other .fc-daygrid-day-top {
            opacity: 1 !important;
          }
          .kalender-container .fc-day-other .fc-daygrid-day-number {
            color: var(--muted, #62685f) !important;
          }
          .kalender-container .fc-day-other {
            background: color-mix(
              in srgb,
              var(--paper, #f2efe6) 45%,
              var(--surface, #fffdf8)
            );
          }
          .kalender-container .fc-daygrid-week-number {
            background: var(--paper, #f2efe6) !important;
            color: var(--muted, #62685f) !important;
            font-size: 0.68rem;
            font-weight: 800;
            text-align: center;
          }
          .kalender-container .fc-scrollgrid-section-header > td {
            background: var(--ink, #101310);
          }
          .kalender-container .fc-highlight {
            background: color-mix(
              in srgb,
              var(--signal, #d8ff3e) 28%,
              transparent
            ) !important;
          }

          /* Oppdragskort */
          .kalender-container .fc-event {
            margin: 1px 2px;
            padding: 3px 5px;
            border: 1px solid var(--line, #dedcd1) !important;
            border-left: 3px solid var(--event-accent, var(--ink, #101310)) !important;
            border-radius: 7px !important;
            background: var(--surface, #fffdf8) !important;
            color: var(--ink, #101310) !important;
            box-shadow: 0 1px 0 rgb(16 19 16 / 0.06);
            font-weight: 500;
          }
          .kalender-container .fc-event:hover {
            border-color: var(--ink, #101310) !important;
            border-left-color: var(--event-accent, var(--ink, #101310)) !important;
            box-shadow: 2px 2px 0 var(--signal, #d8ff3e);
          }
          .kalender-container .fc-event-main {
            color: var(--ink, #101310) !important;
          }
          .kalender-container .fc-daygrid-event-dot {
            display: none;
          }
          .kalender-editable .fc-event {
            cursor: grab !important;
          }
          .kalender-editable .fc-event:active {
            cursor: grabbing !important;
            opacity: 0.8;
          }
          .kalender-editable .fc-event-locked {
            cursor: default !important;
          }
          .kalender-container .fc-event-content {
            display: flex;
            flex-direction: column;
            gap: 1px;
            white-space: normal;
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
          .kalender-container .fc-daygrid-event {
            white-space: normal;
          }
          .kalender-container .fc-daygrid-day-events {
            margin: 0 2px 2px;
          }

          @media (max-width: 640px) {
            /* Månedsrutenettet har svært smale celler på mobil. Klipp hver
               linje i stedet for at titler og adresser brekkes bokstav for
               bokstav; hele innholdet nås ved å åpne oppdraget. */
            .kalender-container .fc-toolbar {
              margin-bottom: 0.5rem !important;
            }
            .kalender-container .fc-button {
              min-height: 32px;
              padding: 0.3rem 0.55rem;
              font-size: 0.68rem;
            }
            .kalender-container .fc-col-header-cell-cushion {
              padding: 0.4rem 0.15rem !important;
              font-size: 0.58rem;
              letter-spacing: 0.04em;
            }
            .kalender-container .fc-daygrid-day-number {
              min-width: 1.35rem;
              min-height: 1.35rem;
              font-size: 0.75rem;
            }
            .kalender-container .fc-event {
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
            /* På mobil er cellene for smale for FullCalendars lange
               dagnummer («26. oktober»). Datofeltet i kolonneoverskriften
               viser datoen allerede. */
            .kalender-container .fc-biweekly-view .fc-daygrid-day-number {
              display: none;
            }
            .kalender-container .fc-dayGridWeek-view .fc-daygrid-day-frame {
              min-height: 42vh;
            }
            .kalender-container .fc-biweekly-view .fc-daygrid-day-frame {
              min-height: 24vh;
            }
            .kalender-container .fc-dayGridMonth-view .fc-daygrid-day-frame {
              min-height: 4.25rem;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
