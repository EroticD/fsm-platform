import { getCurrentUser } from "@/lib/session";
import {
  getNotificationPreferences,
  NOTIFICATION_TYPES,
} from "@/server/notifications";
import { saveNotificationPreferencesAction } from "./actions";

const LABELS: Record<string, string> = {
  ASSIGNMENT: "Du blir tildelt et oppdrag",
  DATE_CHANGED: "Oppdraget flyttes",
  CANCELLED: "Oppdraget kanselleres",
  REPORT_READY: "Rapport er klar",
  BOOKING: "Ny booking fra kundeportalen",
  CONTRACT_DUE: "Serviceavtale forfaller",
  OVERDUE: "Oppdrag er forfalt",
};

export default async function NotificationPreferences() {
  const user = await getCurrentUser();
  if (!user) return null;

  const result = await getNotificationPreferences(user);
  if (!result.ok) return null;
  const preferences = new Map(
    result.data.map((preference) => [preference.type, preference]),
  );

  return (
    <form action={saveNotificationPreferencesAction} className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-bold">Hendelse</th>
              <th className="px-4 py-3 font-bold">I appen</th>
              <th className="px-4 py-3 font-bold">E-post</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {NOTIFICATION_TYPES.map((type) => {
              const preference = preferences.get(type);
              return (
                <tr key={type}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {LABELS[type] ?? type}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name={`inApp_${type}`}
                      defaultChecked={preference?.inApp ?? true}
                      aria-label={`${LABELS[type] ?? type} i appen`}
                      className="h-5 w-5"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name={`email_${type}`}
                      defaultChecked={preference?.email ?? true}
                      aria-label={`${LABELS[type] ?? type} på e-post`}
                      className="h-5 w-5"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="submit"
        className="min-h-11 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
      >
        Lagre varselinnstillinger
      </button>
    </form>
  );
}
