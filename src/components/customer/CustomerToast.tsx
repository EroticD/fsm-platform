"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ToastProvider";

/**
 * Fjerner kvitteringsparametere (f.eks. `meldt` eller `versioned`) fra en
 * søkestreng og beholder alle andre parametere uendret.
 *
 * `changed` sier om noe faktisk ble fjernet, slik at vi ikke skriver til
 * historikken unødig.
 */
export function stripFlashParams(
  search: string,
  keys: readonly string[],
): { search: string; changed: boolean } {
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of keys) {
    if (!key || !params.has(key)) continue;
    params.delete(key);
    changed = true;
  }
  const text = params.toString();
  return { search: text ? `?${text}` : "", changed };
}

/**
 * Viser en toast én gang når en server action har redirectet tilbake med en
 * statuskode. Komponenten rendres bare når statusen finnes i URL-en.
 *
 * `clearParams` fjerner kvitteringsparameterne idet toasten vises. Da gir
 * refresh, tilbake og en delt lenke ikke samme kvittering på nytt. Vi bruker
 * `history.replaceState` uten reload, slik at siden ikke rendres på nytt, og
 * rører aldri andre parametere – filtre og sidetall blir stående.
 */
export default function CustomerToast({
  message,
  tone = "success",
  clearParams,
}: {
  message: string;
  tone?: "success" | "error" | "info";
  /** Query-parametere som skal fjernes når toasten faktisk er vist. */
  clearParams?: string[];
}) {
  const { toast } = useToast();
  const shown = useRef(false);
  // Arrayen er en ny referanse hver render; sammenlign på innhold i stedet.
  const clearKey = (clearParams ?? []).join(",");

  useEffect(() => {
    if (!message || shown.current) return;
    shown.current = true;
    toast(message, tone);
    if (!clearKey) return;

    const { search, changed } = stripFlashParams(
      window.location.search,
      clearKey.split(","),
    );
    if (!changed) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }, [message, tone, toast, clearKey]);

  return null;
}
