"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

function CalendarLoading() {
  const t = useTranslations("common");
  return (
    <div className="p-12 text-center text-gray-500 font-medium animate-pulse">
      {t("calendar.common.loadingInteractive")}
    </div>
  );
}

const CalendarClient = dynamic(() => import("./CalendarClient"), { 
  ssr: false,
  loading: () => <CalendarLoading />,
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
