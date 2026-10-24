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
