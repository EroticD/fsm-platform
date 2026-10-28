import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
  isSafeNotificationHref,
  notificationHrefForUser,
} from "@/lib/notification-links";
import { listRecentNotifications } from "@/server/notifications";

export const dynamic = "force-dynamic";

type RecentNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  sourceLabel: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * De siste varslene til bjelle-popoveren. Ruten er en tynn wrapper rundt
 * tjenesten, som selv begrenser spørringen til innlogget bruker.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isActive) {
    return NextResponse.json({ items: [], count: 0 }, { status: 401 });
  }

  const result = await listRecentNotifications(user, 5);
  if (!result.ok) {
    return NextResponse.json({ items: [], count: 0 }, { status: 403 });
  }

  const data = result.data as { items: RecentNotification[]; unread: number };
  const items = data.items.map((notification) => {
    const target = notificationHrefForUser(
      user.role,
      notification.type,
      notification.href,
    );
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body ? notification.body.slice(0, 180) : null,
      sourceLabel: notification.sourceLabel,
      hasTarget: isSafeNotificationHref(target),
      readAt: notification.readAt ? notification.readAt.toISOString() : null,
      createdAt: notification.createdAt.toISOString(),
    };
  });

  return NextResponse.json(
    { items, count: data.unread },
    { headers: { "Cache-Control": "no-store" } },
  );
}
