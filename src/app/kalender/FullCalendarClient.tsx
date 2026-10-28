"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { CalendarEventData } from "@/lib/calendar-events";

function CalendarLoading() {
  const t = useTranslations("common");
  return (
    <div className="p-12 text-center text-gray-500 font-medium animate-pulse">
      {t("calendar.common.loading")}
    </div>
  );
}

// Lastes utenfor komponenten: en komponent som lages inne i render mister
// tilstanden sin ved hver rendering.
const FullCalendarView = dynamic(() => import("./FullCalendarView"), {
  ssr: false,
  loading: () => <CalendarLoading />,
});

export default function FullCalendarClient({ 
  events,
  view = 'dayGridWeek',
  weekNumbers = true,
  canEdit = false,
  canOpenEditor = canEdit,
}: { 
  events: CalendarEventData[];
  view?: string;
  weekNumbers?: boolean;
  canEdit?: boolean;
  canOpenEditor?: boolean;
}) {
  return (
    <FullCalendarView
      events={events}
      view={view}
      weekNumbers={weekNumbers}
      canEdit={canEdit}
      canOpenEditor={canOpenEditor}
    />
  );
}
