"use client";

import { useEffect } from "react";

/**
 * Varmer sidecachen med dagens tildelte oppdrag.
 *
 * Service workeren legger en feltside i sidecachen først når montøren faktisk
 * har åpnet den (`navigationResponse` / `rscResponse` i `public/sw.js`). En
 * montør som mister nettet før hen har åpnet dagens oppdrag, får derfor ingen
 * offline-treff på dem. Denne komponenten ber om RSC-payloaden for dagens
 * oppdrag mens nettet fortsatt er der.
 *
 * Forespørselen må ha `RSC: "1"`. En vanlig `fetch(url)` fra en side har
 * `mode: "cors"` og treffer ingen av service workerens grener – bare
 * `navigate` og RSC/data blir cachet. Uten `next-router-prefetch` ser workeren
 * forespørselen som en ekte navigasjon: den cacher RSC-en og kaller
 * `ensureHtmlCached`, som legger HTML-versjonen ved siden av. Da virker både
 * klientnavigasjon og full omlasting offline.
 */

/** Flere oppdrag enn dette er ikke dagens arbeidsdag, og hammer serveren. */
export const MAX_WARMUP_ORDERS = 8;

/** Pause mellom hver forhåndshenting, så vi ikke fyrer av alt på én gang. */
export const WARMUP_GAP_MS = 200;

function uniqueOrderIds(ids: readonly string[]): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    picked.push(trimmed);
    if (picked.length >= MAX_WARMUP_ORDERS) break;
  }
  return picked;
}

/**
 * Uten aktiv service worker finnes ingen cache å varme, og uten nett er det
 * ingenting å hente. Begge deler feiler stille.
 */
function canWarmCache(): boolean {
  if (typeof navigator === "undefined") return false;
  if (navigator.onLine === false) return false;
  return Boolean(navigator.serviceWorker?.controller);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }

    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Henter detaljsiden for hvert oppdrag sekvensielt. Returnerer antallet
 * forespørsler som fikk et vellykket svar – nyttig i tester, aldri vist.
 *
 * Alle feil svelges: dette er en optimering, og montøren skal aldri se noe
 * hvis forhåndshentingen ikke går.
 */
export async function warmOrderDetails(
  ids: readonly string[],
  options: { signal?: AbortSignal; gapMs?: number } = {},
): Promise<number> {
  if (!canWarmCache()) return 0;

  const targets = uniqueOrderIds(ids);
  if (targets.length === 0) return 0;

  const signal = options.signal ?? new AbortController().signal;
  const gapMs = options.gapMs ?? WARMUP_GAP_MS;
  let warmed = 0;

  for (const [index, id] of targets.entries()) {
    if (signal.aborted || !canWarmCache()) break;
    try {
      const response = await fetch(`/mine-oppdrag/${encodeURIComponent(id)}`, {
        headers: { RSC: "1" },
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (response.ok) {
        // Les kroppen ferdig, slik at workeren rekker å skrive klonen sin til
        // sidecachen før neste forespørsel tar over.
        await response.arrayBuffer();
        warmed += 1;
      }
    } catch {
      // Nettbrudd eller avbrutt: gi opp resten hvis signalet er avbrutt,
      // ellers fortsett med neste oppdrag.
      if (signal.aborted) break;
    }
    if (index < targets.length - 1 && !signal.aborted) {
      await pause(gapMs, signal);
    }
  }

  return warmed;
}

export default function TodayWarmup({
  orderIds,
}: {
  orderIds: readonly string[];
}) {
  // Serverkomponenten lager en ny liste ved hver render. Effekten skal henge på
  // innholdet, ikke på referansen, så den ikke kjører unødig.
  const idsKey = orderIds.join(",");

  useEffect(() => {
    if (!idsKey) return;
    const controller = new AbortController();
    void warmOrderDetails(idsKey.split(","), { signal: controller.signal });
    return () => controller.abort();
  }, [idsKey]);

  return null;
}
