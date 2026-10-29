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
import { readableTextColor } from '@/lib/colors';
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
} from '@/lib/work-order-status-colors';
import WorkOrderStatusLegend from '@/components/WorkOrderStatusLegend';
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

const STATUS_ICONS: Record<string, string> = {
  OPEN: '✨',
  PENDING: '⏳',
  PLANNED: '📅',
  WAITING: '⏸️',
  IN_PROGRESS: '🔄',
  COMPLETED: '✅',
  CANCELLED: '❌',
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? '•';
}

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
        center: 'title',
        // Visningsbyttet ligger i fanene over kalenderen, som oppdaterer
        // URL-en. FullCalendar skal ikke ha egne knapper som desynker den.
        right: '',
      },
      views: {
        biweekly: {
          type: 'dayGrid',
          duration: { weeks: 2 },
          buttonText: tRef.current("calendar.common.biweekly"),
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
        },
      },
      events: eventsRef.current,
      height: '80vh',
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
      // Vis tittel og adresse på hver hendelse. Bygges som DOM-noder (ikke
      // HTML-strenger) slik at brukerstyrte titler og adresser aldri tolkes
      // som markup. Status vises som tekst/ikon i tillegg til fargen, slik at
      // kalenderen ikke er avhengig av farge alene.
      eventContent: function(arg) {
        const extendedProps = arg.event.extendedProps as {
          address?: string;
          status?: string;
        };
        const address = extendedProps.address;
        const eventStatus = extendedProps.status;

        const content = document.createElement('div');
        content.className = 'fc-event-content';
        content.style.color = readableTextColor(
          arg.event.backgroundColor || '#2563eb',
        );

        if (eventStatus) {
          const statusLine = document.createElement('div');
          statusLine.className = 'fc-event-status-line';

          const icon = document.createElement('span');
          icon.className = 'fc-event-status-icon';
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = statusIcon(eventStatus);
          statusLine.appendChild(icon);

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
      <WorkOrderStatusLegend
        title={t("calendar.legend.visibleTitle")}
        items={legendItems}
      />
      <div className="bg-white p-6 rounded-xl shadow-sm border text-gray-800">
        <div
          ref={calendarEl}
          className={`kalender-container${canEdit ? " kalender-editable" : ""}`}
        ></div>
        <details className="mt-4 rounded-xl border border-gray-300 bg-gray-50 p-3 text-sm">
          <summary className="cursor-pointer font-bold text-gray-900">
            {t("calendar.a11y.keyboardTitle")}
          </summary>
          <p className="mt-2 text-xs text-gray-700">
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
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 py-1.5 font-medium text-blue-800 hover:bg-blue-50"
                >
                  <span className="truncate">{event.title}</span>
                  <span className="shrink-0 text-xs text-gray-700">
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
          .fc-event { padding: 2px 4px; border-radius: 4px; border: none; background-color: #2563eb; font-weight: 500;}
          .kalender-editable .fc-event { cursor: grab !important; }
          .kalender-editable .fc-event:active { cursor: grabbing !important; opacity: 0.8;}
          .kalender-editable .fc-event-locked { cursor: default !important; }
          .fc-event-content { display: flex; flex-direction: column; gap: 2px; white-space: normal; }
          .fc-event-status-line { display: flex; align-items: center; gap: 3px; font-size: 0.68em; font-weight: 700; line-height: 1.1; }
          .fc-event-status-icon { font-size: 1em; }
          .fc-event-title-line { font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
          .fc-event-address { font-size: 0.72em; font-weight: 400; opacity: 1; line-height: 1.1; overflow-wrap: anywhere; }
          .fc-daygrid-event { white-space: normal; }
          @media (max-width: 640px) {
            /* Månedsrutenettet har svært smale celler på mobil. Klipp hver
               linje i stedet for at titler og adresser brekkes bokstav for
               bokstav; hele innholdet nås ved å åpne oppdraget. */
            .fc-event-title-line,
            .fc-event-address,
            .fc-event-status-line {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .fc-event-status-line { font-size: 0.62em; }
          }
          .fc-day-today { background-color: #f0fdf4 !important; }
          .fc-toolbar-chunk { display: flex; gap: 0.5rem; }
          .fc .fc-daygrid-week-number { color: #374151 !important; background-color: #f3f4f6 !important; font-weight: 700; }
          .fc .fc-daygrid-day-number { color: #111827 !important; }
          .fc .fc-col-header-cell-cushion { color: #374151 !important; }
          .fc .fc-day-other .fc-daygrid-day-top { opacity: 1 !important; }
          .fc .fc-day-other .fc-daygrid-day-number { color: #6b7280 !important; }
        `}</style>
      </div>
    </div>
  );
}
