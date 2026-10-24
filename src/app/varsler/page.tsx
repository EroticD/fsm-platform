import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { listNotifications } from "@/server/notifications";
import { markAllReadAction, markReadAction } from "./actions";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; p?: string }>;
}) {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const params = await searchParams;
  const page = Math.max(1, Number(params.p) || 1);
  const unreadOnly = params.u === "1";

  const result = await listNotifications(user, { page, unreadOnly });
  if (!result.ok) redirect("/");

  const data = result.data as {
    items: NotificationItem[];
    total: number;
    unread: number;
    page: number;
    totalPages: number;
  };

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("p3.notifications.title")}</h1>
          <p className="text-sm text-gray-600">
            {t("p3.notifications.unreadOf", { unread: data.unread, total: data.total })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/varsler/innstillinger"
            className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            {t("p3.notifications.settings")}
          </Link>
          <Link
            href={unreadOnly ? "/varsler" : "/varsler?u=1"}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            {unreadOnly ? t("p3.notifications.all") : t("p3.notifications.unreadOnly")}
          </Link>
          {data.unread > 0 && (
            <form action={markAllReadAction}>
              <button
                type="submit"
                className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                {t("p3.notifications.markAllRead")}
              </button>
            </form>
          )}
        </div>
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-3xl" aria-hidden="true">🔔</p>
          <p className="mt-2 font-bold text-gray-900">{t("p3.notifications.emptyTitle")}</p>
          <p className="text-sm text-gray-600">{t("p3.notifications.emptyDescription")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                notification.readAt
                  ? "border-gray-100"
                  : "border-blue-200 ring-1 ring-blue-100"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">{notification.title}</p>
                  {notification.body && (
                    <p className="mt-1 whitespace-pre-line text-sm text-gray-600">
                      {notification.body}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-gray-400">
                    {formatDateTime(notification.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {notification.href && (
                    <Link
                      href={notification.href}
                      className="text-xs font-bold text-blue-700 hover:underline"
                    >
                      {t("p3.notifications.open")}
                    </Link>
                  )}
                  {!notification.readAt && (
                    <form action={markReadAction}>
                      <input type="hidden" name="id" value={notification.id} />
                      <button
                        type="submit"
                        className="text-xs font-bold text-gray-500 hover:text-gray-800"
                      >
                        {t("p3.notifications.markRead")}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Link
            href={`/varsler?${new URLSearchParams({
              ...(unreadOnly ? { u: "1" } : {}),
              p: String(Math.max(1, data.page - 1)),
            }).toString()}`}
            className="rounded-lg border px-3 py-2 font-bold text-gray-700 hover:bg-gray-50"
          >
            {t("p3.notifications.previous")}
          </Link>
          <span className="text-gray-500">
            {t("p3.notifications.pageOf", { page: data.page, pages: data.totalPages })}
          </span>
          <Link
            href={`/varsler?${new URLSearchParams({
              ...(unreadOnly ? { u: "1" } : {}),
              p: String(Math.min(data.totalPages, data.page + 1)),
            }).toString()}`}
            className="rounded-lg border px-3 py-2 font-bold text-gray-700 hover:bg-gray-50"
          >
            {t("p3.notifications.next")}
          </Link>
        </div>
      )}
    </div>
  );
}
