"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PingState = "idle" | "sharing" | "denied" | "unavailable" | "error";

export type LocationPingLabels = {
  start: string;
  stop: string;
  sharing: string;
  denied: string;
  unavailable: string;
  error: string;
};

/** Minste avstand mellom to ping fra samme enhet. */
const PING_INTERVAL_MS = 20_000;

/**
 * Eksplisitt posisjonsdeling for en montør som er EN_ROUTE.
 *
 * Komponenten køer aldri posisjoner. Hvert ping er et ferskt `fetch` med
 * `cache: "no-store"`; er nettverket borte, hoppes punktet over. Da kan ikke
 * en gammel posisjon spilles av senere og gi kunden en falsk ETA.
 */
export default function LocationPingToggle({
  visitId,
  labels,
}: {
  visitId: string;
  labels: LocationPingLabels;
}) {
  const [state, setState] = useState<PingState>("idle");
  const watchRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);

  const stop = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
    lastSentRef.current = 0;
    setState("idle");
  }, []);

  const clearWatch = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  function start() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }

    setState("sharing");
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSentRef.current < PING_INTERVAL_MS) return;

        // Uten nett hoppes punktet over; det legges ikke i noen offline-kø.
        if (!navigator.onLine) return;
        lastSentRef.current = now;

        void fetch("/api/tracking/ping", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            visitId,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        })
          .then((response) => {
            if (!response.ok) {
              setState(
                response.status === 401 || response.status === 403
                  ? "denied"
                  : "error",
              );
              clearWatch();
            }
          })
          .catch(() => {
            // Posisjonen er fersk og verdiløs senere; vis feil, ikke replay.
            setState("error");
          });
      },
      (error) => {
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "error");
        clearWatch();
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
  }

  const message =
    state === "denied"
      ? labels.denied
      : state === "unavailable"
        ? labels.unavailable
        : state === "error"
          ? labels.error
          : state === "sharing"
            ? labels.sharing
            : null;

  return (
    <div className="rounded-xl border border-[#2a3328] bg-field/65 px-3 py-2">
      <button
        type="button"
        aria-pressed={state === "sharing"}
        onClick={state === "sharing" ? stop : start}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-signal/40 bg-field px-3 text-sm font-black text-signal transition hover:bg-signal/10"
      >
        {state === "sharing" ? labels.stop : labels.start}
      </button>
      {message && (
        <p aria-live="polite" className="mt-1 text-xs font-medium text-paper/75">
          {message}
        </p>
      )}
    </div>
  );
}
