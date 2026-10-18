"use client";

import dynamic from "next/dynamic";

// Lastes utenfor komponenten: en komponent som lages inne i render mister
// tilstanden sin ved hver rendering.
const FullCalendarView = dynamic(() => import("./FullCalendarView"), {
  ssr: false,
  loading: () => <div className="p-12 text-center text-gray-500 font-medium animate-pulse">Laster kalender...</div>,
});

export default function FullCalendarClient({ 
  events,
  view = 'dayGridWeek',
  weekNumbers = true,
}: { 
  events: any[];
  view?: string;
  weekNumbers?: boolean;
}) {
  return <FullCalendarView events={events} view={view} weekNumbers={weekNumbers} />;
}
