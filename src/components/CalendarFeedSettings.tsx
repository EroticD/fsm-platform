import { getCurrentUser } from "@/lib/session";
import { getCalendarTokenStatus } from "@/server/calendar-feed";
import CalendarFeedSettingsForm from "@/components/CalendarFeedSettingsForm";

/** Lar brukeren abonnere på egne oppdrag i Google Calendar/Outlook. */
export default async function CalendarFeedSettings() {
  const user = await getCurrentUser();
  if (!user) return null;

  const status = await getCalendarTokenStatus(user);
  if (!status.ok) return null;

  const base =
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  // Bare statusen sendes videre – selve tokenet finnes ikke i klartekst.
  return (
    <CalendarFeedSettingsForm
      initialActive={status.data.active}
      baseUrl={base}
    />
  );
}
