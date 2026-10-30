"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { CalendarEventData } from "@/lib/calendar-events";

function CalendarLoading() {
  const t = useTranslations("common");
  return (
    <div className="office-card p-10 text-center text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
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
  initialDate,
  visParam,
  technician,
  status,
  unassigned,
  weekNumbers = true,
  canEdit = false,
  canOpenEditor = canEdit,
}: { 
  events: CalendarEventData[];
  view?: string;
  initialDate: string;
  visParam: string;
  technician?: string;
  status?: string;
  unassigned?: boolean;
  weekNumbers?: boolean;
  canEdit?: boolean;
  canOpenEditor?: boolean;
}) {
  return (
    <FullCalendarView
      events={events}
      view={view}
      initialDate={initialDate}
      visParam={visParam}
      technician={technician}
      status={status}
      unassigned={unassigned}
      weekNumbers={weekNumbers}
      canEdit={canEdit}
      canOpenEditor={canOpenEditor}
    />
  );
}
