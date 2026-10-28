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

/** Legger et serverkladd-forsøk i outboxen for senere replay. */
export async function queueDraftForRetry(
  payload: DraftPayload,
  userId = currentOfflineUserId(),
): Promise<void> {
  // Uten en kjent eier kan kladden ikke sendes trygt på nytt. Den blir da
  // liggende i skjemaet i stedet for å havne i en annen brukers kø.
  if (!userId) throw new Error("Mangler bruker for offline-kladden");
  await enqueueOutbox(JSON.stringify(payload), userId);
}

/**
 * Prøver å sende ventende kladder for gjeldende bruker til
 * `/api/offline/draft`. Andre brukeres kladder røres aldri.
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
  let sent = 0;

  for (const item of items) {
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
 * Rydder denne brukerens lokale kladder og outbox. Kalles ved utlogging fra
 * en delt enhet. Nylige søk ligger i en felles localStorage-nøkkel og ryddes
 * av `clearOfflineCaches`, som også kaller denne funksjonen.
 */
export async function clearOfflineUserData(
  userId = currentOfflineUserId(),
): Promise<void> {
  if (userId) await clearOfflineDataForUser(userId);
  forgetOfflineUser();
}
