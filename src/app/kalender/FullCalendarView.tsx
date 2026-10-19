"use client";

import { useEffect, useRef } from 'react';
import { Calendar, type EventDropArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import { inclusiveLastDay } from '@/lib/dates';

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
}: { 
  events: EventData[];
  view?: string;
  weekNumbers?: boolean;
}) {
  const calendarEl = useRef<HTMLDivElement>(null);

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
          alert("Kunne ikke lagre den nye datoen.");
        }
      } catch {
        info.revert();
        alert("Kunne ikke lagre den nye datoen.");
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
          buttonText: '2 uker',
          weekNumbers: true,
          weekNumberCalculation: 'ISO',
        },
      },
      events: events,
      height: '80vh',
      locale: 'nb',
      weekNumbers: weekNumbers,
      weekNumberCalculation: 'ISO',
      // Vis tittel og adresse på hver hendelse. Bygges som DOM-noder (ikke
      // HTML-strenger) slik at brukerstyrte titler og adresser aldri tolkes
      // som markup.
      eventContent: function(arg) {
        const address = (arg.event.extendedProps as { address?: string }).address;

        const content = document.createElement('div');
        content.className = 'fc-event-content';

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
        today: 'I dag',
        week: 'Uke',
        month: 'Måned',
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

    return () => {
      calendar.destroy();
    };
  }, [events, view, weekNumbers]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border text-gray-800">
      <div ref={calendarEl} className="kalender-container"></div>
      <style jsx global>{`
        .fc-event { cursor: grab !important; padding: 2px 4px; border-radius: 4px; border: none; background-color: #2563eb; font-weight: 500;}
        .fc-event:active { cursor: grabbing !important; opacity: 0.8;}
        .fc-event-content { display: flex; flex-direction: column; gap: 1px; white-space: normal; }
        .fc-event-title-line { font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
        .fc-event-address { font-size: 0.72em; font-weight: 400; opacity: 0.9; line-height: 1.1; overflow-wrap: anywhere; }
        .fc-daygrid-event { white-space: normal; }
        .fc-day-today { background-color: #f0fdf4 !important; }
        .fc-toolbar-chunk { display: flex; gap: 0.5rem; }
      `}</style>
    </div>
  );
}
