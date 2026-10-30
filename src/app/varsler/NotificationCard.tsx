import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import { relativeTimeLabel } from "@/lib/notification-time";
import {
  notificationSourceText,
  notificationTypePresentation,
  type NotificationTone,
} from "@/lib/notification-display";
import Icon, { type IconName } from "@/components/icons";
import { markReadFormAction } from "./actions";

export type NotificationCardItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  sourceLabel: string | null;
  readAt: Date | null;
  createdAt: Date;
};

const TONE_CLASSES: Record<NotificationTone, string> = {
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  purple: "bg-purple-50 text-purple-800 ring-purple-200",
  gray: "bg-gray-100 text-gray-700 ring-gray-200",
};

const NOTIFICATION_ICONS: Record<string, IconName> = {
  ASSIGNMENT: "wrench",
  DATE_CHANGED: "calendar",
  CANCELLED: "alert",
  REPORT_READY: "file",
  BOOKING: "calendar",
  CONTRACT_DUE: "wrench",
  OVERDUE: "clock",
  CONTACT_UPDATE: "user",
};

/**
 * Ett varsel med en vanlig lenke rundt kortet. Lenken går via
 * `/varsler/apne/[id]`, som markerer varselet som lest og videresender til
 * den lagrede, rolle-trygge adressen. Midtklikk og «åpne i ny fane» virker
 * derfor uten JavaScript. «Merk som lest» er en egen form utenfor lenken.
 */
export default async function NotificationCard({
  notification,
}: {
  notification: NotificationCardItem;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const presentation = notificationTypePresentation(notification.type);
  const typeLabel = presentation
    ? t(presentation.labelKey)
    : notification.type;
  const source = notificationSourceText(
    notification.sourceLabel,
    t("p3.notifications.sourceFallback"),
  );
  const unread = !notification.readAt;
  const toneClass = presentation
    ? TONE_CLASSES[presentation.tone]
    : TONE_CLASSES.gray;
  const absolute = formatDateTimeLocalized(notification.createdAt, locale);
  const relative = relativeTimeLabel(notification.createdAt, locale);

  const content = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${toneClass}`}
        >
          <Icon
            name={NOTIFICATION_ICONS[notification.type] ?? "bell"}
            className="h-3.5 w-3.5 shrink-0"
          />
          {typeLabel}
        </span>
        {unread && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-700 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
            {t("p3.notifications.unread")}
          </span>
        )}
        <time
          dateTime={notification.createdAt.toISOString()}
          title={absolute}
          className="ml-auto text-xs font-medium text-gray-600"
        >
          {relative ?? absolute}
        </time>
      </span>

      <span
        className={`mt-2 block text-base font-bold ${
          unread ? "text-gray-900" : "text-gray-700"
        }`}
      >
        {notification.title}
      </span>

      {notification.body && (
        <span className="mt-1 block whitespace-pre-line text-sm text-gray-600">
          {notification.body}
        </span>
      )}

      <span className="mt-3 block text-sm text-gray-600">
        <span className="font-bold text-gray-800">
          {t("p3.notifications.fromLabel")}
        </span>{" "}
        {source}
      </span>

      <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-700 group-hover:underline">
        {t("p3.notifications.open")}
        <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
      </span>
    </>
  );

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow ${
        unread
          ? "border-blue-200 ring-1 ring-blue-100"
          : "border-gray-200 hover:shadow"
      }`}
    >
      <a
        href={`/varsler/apne/${notification.id}`}
        aria-label={t("p3.notifications.openAria", {
          title: notification.title,
        })}
        className="group block cursor-pointer p-4 text-left transition-colors hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset"
      >
        {content}
      </a>

      {unread && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
          <form action={markReadFormAction}>
            <input type="hidden" name="id" value={notification.id} />
            <button
              type="submit"
              aria-label={t("p3.notifications.markReadAria", {
                title: notification.title,
              })}
              className="cursor-pointer rounded-lg px-1 py-1 text-xs font-bold text-gray-700 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {t("p3.notifications.markRead")}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
