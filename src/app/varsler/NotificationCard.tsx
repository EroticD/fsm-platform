import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import { relativeTimeLabel } from "@/lib/notification-time";
import {
  notificationSourceText,
  notificationTypePresentation,
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

const NOTIFICATION_ICONS: Record<string, IconName> = {
  ASSIGNMENT: "wrench",
  DATE_CHANGED: "calendar",
  CANCELLED: "alert",
  REPORT_READY: "file",
  BOOKING: "calendar",
  CONTRACT_DUE: "wrench",
  OVERDUE: "clock",
  CONTACT_UPDATE: "user",
  WARRANTY: "shield",
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
  const absolute = formatDateTimeLocalized(notification.createdAt, locale);
  const relative = relativeTimeLabel(notification.createdAt, locale);

  const content = (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
          <Icon
            name={NOTIFICATION_ICONS[notification.type] ?? "bell"}
            className="h-3.5 w-3.5 shrink-0"
          />
          {typeLabel}
        </span>
        {unread && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ink,#101310)] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[var(--paper,#f2efe6)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal,#d8ff3e)]" aria-hidden="true" />
            {t("p3.notifications.unread")}
          </span>
        )}
        <time
          dateTime={notification.createdAt.toISOString()}
          title={absolute}
          className="ml-auto text-xs font-medium text-[var(--muted,#62685f)]"
        >
          {relative ?? absolute}
        </time>
      </span>

      <span
        className={`mt-2 block text-base font-bold ${
          unread
            ? "text-[var(--ink,#101310)]"
            : "text-[#3f453d]"
        }`}
      >
        {notification.title}
      </span>

      {notification.body && (
        <span className="mt-1 block whitespace-pre-line text-sm text-[var(--muted,#62685f)]">
          {notification.body}
        </span>
      )}

      <span className="mt-3 block text-sm text-[var(--muted,#62685f)]">
        <span className="font-bold text-[var(--ink,#101310)]">
          {t("p3.notifications.fromLabel")}
        </span>{" "}
        {source}
      </span>

      <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[var(--ink,#101310)] group-hover:underline">
        {t("p3.notifications.open")}
        <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
      </span>
    </>
  );

  return (
    <li className="office-card relative overflow-hidden">
      {unread && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-[var(--signal,#d8ff3e)]"
        />
      )}
      <a
        href={`/varsler/apne/${notification.id}`}
        aria-label={t("p3.notifications.openAria", {
          title: notification.title,
        })}
        className="group block cursor-pointer p-4 pl-5 text-left transition-colors hover:bg-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ink,#101310)]"
      >
        {content}
      </a>

      {unread && (
        <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-4 py-2 pl-5">
          <form action={markReadFormAction}>
            <input type="hidden" name="id" value={notification.id} />
            <button
              type="submit"
              aria-label={t("p3.notifications.markReadAria", {
                title: notification.title,
              })}
              className="cursor-pointer rounded-lg px-1 py-1 text-xs font-bold text-[var(--ink,#101310)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
            >
              {t("p3.notifications.markRead")}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
