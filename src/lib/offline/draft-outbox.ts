import {
  clearOfflineDataForUser,
  countOutboxForUser,
  deleteOfflineDraft,
  enqueueOutbox,
  getOfflineDraft,
  incrementOutboxAttempt,
  listOutboxForUser,
  putOfflineDraft,
  removeOutbox,
} from "./db";
import { newestPerReport } from "./outbox-order";

export type DraftPayload = Record<string, unknown>;

/** Hvilken bruker de lokale kladdene og outboxen tilhører akkurat nå. */
const OFFLINE_USER_KEY = "fsm:offline-user";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Husk hvilken bruker som eier de lokale kladdene. */
export function rememberOfflineUser(userId: string): void {
  if (!userId) return;
  try {
    storage()?.setItem(OFFLINE_USER_KEY, userId);
  } catch {
    // Privat modus eller full lagring: outboxen er fortsatt brukbar i økten.
  }
}

/** Brukeren som eier de lokale kladdene, eller null når ingen er kjent. */
export function currentOfflineUserId(): string | null {
  try {
    return storage()?.getItem(OFFLINE_USER_KEY) || null;
  } catch {
    return null;
  }
}

/** Glemmer brukeren ved utlogging, slik at neste bruker ikke arver køen. */
export function forgetOfflineUser(): void {
  try {
    storage()?.removeItem(OFFLINE_USER_KEY);
  } catch {
    // Ignorer lagringsfeil.
  }
}

export function draftKey(
  userId: string,
  workOrderId: string,
  templateId: string,
): string {
  return `${userId}:${workOrderId}:${templateId}`;
}

/**
 * Lagrer kladden lokalt først. Da overlever den nettbrudd, fanelukkinger og
 * restart, uavhengig av om serverkallet lykkes.
 */
export async function saveDraftLocally(input: {
  userId: string;
  workOrderId: string;
  templateId: string;
  payload: DraftPayload;
}): Promise<void> {
  rememberOfflineUser(input.userId);
  await putOfflineDraft({
    key: draftKey(input.userId, input.workOrderId, input.templateId),
    userId: input.userId,
    workOrderId: input.workOrderId,
    templateId: input.templateId,
    payload: JSON.stringify(input.payload),
    updatedAt: Date.now(),
  });
}

export async function loadDraftLocally(input: {
  userId: string;
  workOrderId: string;
  templateId: string;
}): Promise<{ payload: DraftPayload; updatedAt: number } | null> {
  const draft = await getOfflineDraft(
    draftKey(input.userId, input.workOrderId, input.templateId),
  );
  if (!draft) return null;
  try {
    return {
      payload: JSON.parse(draft.payload) as DraftPayload,
      updatedAt: draft.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function clearDraftLocally(input: {
  userId: string;
  workOrderId: string;
  templateId: string;
}): Promise<void> {
  await deleteOfflineDraft(
    draftKey(input.userId, input.workOrderId, input.templateId),
  );
}

/**
 * Legger et serverkladd-forsøk i outboxen for senere replay. Køen slår sammen
 * kladder for samme bruker+oppdrag+mal, slik at bare den nyeste blir liggende.
 */
export async function queueDraftForRetry(
  payload: DraftPayload,
  userId = currentOfflineUserId(),
): Promise<void> {
  // Uten en kjent eier kan kladden ikke sendes trygt på nytt. Den blir da
  // liggende i skjemaet i stedet for å havne i en annen brukers kø.
  if (!userId) throw new Error("Mangler bruker for offline-kladden");
  await enqueueOutbox(JSON.stringify(payload), userId);
  notifyOutboxChanged();
}

function notifyOutboxChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
  } catch {
    // Uten window (eller uten Event-støtte) er det ingenting å varsle.
  }
}

/**
 * Prøver å sende ventende kladder for gjeldende bruker til
 * `/api/offline/draft`. Andre brukeres kladder røres aldri.
 *
 * For hver rapport sendes bare den nyeste kladden. Eldre duplikater (fra før
 * sammenslåingen ble innført) fjernes uten sending, slik at de aldri kan
 * overskrive en nyere kladd på serveren.
 * Returnerer antall sendt og hvor mange som fortsatt venter for brukeren.
 */
export async function flushDraftOutbox(
  userId = currentOfflineUserId(),
): Promise<{ sent: number; pending: number }> {
  if (!userId) return { sent: 0, pending: 0 };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sent: 0, pending: await countOutboxForUser(userId) };
  }

  const items = await listOutboxForUser(userId);
  const { ordered, stale } = newestPerReport(items, userId);

  for (const item of stale) {
    await removeOutbox(item.id);
  }

  let sent = 0;
  for (const item of ordered) {
    try {
      const response = await fetch("/api/offline/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: item.payload,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await removeOutbox(item.id);
      sent += 1;
    } catch {
      await incrementOutboxAttempt(item);
    }
  }

  return { sent, pending: await countOutboxForUser(userId) };
}

export async function pendingDraftCount(
  userId = currentOfflineUserId(),
): Promise<number> {
  if (!userId) return 0;
  return countOutboxForUser(userId);
}

/**
 * Rydder denne brukerens lokale kladder og outbox. Brukes bare når brukeren
 * eksplisitt velger å forkaste dem – vanlig utlogging beholder dem (se
 * `clearOfflineCaches`). Nylige søk ligger i en felles localStorage-nøkkel og
 * ryddes av `clearOfflineCaches`.
 */
export async function clearOfflineUserData(
  userId = currentOfflineUserId(),
): Promise<void> {
  if (userId) await clearOfflineDataForUser(userId);
  forgetOfflineUser();
}

/** Hendelse som varsler offline-banneret om at outboxen er endret. */
export const OUTBOX_CHANGED_EVENT = "fsm:outbox-changed";

/**
 * Sjekker om en outbox-oppføring gjelder samme oppdrag og mal. Payloaden er
 * skjemaets FormData serialisert til JSON, så vi leser id-ene derfra.
 */
export function payloadMatchesReport(
  payload: string,
  workOrderId: string,
  templateId: string,
): boolean {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return (
      parsed.workOrderId === workOrderId && parsed.templateId === templateId
    );
  } catch {
    return false;
  }
}

/**
 * Fjerner ventende kladder for en rapport som nettopp ble sendt inn. Uten
 * dette ville outboxen senere replayet en gammel kladd over den signerte
 * rapporten, og banneret ville fortsatt vist et pending-tall.
 */
export async function removeOutboxForReport(
  input: {
    workOrderId: string;
    templateId: string;
  },
  userId = currentOfflineUserId(),
): Promise<number> {
  if (!userId) return 0;
  const items = await listOutboxForUser(userId);
  let removed = 0;
  for (const item of items) {
    if (payloadMatchesReport(item.payload, input.workOrderId, input.templateId)) {
      await removeOutbox(item.id);
      removed += 1;
    }
  }
  return removed;
}
