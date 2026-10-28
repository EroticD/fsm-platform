import CalendarViewPage from "@/app/kalender/CalendarViewPage";

export default function MonthCalendarPage() {
  return (
    <CalendarViewPage
      view="dayGridMonth"
      active="month"
      titleKey="calendar.month.title"
      subtitleKey="calendar.month.subtitle"
    />
  );
}
