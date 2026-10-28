import { redirect } from "next/navigation";

/** Gammel rute. Beholdes slik at bokmerker og eksterne lenker virker. */
export default function WeekCalendarPage() {
  redirect("/kalender?vis=uke");
}
