import {
  countOutbox,
  deleteOfflineDraft,
  enqueueOutbox,
  getOfflineDraft,
  incrementOutboxAttempt,
  listOutbox,
  putOfflineDraft,
  removeOutbox,
} from "./db";

export type DraftPayload = Record<string, unknown>;

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
export async function queueDraftForRetry(payload: DraftPayload): Promise<void> {
  await enqueueOutbox(JSON.stringify(payload));
}

/**
 * Prøver å sende alle ventende kladder til `/api/offline/draft`.
 * Returnerer antall sendt og hvor mange som fortsatt venter.
 */
export async function flushDraftOutbox(): Promise<{
  sent: number;
  pending: number;
}> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sent: 0, pending: await countOutbox() };
  }

  const items = await listOutbox();
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

  return { sent, pending: await countOutbox() };
}

export async function pendingDraftCount(): Promise<number> {
  return countOutbox();
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
export async function removeOutboxForReport(input: {
  workOrderId: string;
  templateId: string;
}): Promise<number> {
  const items = await listOutbox();
  let removed = 0;
  for (const item of items) {
    if (payloadMatchesReport(item.payload, input.workOrderId, input.templateId)) {
      await removeOutbox(item.id);
      removed += 1;
    }
  }
  return removed;
}
