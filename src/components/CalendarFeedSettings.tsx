import { getCurrentUser } from "@/lib/session";
import { getCalendarTokenStatus } from "@/server/calendar-feed";
import {
  createCalendarTokenAction,
  revokeCalendarTokenAction,
} from "@/app/innstillinger/calendar-actions";

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
  const feedUrl = status.data.token
    ? `${base.replace(/\/$/, "")}/api/kalender/ical?token=${status.data.token}`
    : null;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">📅 Kalenderabonnement</h2>
      <p className="mt-1 text-sm text-gray-600">
        Abonner på dine oppdrag i Google Calendar, Outlook eller Apple Kalender.
        Lenken er personlig og kan tilbakekalles når som helst.
      </p>

      {feedUrl ? (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-bold text-gray-600">
            iCal-lenke
            <input
              readOnly
              value={feedUrl}
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900"
            />
          </label>
          <form action={revokeCalendarTokenAction}>
            <button
              type="submit"
              className="min-h-11 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
            >
              Tilbakekall lenken
            </button>
          </form>
        </div>
      ) : (
        <form action={createCalendarTokenAction} className="mt-4">
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Lag kalenderlenke
          </button>
        </form>
      )}
    </section>
  );
}
