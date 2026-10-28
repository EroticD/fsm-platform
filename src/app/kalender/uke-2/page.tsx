import CalendarViewPage from "@/app/kalender/CalendarViewPage";

export default function BiweeklyCalendarPage() {
  return (
    <CalendarViewPage
      view="biweekly"
      active="biweekly"
      titleKey="calendar.biweekly.title"
      subtitleKey="calendar.biweekly.subtitle"
    />
  );
}
