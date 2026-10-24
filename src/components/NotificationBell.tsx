"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Bjelle i headeren med antall uleste varsler. Poller hvert minutt. */
export default function NotificationBell() {
  const t = useTranslations("common");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/notifications/unread");
        if (!response.ok) return;
        const data = await response.json();
        if (active) setCount(Number(data.count) || 0);
      } catch {
        // Nettverksfeil skal ikke påvirke resten av headeren.
      }
    };

    void load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/varsler"
      aria-label={count > 0 ? t("p3.bell.unread", { count }) : t("p3.bell.label")}
      className="relative flex h-11 w-11 items-center justify-center rounded-xl text-xl text-gray-600 hover:bg-gray-100"
    >
      🔔
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-5 text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
