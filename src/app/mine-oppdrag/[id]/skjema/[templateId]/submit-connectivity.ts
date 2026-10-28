"use client";

import { useSyncExternalStore } from "react";

/**
 * Ren beslutning for om rapporten kan sendes inn.
 *
 * Innsending krever nett, at skjemaet ikke allerede sendes, og at malens
 * enhetskrav er oppfylt. Holdt utenfor komponenten så reglene kan testes uten
 * å rendre hele skjemaet.
 */
export type ReportSubmitGate = {
  /** Nettleseren rapporterer at den er på nett. */
  online: boolean;
  /** Server-handlingen kjører allerede. */
  pending?: boolean;
  /** Malen krever enheter, men ingen er lagt til. */
  missingUnits?: boolean;
};

export function canSubmitReport({
  online,
  pending = false,
  missingUnits = false,
}: ReportSubmitGate): boolean {
  return online && !pending && !missingUnits;
}

function subscribeToConnectivity(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * Serveren vet ikke om nettleseren er på nett. Vi antar online til hydreringen
 * er ferdig; da leser `useSyncExternalStore` den ekte verdien og rendrer på
 * nytt uten hydreringsfeil. Lytterne holder knappen oppdatert når nettet
 * forsvinner og kommer tilbake.
 */
function getServerSnapshot(): boolean {
  return true;
}

/** Reaktiv nettstatus for skjemaet. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeToConnectivity,
    getOnlineSnapshot,
    getServerSnapshot,
  );
}
