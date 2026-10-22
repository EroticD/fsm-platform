"use client";

import { useEffect } from "react";

/**
 * Registrerer service workeren slik at feltappen kan installeres og vise en
 * offline-side. Gjøres bare i produksjon – i utvikling ville cachen skjule
 * endringer.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Ignorer – appen fungerer uten service worker.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
