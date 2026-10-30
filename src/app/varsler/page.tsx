import Link from "next/link";
import Icon from "@/components/icons";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { parsePage } from "@/lib/pagination";
import { listNotifications } from "@/server/notifications";
import NotificationCard from "./NotificationCard";
import { markAllReadFormAction } from "./actions";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  sourceLabel: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.varsler") };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; p?: string }>;
}) {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const params = await searchParams;
  const requestedPage = parsePage(params.p);
  const unreadOnly = params.u === "1";

  const result = await listNotifications(user, {
    page: requestedPage,
    unreadOnly,
  });
  if (!result.ok) redirect("/");

  const data = result.data as {
    items: NotificationItem[];
    total: number;
    unread: number;
    page: number;
    totalPages: number;
  };

  // Behold filteret når man blar. Første side har ingen `p`-parameter.
  const pageLink = (target: number) => {
    const query = new URLSearchParams();
    if (unreadOnly) query.set("u", "1");
    if (target > 1) query.set("p", String(target));
    const qs = query.toString();
    return `/varsler${qs ? `?${qs}` : ""}`;
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
            <form action={markAllReadFormAction}>
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
          <p className="flex justify-center text-gray-400" aria-hidden="true">
            <Icon name="bell" className="h-8 w-8" />
          </p>
          <p className="mt-2 font-bold text-gray-900">{t("p3.notifications.emptyTitle")}</p>
          <p className="text-sm text-gray-600">{t("p3.notifications.emptyDescription")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
            />
          ))}
        </ul>
      )}

      {data.totalPages > 1 && (
        <nav
          aria-label={t("p3.notifications.paginationAria")}
          className="flex items-center justify-between gap-3 text-sm"
        >
          {data.page > 1 ? (
            <Link
              href={pageLink(data.page - 1)}
              aria-label={t("p3.notifications.previousAria")}
              className="rounded-lg border px-3 py-2 font-bold text-gray-700 hover:bg-gray-50"
            >
              {t("p3.notifications.previous")}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="cursor-not-allowed rounded-lg border border-gray-200 px-3 py-2 font-bold text-gray-600"
            >
              {t("p3.notifications.previous")}
            </span>
          )}
          <span className="text-gray-600">
            {t("p3.notifications.pageOf", { page: data.page, pages: data.totalPages })}
          </span>
          {data.page < data.totalPages ? (
            <Link
              href={pageLink(data.page + 1)}
              aria-label={t("p3.notifications.nextAria")}
              className="rounded-lg border px-3 py-2 font-bold text-gray-700 hover:bg-gray-50"
            >
              {t("p3.notifications.next")}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="cursor-not-allowed rounded-lg border border-gray-200 px-3 py-2 font-bold text-gray-600"
            >
              {t("p3.notifications.next")}
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
