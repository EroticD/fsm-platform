import {
  clearOfflineDataForUser,
  deleteOfflineDraft,
  enqueueOutbox,
  getOfflineDraft,
  listDraftsForUser,
  listOutboxForUser,
  putOfflineDraft,
  recordOutboxFailure,
  removeOutbox,
  resetFailedOutbox,
  type EnqueueResult,
  type OfflineDraft,
} from "./db";
import {
  isAttemptLimitReached,
  isOutboxReady,
  isOutboxTerminal,
  itemReportIdentity,
  newestPerReport,
  reportKey,
} from "./outbox-order";
import {
  emitSyncEnd,
  emitSyncProgress,
  emitSyncStart,
  requestDraftBackgroundSync,
} from "./sync";

export type DraftPayload = Record<string, unknown>;

export type DraftSummary = {
  /** Kladder som fortsatt kan sendes automatisk. */
  pending: number;
  /** Kladder som har fått terminal feil og trenger manuell oppfølging. */
  failed: number;
};

export type FlushResult = DraftSummary & { sent: number };

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
  return reportKey(userId, { workOrderId, templateId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Outboxen skal inneholde skjemaets FormData – ikke hele det lokale
 * øyeblikksbildet med React-state. Snapshotet har formen
 * `{ state, form, notes }`, mens et direkte kladdesvar er selve formen.
 */
function outboxFormValues(
  payload: DraftPayload,
): Record<string, string> | null {
  const source = isRecord(payload.form) ? payload.form : payload;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") values[key] = value;
  }
  return Object.keys(values).length > 0 ? values : null;
}

function outboxPayload(input: {
  userId: string;
  workOrderId: string;
  templateId: string;
  payload: DraftPayload;
}): string | null {
  const values = outboxFormValues(input.payload);
  if (!values) return null;
  return JSON.stringify({
    ...values,
    workOrderId: input.workOrderId,
    templateId: input.templateId,
  });
}

function storedDraftOutboxPayload(draft: OfflineDraft): string | null {
  try {
    const parsed = JSON.parse(draft.payload) as DraftPayload;
    return outboxPayload({
      userId: draft.userId,
      workOrderId: draft.workOrderId,
      templateId: draft.templateId,
      payload: parsed,
    });
  } catch {
    return null;
  }
}

/**
 * Lagrer kladden lokalt først. Da overlever den nettbrudd, fanelukkinger og
 * restart, uavhengig av om serverkallet lykkes.
 *
 * Hver lokale lagring legges også i outboxen (sammenslått per rapport). Dermed
 * blir en kladd som bare rakk å bli skrevet til IndexedDB – for eksempel fordi
 * appen ble drept mens montøren skrev – sendt ved neste anledning. Tidligere
 * ble outboxen bare fylt når et serverlagringsforsøk feilet.
 */
export async function saveDraftLocally(input: {
  userId: string;
  workOrderId: string;
  templateId: string;
  payload: DraftPayload;
}): Promise<void> {
  rememberOfflineUser(input.userId);
  const draft: OfflineDraft = {
    key: draftKey(input.userId, input.workOrderId, input.templateId),
    userId: input.userId,
    workOrderId: input.workOrderId,
    templateId: input.templateId,
    payload: JSON.stringify(input.payload),
    updatedAt: Date.now(),
  };
  await putOfflineDraft(draft);

  const payload = outboxPayload(input);
  if (payload) {
    const result = await enqueueOutbox(payload, input.userId);
    if (result === "queued") {
      // Be nettleseren vekke service workeren selv om appen lukkes. Kallet er
      // en no-op uten SyncManager, og skal aldri blokkere den lokale lagringen.
      void requestDraftBackgroundSync();
    } else if (result === "too-large") {
      // Marker bare denne versjonen; en senere lagring kan være mindre og
      // skriver da et nytt snapshot uten feilmarkeringen.
      const current = await getOfflineDraft(draft.key);
      if (current && current.updatedAt === draft.updatedAt) {
        await putOfflineDraft({ ...current, syncError: "payload-too-large" });
      }
    }
  }
  notifyOutboxChanged();
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
 * Vanlige lokale lagringer går gjennom `saveDraftLocally`; denne brukes når
 * skjemaet eksplisitt vil sikre siste kjente payload.
 */
export async function queueDraftForRetry(
  payload: DraftPayload,
  userId = currentOfflineUserId(),
): Promise<EnqueueResult> {
  // Uten en kjent eier kan kladden ikke sendes trygt på nytt. Den blir da
  // liggende i skjemaet i stedet for å havne i en annen brukers kø.
  if (!userId) throw new Error("Mangler bruker for offline-kladden");
  const result = await enqueueOutbox(JSON.stringify(payload), userId);
  if (result === "queued") void requestDraftBackgroundSync();
  notifyOutboxChanged();
  return result;
}

function notifyOutboxChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
  } catch {
    // Uten window (eller uten Event-støtte) er det ingenting å varsle.
  }
}

/** Markerer en lokal kladd som lagret på serveren, men bare opp til tidspunktet. */
export async function markDraftSynced(input: {
  userId: string;
  workOrderId: string;
  templateId: string;
  syncedUpTo: number;
}): Promise<void> {
  const key = draftKey(input.userId, input.workOrderId, input.templateId);
  const draft = await getOfflineDraft(key);
  if (!draft) return;
  // En nyere lokal lagring enn det serveren bekreftet skal fortsatt sendes.
  if (draft.updatedAt > input.syncedUpTo) return;
  if ((draft.syncedAt ?? 0) >= draft.updatedAt) return;
  const next = { ...draft, syncedAt: draft.updatedAt };
  delete next.syncError;
  await putOfflineDraft(next);
}

/**
 * Kladder som ble skrevet lokalt uten å rekke å bli lagt i outboxen (eller som
 * ble avvist fordi outboxen var utilgjengelig) legges i køen før sending.
 */
async function enqueueUnsyncedDrafts(userId: string): Promise<void> {
  // Les kladdene først: listingen rydder eventuelle utløpte kladder og
  // markerer tilhørende outbox-oppføringer som feilet før køen leses.
  const drafts = await listDraftsForUser(userId);
  const outbox = await listOutboxForUser(userId);
  const newestByReport = new Map<string, number>();
  for (const item of outbox) {
    const identity = itemReportIdentity(item);
    if (!identity) continue;
    const key = reportKey(userId, identity);
    newestByReport.set(
      key,
      Math.max(newestByReport.get(key) ?? 0, item.createdAt),
    );
  }

  for (const draft of drafts) {
    if (draft.syncError) continue;
    if (draft.updatedAt <= (draft.syncedAt ?? 0)) continue;
    const key = draftKey(draft.userId, draft.workOrderId, draft.templateId);
    if ((newestByReport.get(key) ?? 0) >= draft.updatedAt) continue;
    const payload = storedDraftOutboxPayload(draft);
    if (!payload) continue;
    const result = await enqueueOutbox(payload, userId);
    if (result === "too-large") {
      await putOfflineDraft({ ...draft, syncError: "payload-too-large" });
    }
  }
}

/**
 * Regner ut hvor mange rapporter som har usendte endringer. En lokal kladd
 * telles bare når den er nyere enn siste bekreftede serverlagring, slik at
 * banneret ikke fortsetter å telle en kladd som allerede er sendt.
 */
export async function pendingDraftSummary(
  userId = currentOfflineUserId(),
): Promise<DraftSummary> {
  if (!userId) return { pending: 0, failed: 0 };

  // Les kladdene først, slik at utløpte kladder rekker å markere outboxen som
  // feilet før oppføringene telles.
  const drafts = await listDraftsForUser(userId);
  const outbox = await listOutboxForUser(userId);
  const pendingKeys = new Set<string>();
  const failedKeys = new Set<string>();

  for (const item of outbox) {
    const identity = itemReportIdentity(item);
    const key = identity
      ? reportKey(userId, identity)
      : `outbox:${item.id}`;
    if (isOutboxTerminal(item) || isAttemptLimitReached(item.attempts)) {
      failedKeys.add(key);
    } else {
      pendingKeys.add(key);
    }
  }

  for (const draft of drafts) {
    const key = draftKey(draft.userId, draft.workOrderId, draft.templateId);
    if (draft.syncError) {
      failedKeys.add(key);
      continue;
    }
    if (draft.updatedAt > (draft.syncedAt ?? 0)) pendingKeys.add(key);
  }

  // En terminal feil skal ikke også telles som «venter på sending».
  for (const key of failedKeys) pendingKeys.delete(key);
  return { pending: pendingKeys.size, failed: failedKeys.size };
}

/**
 * Antall rapporter med usendte endringer, inkludert terminale feil. Beholdes
 * for kallere som bare trenger ett tall (f.eks. tester og enkel UI).
 */
export async function pendingDraftCount(
  userId = currentOfflineUserId(),
): Promise<number> {
  const summary = await pendingDraftSummary(userId);
  return summary.pending + summary.failed;
}

/**
 * Prøver å sende ventende kladder for gjeldende bruker til
 * `/api/offline/draft`. Andre brukeres kladder røres aldri.
 *
 * For hver rapport sendes bare den nyeste kladden. Eldre duplikater (fra før
 * sammenslåingen ble innført) fjernes uten sending, slik at de aldri kan
 * overskrive en nyere kladd på serveren. Terminale feil hoppes over til
 * brukeren velger «Prøv igjen» eller sletter kladden.
 */
export async function flushDraftOutbox(
  userId = currentOfflineUserId(),
): Promise<FlushResult> {
  if (!userId) return { sent: 0, pending: 0, failed: 0 };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sent: 0, ...(await pendingDraftSummary(userId)) };
  }

  // Starttelleren leses før nye kladder legges i køen, slik at banneret får et
  // konsistent utgangspunkt for fremdriftseventene.
  const initial = await pendingDraftSummary(userId);
  await enqueueUnsyncedDrafts(userId);

  const items = await listOutboxForUser(userId);
  const { ordered, stale } = newestPerReport(items, userId);

  for (const item of stale) {
    await removeOutbox(item.id);
  }

  const now = Date.now();
  const hasSendable = ordered.some(
    (item) =>
      !isOutboxTerminal(item) &&
      !isAttemptLimitReached(item.attempts) &&
      isOutboxReady(item, now),
  );

  let sent = 0;
  if (hasSendable) {
    emitSyncStart({ sent: 0, ...initial });
  }

  try {
    for (const item of ordered) {
      // Eldre oppføringer kan mangle `failedAt` selv om forsøksbudsjettet er
      // brukt opp (feltet ble skrevet, men aldri lest). Marker dem terminalt i
      // stedet for å sende én gang til.
      if (isAttemptLimitReached(item.attempts)) {
        await recordOutboxFailure(item, {
          terminal: true,
          reason: "attempts-exhausted",
        });
        continue;
      }
      if (!isOutboxReady(item, now)) continue;

      try {
        const response = await fetch("/api/offline/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: item.payload,
        });
        if (!response.ok) {
          const terminal = response.status === 413 || response.status === 400;
          await recordOutboxFailure(item, {
            terminal,
            reason:
              response.status === 413
                ? "payload-too-large"
                : response.status === 400
                  ? "rejected"
                  : `http-${response.status}`,
          });
          continue;
        }
        await removeOutbox(item.id);
        sent += 1;
        const identity = itemReportIdentity(item);
        if (identity) {
          await markDraftSynced({
            userId,
            workOrderId: identity.workOrderId,
            templateId: identity.templateId,
            // Outbox-oppføringen ble laget etter den lokale kladden. En kladd
            // som er skrevet senere enn dette skal fortsatt sendes.
            syncedUpTo: item.createdAt,
          });
        }
        emitSyncProgress({
          sent,
          pending: Math.max(0, initial.pending - sent),
          failed: initial.failed,
        });
      } catch {
        await recordOutboxFailure(item, { reason: "network" });
      }
    }
  } finally {
    if (hasSendable) {
      try {
        emitSyncEnd({ sent, ...(await pendingDraftSummary(userId)) });
      } catch {
        // En mislykket oppsummering skal ikke skjule selve flush-resultatet.
      }
    }
  }

  return { sent, ...(await pendingDraftSummary(userId)) };
}

/** Nullstiller terminale feil og prøver dem en gang til. */
export async function retryFailedDrafts(
  userId = currentOfflineUserId(),
): Promise<FlushResult> {
  if (!userId) return { sent: 0, pending: 0, failed: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { sent: 0, ...(await pendingDraftSummary(userId)) };
  }
  await resetFailedOutbox(userId);
  return flushDraftOutbox(userId);
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
  notifyOutboxChanged();
}

/** Hendelse som varsler offline-banneret om at kladdelisten er endret. */
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
 *
 * `before` gjør at en nyere lokal lagring som kom inn mens serverkallet pågikk
 * ikke blir slettet. Den skal fortsatt sendes.
 */
export async function removeOutboxForReport(
  input: {
    workOrderId: string;
    templateId: string;
    before?: number;
  },
  userId = currentOfflineUserId(),
): Promise<number> {
  if (!userId) return 0;
  const items = await listOutboxForUser(userId);
  const before = input.before ?? Number.POSITIVE_INFINITY;
  let removed = 0;
  let newestRemoved = 0;
  for (const item of items) {
    if (item.createdAt > before) continue;
    if (payloadMatchesReport(item.payload, input.workOrderId, input.templateId)) {
      await removeOutbox(item.id);
      removed += 1;
      newestRemoved = Math.max(newestRemoved, item.createdAt);
    }
  }
  if (newestRemoved > 0) {
    await markDraftSynced({
      userId,
      workOrderId: input.workOrderId,
      templateId: input.templateId,
      syncedUpTo: newestRemoved,
    });
  }
  return removed;
}
