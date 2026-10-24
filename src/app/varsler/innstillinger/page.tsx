import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import NotificationPreferences from "./NotificationPreferences";

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Varselinnstillinger</h1>
          <p className="text-sm text-gray-600">
            Velg hvilke hendelser du vil varsles om i appen og på e-post.
          </p>
        </div>
        <Link
          href="/varsler"
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          Til varsler
        </Link>
      </div>
      <NotificationPreferences />
    </div>
  );
}
