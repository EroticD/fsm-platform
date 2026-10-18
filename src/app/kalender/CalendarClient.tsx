"use client";

import { useEffect, useRef } from 'react';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

type EventData = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
};

export default function CalendarClient({ 
  events,
  updateEventDate
}: { 
  events: EventData[];
  updateEventDate: (id: string, newDate: string) => Promise<void>;
}) {
  const calendarEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!calendarEl.current) return;

    const calendar = new Calendar(calendarEl.current, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek' // Fjernet dags-visning siden vi fokuserer på heldagsoppdrag
      },
      events: events,
      height: '80vh', // Gjør kalenderen litt høyere for bedre oversikt
      locale: 'nb',
      buttonText: {
        today: 'I dag',
        month: 'Måned',
        week: 'Uke',
      },
      
      // MAGIEN FOR DRA-OG-SLIPP LIGGER HER:
      editable: true,       // Tillater å flytte hendelser
      droppable: true,      // Tillater å slippe dem på nye datoer
      eventDurationEditable: false, // Forhindrer at vi ved et uhell endrer lengden på jobben

      // NYTT: Gjør at man kan klikke på oppdraget
      eventClick: function(info) {
        window.location.href = `/oppdrag/${info.event.id}`;
      },

      // Denne funksjonen kjøres idet du slipper musepekeren
      eventDrop: async function(info) {
        if (info.event.start) {
          // info.event.startStr gir oss 'YYYY-MM-DD'
          const newDate = info.event.startStr;
          
          // Sier ifra til brukeren mens vi lagrer (valgfritt, men god UX)
          document.body.style.cursor = 'wait';
          
          try {
            await updateEventDate(info.event.id, newDate);
          } catch (error) {
            // Hvis noe går galt på serveren, spretter oppdraget tilbake til der det var
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
  }, [events, updateEventDate]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border text-gray-800">
      <div ref={calendarEl} className="kalender-container"></div>
      <style jsx global>{`
        /* Litt ekstra styling for å gjøre kalenderen penere å se på */
        .fc-event { cursor: grab !important; padding: 2px 4px; border-radius: 4px; border: none; background-color: #2563eb; font-weight: 500;}
        .fc-event:active { cursor: grabbing !important; opacity: 0.8;}
        .fc-day-today { background-color: #f0fdf4 !important; }
      `}</style>
    </div>
  );
}
