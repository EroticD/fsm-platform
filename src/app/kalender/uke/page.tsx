import CalendarViewPage from "@/app/kalender/CalendarViewPage";

export default function WeekCalendarPage() {
  return (
    <CalendarViewPage
      view="dayGridWeek"
      active="week"
      titleKey="calendar.week.title"
      subtitleKey="calendar.week.subtitle"
    />
  );
}
