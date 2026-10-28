"use client";

import { useEffect } from "react";
import { clearOfflineSessionCaches } from "@/lib/offline/cache";

/**
 * Minste tid mellom to øktkontroller. Kontrollen kjøres ved oppstart, når fanen
 * blir synlig igjen og når nettet kommer tilbake, men aldri oftere enn dette.
 */
const SESSION_CHECK_THROTTLE_MS = 60_000;

/** NextAuth returnerer `{}` når det ikke finnes noen gyldig økt. */
function hasActiveSession(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== "object") return false;
  const id = (user as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0;
}

/**
 * Skjult vakt som oppdager at økten er borte mens appen står åpen.
 *
 * Uten denne ville en utløpt økt fortsatt kunne vise offline-cachede
 * oppdragssider. Komponenten har ingen UI og monteres bare for interne roller
 * (se app/layout.tsx). Kladder og outbox røres ikke – bare side-cachene og
 * offline-markøren ryddes.
 */
export default function OfflineSessionGuard() {
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let lastCheck = 0;

    const verify = async () => {
      if (disposed || checking) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      const now = Date.now();
      if (lastCheck && now - lastCheck < SESSION_CHECK_THROTTLE_MS) return;
      lastCheck = now;
      checking = true;

      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });

        if (response.status === 401 || response.status === 403) {
          await clearOfflineSessionCaches();
          return;
        }
        if (!response.ok) return;

        const session: unknown = await response.json();
        if (!hasActiveSession(session)) {
          await clearOfflineSessionCaches();
        }
      } catch {
        // Nettverksfeil eller avbrutt forespørsel beviser ikke at økten er borte.
      } finally {
        checking = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void verify();
    };
    const onOnline = () => void verify();

    void verify();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
