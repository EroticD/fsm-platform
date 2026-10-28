"use client";

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar, type EventDropArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import { formatDateLocalized, inclusiveLastDay } from '@/lib/dates';
import { readableTextColor } from '@/lib/colors';
import { useToast } from '@/components/ToastProvider';

type EventData = {
  id: string;
  title: string;
  start: string;
  /** Eksklusiv sluttdato for heldagshendelser. */
  end?: string;
  allDay: boolean;
  extendedProps?: { address?: string };
};

export default function FullCalendarView({ 
  events,
  view = 'dayGridWeek',
  weekNumbers = true,
  canEdit = false,
}: { 
  events: EventData[];
  view?: string;
  weekNumbers?: boolean;
  canEdit?: boolean;
}) {
  const calendarEl = useRef<HTMLDivElement>(null);
  const t = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();

  useEffect(() => {
    if (!calendarEl.current) return;

    // Lagrer ny start- og sluttdato etter drag eller resize. FullCalendar
    // bruker eksklusiv sluttdato, mens databasen lagrer siste inkluderte dag.
    async function saveDates(info: EventDropArg | EventResizeDoneArg) {
      if (!info.event.start) return;

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
          toast(t("calendar.client.saveError"), "error");
        }
      } catch {
        info.revert();
        toast(t("calendar.client.saveError"), "error");
      } finally {
        document.body.style.cursor = 'default';
      }
    }

    const calendar = new Calendar(calendarEl.current, {
      plugins: [dayGridPlugin, interactionPlugin],
      initialView: view,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: view === 'biweekly' ? 'biweekly' : 'dayGridWeek,dayGridMonth',
      },
      views: {
        biweekly: {
          type: 'dayGrid',
          duration: { weeks: 2 },
          buttonText: t("calendar.common.biweekly"),
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
        },
      },
      events: events,
      height: '80vh',
      locale: locale,
      weekNumbers: weekNumbers,
      weekNumberCalculation: 'ISO',
      // Vis tittel og adresse på hver hendelse. Bygges som DOM-noder (ikke
      // HTML-strenger) slik at brukerstyrte titler og adresser aldri tolkes
      // som markup.
      eventContent: function(arg) {
        const address = (arg.event.extendedProps as { address?: string }).address;

        const content = document.createElement('div');
        content.className = 'fc-event-content';
        content.style.color = readableTextColor(
          arg.event.backgroundColor || '#2563eb',
        );

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
        today: t("calendar.client.today"),
        week: t("calendar.client.week"),
        month: t("calendar.client.month"),
      },
      buttonHints: {
        prev: t("calendar.a11y.previous"),
        next: t("calendar.a11y.next"),
        today: t("calendar.a11y.today"),
      },
      editable: true,
      droppable: true,
      eventDurationEditable: true,
      eventClick: function(info) {
        window.location.href = `/oppdrag/${info.event.id}`;
      },
      eventDrop: saveDates,
      eventResize: saveDates,
    });

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
    labelButton('.fc-prev-button', t("calendar.a11y.previous"));
    labelButton('.fc-next-button', t("calendar.a11y.next"));
    labelButton('.fc-today-button', t("calendar.a11y.today"));
    toolbar?.querySelectorAll('.fc-icon').forEach((icon) => {
      icon.setAttribute('aria-hidden', 'true');
    });

    return () => {
      calendar.destroy();
    };
  }, [events, view, weekNumbers, t, locale, toast]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border text-gray-800">
      <div ref={calendarEl} className="kalender-container"></div>
      <details className="mt-4 rounded-xl border border-gray-300 bg-gray-50 p-3 text-sm">
        <summary className="cursor-pointer font-bold text-gray-900">
          {t("calendar.a11y.keyboardTitle")}
        </summary>
        <p className="mt-2 text-xs text-gray-700">
          {t("calendar.a11y.keyboardAlternative")}
        </p>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {events.slice(0, 100).map((event) => (
            <li key={event.id}>
              <Link
                href={
                  canEdit
                    ? `/oppdrag/${event.id}/rediger`
                    : `/oppdrag/${event.id}`
                }
                className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 py-1.5 font-medium text-blue-800 hover:bg-blue-50"
              >
                <span className="truncate">{event.title}</span>
                <span className="shrink-0 text-xs text-gray-700">
                  {canEdit
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
        .fc-event { cursor: grab !important; padding: 2px 4px; border-radius: 4px; border: none; background-color: #2563eb; font-weight: 500;}
        .fc-event:active { cursor: grabbing !important; opacity: 0.8;}
        .fc-event-content { display: flex; flex-direction: column; gap: 1px; white-space: normal; }
        .fc-event-title-line { font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
        .fc-event-address { font-size: 0.72em; font-weight: 400; opacity: 0.9; line-height: 1.1; overflow-wrap: anywhere; }
        .fc-daygrid-event { white-space: normal; }
        .fc-day-today { background-color: #f0fdf4 !important; }
        .fc-toolbar-chunk { display: flex; gap: 0.5rem; }
        .fc .fc-daygrid-week-number { color: #374151 !important; background-color: #f3f4f6 !important; font-weight: 700; }
        .fc .fc-daygrid-day-number { color: #111827 !important; }
        .fc .fc-col-header-cell-cushion { color: #374151 !important; }
        .fc .fc-day-other .fc-daygrid-day-top { opacity: 1 !important; }
        .fc .fc-day-other .fc-daygrid-day-number { color: #6b7280 !important; }
      `}</style>
    </div>
  );
}
