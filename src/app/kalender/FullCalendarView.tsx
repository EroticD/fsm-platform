"use client";

import { useEffect, useRef } from 'react';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';

type EventData = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
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
      buttonText: {
        today: 'I dag',
        week: 'Uke',
        month: 'Måned',
      },
      editable: true,
      droppable: true,
      eventDurationEditable: false,
      eventClick: function(info) {
        window.location.href = `/oppdrag/${info.event.id}`;
      },
      eventDrop: async function(info) {
        if (info.event.start) {
          const newDate = info.event.startStr;
          document.body.style.cursor = 'wait';
          try {
            const response = await fetch(`/api/oppdrag/${info.event.id}/date`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newDate }),
            });
            if (!response.ok) {
              info.revert();
              alert("Kunne ikke lagre den nye datoen.");
            }
          } catch (error) {
            info.revert();
            alert("Kunne ikke lagre den nye datoen.");
          } finally {
            document.body.style.cursor = 'default';
          }
        }
      }
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
        .fc-day-today { background-color: #f0fdf4 !important; }
        .fc-toolbar-chunk { display: flex; gap: 0.5rem; }
      `}</style>
    </div>
  );
}
