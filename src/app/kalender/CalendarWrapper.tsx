"use client";

import dynamic from "next/dynamic";

const CalendarClient = dynamic(() => import("./CalendarClient"), { 
  ssr: false,
  loading: () => <div className="p-12 text-center text-gray-500 font-medium animate-pulse">Laster interaktiv kalender...</div>
});

type EventData = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
};

export default function CalendarWrapper({ 
  events, 
  updateEventDate 
}: { 
  events: EventData[];
  updateEventDate: (id: string, newDate: string) => Promise<void>;
}) {
  return <CalendarClient events={events} updateEventDate={updateEventDate} />;
}
