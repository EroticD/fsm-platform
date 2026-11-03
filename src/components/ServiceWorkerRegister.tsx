"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

/**
 * Registrerer service workeren og gir beskjed når en ny versjon er klar.
 *
 * Oppdateringen lastes ikke inn midt i et skjema. Montøren trykker selv
 * «Oppdater», og siden lastes på nytt først når den nye workeren har tatt over.
 */
export default function ServiceWorkerRegister() {
  const t = useTranslations("common");
  const [waiting, setWaiting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const showWaiting = (worker: ServiceWorker | null) => {
      if (cancelled || !worker) return;
      waitingRef.current = worker;
      setWaiting(true);
      setDismissed(false);
    };

    const watchInstalling = (registration: ServiceWorkerRegistration) => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showWaiting(registration.waiting ?? worker);
        }
      });
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          if (cancelled) return;
          registrationRef.current = registration;
          if (registration.waiting && navigator.serviceWorker.controller) {
            showWaiting(registration.waiting);
          }
          registration.addEventListener("updatefound", () => {
            watchInstalling(registration);
          });
        })
        .catch(() => {
          // Ignorer – appen fungerer uten service worker.
        });
    };

    const onControllerChange = () => {
      if (reloadingRef.current) window.location.reload();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (navigator.onLine) {
        void registrationRef.current?.update().catch(() => undefined);
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    document.addEventListener("visibilitychange", onVisibility);

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  function applyUpdate() {
    const worker = waitingRef.current;
    if (!worker) {
      window.location.reload();
      return;
    }
    reloadingRef.current = true;
    worker.postMessage({ type: "SKIP_WAITING" });
    setWaiting(false);
  }

  if (!waiting || dismissed) return null;

  return (
    <div className="fixed inset-x-0 top-[calc(4rem_+_env(safe-area-inset-top))] z-50 px-4">
      <div
        role="status"
        aria-live="polite"
        className="mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border-2 border-signal bg-ink px-4 py-3 text-paper shadow-xl"
      >
        <Icon name="sync" className="h-5 w-5 shrink-0 text-signal" />
        <p className="min-w-0 flex-1 text-sm font-bold">
          {t("components.serviceWorker.updateReady")}
        </p>
        <button
          type="button"
          onClick={applyUpdate}
          className="signal-button min-h-11 text-sm"
        >
          {t("components.serviceWorker.update")}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-paper/70 transition hover:bg-white/10"
        >
          {t("components.serviceWorker.later")}
        </button>
      </div>
    </div>
  );
}
