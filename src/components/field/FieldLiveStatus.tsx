"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/icons";

/**
 * Levende vaktstatus for feltportalen. Klokka tikker hvert minutt uten
 * polling – oppdragene oppdateres fortsatt av RealtimeRefresh.
 */
export default function FieldLiveStatus({
  locale,
  onlineLabel,
  offlineLabel,
  className = "",
}: {
  locale: string;
  onlineLabel: string;
  offlineLabel: string;
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setNow(new Date());
    const updateConnection = () => setOnline(navigator.onLine);

    update();
    updateConnection();

    const interval = window.setInterval(update, 60_000);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  const clock = now
    ? new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(now)
    : "--:--";

  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#2a3328] bg-white/[0.05] px-2.5 text-[11px] font-bold text-paper/70 ${className}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          online ? "bg-signal" : "bg-risk"
        }`}
      />
      <span aria-live="polite">{online ? onlineLabel : offlineLabel}</span>
      <span aria-hidden className="text-paper/30">
        ·
      </span>
      <Icon name="clock" className="h-3.5 w-3.5 text-paper/55" />
      <time dateTime={now?.toISOString()} className="tabular-nums text-paper/85">
        {clock}
      </time>
    </span>
  );
}
