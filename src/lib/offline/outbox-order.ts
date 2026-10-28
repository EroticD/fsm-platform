/**
 * Ren logikk for rekkefølge, sammenslåing og retry-policy for offline-outboxen.
 *
 * Outboxen skal aldri inneholde flere ventende versjoner av samme rapport.
 * Når en ny kladd legges i køen, erstatter den den gamle. Eldre oppføringer
 * (fra før sammenslåingen ble innført) sorteres slik at den nyeste sendes sist,
 * og eldre duplikater hoppes over – en gammel kladd skal aldri kunne overskrive
 * en nyere.
 *
 * Retry-policyen er også ren og testbar: et begrenset antall forsøk med
 * eksponentiell backoff, og en tydelig terminal tilstand når kladden ikke kan
 * sendes. Det hindrer at en for stor eller avvist payload hamrer på API-et i
 * det uendelige.
 */

export type OutboxOrderItem = {
  id: string;
  userId: string;
  payload: string;
  createdAt: number;
  attempts: number;
  /** Satt på nye oppføringer, så vi slipper å parse payloaden hver gang. */
  workOrderId?: string;
  templateId?: string;
  /** Tidspunkt for neste lovlige forsøk (epoch ms). */
  nextAttemptAt?: number;
  /** Satt når oppføringen har gitt opp; den sendes ikke automatisk igjen. */
  failedAt?: number;
  /** Kort årsakskode, f.eks. «payload-too-large» eller «http-500». */
  failureReason?: string;
};

export type ReportIdentity = {
  workOrderId: string;
  templateId: string;
};

/** Samme grense som `/api/offline/draft` håndhever på serveren. */
export const MAX_OUTBOX_PAYLOAD_BYTES = 2_000_000;

/** Etter dette antallet mislykkede forsøk markeres kladden som terminal. */
export const MAX_OUTBOX_ATTEMPTS = 10;

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 30 * 60_000;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Leser oppdrag og mal fra en serialisert skjemapayload. */
export function payloadReportIdentity(payload: string): ReportIdentity | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const workOrderId = nonEmptyString(parsed.workOrderId);
    const templateId = nonEmptyString(parsed.templateId);
    if (!workOrderId || !templateId) return null;
    return { workOrderId, templateId };
  } catch {
    return null;
  }
}

/** Identiteten til en outbox-oppføring, med fallback til payloaden. */
export function itemReportIdentity(
  item: Pick<OutboxOrderItem, "payload" | "workOrderId" | "templateId">,
): ReportIdentity | null {
  if (item.workOrderId && item.templateId) {
    return { workOrderId: item.workOrderId, templateId: item.templateId };
  }
  return payloadReportIdentity(item.payload);
}

export function sameReport(a: ReportIdentity, b: ReportIdentity): boolean {
  return a.workOrderId === b.workOrderId && a.templateId === b.templateId;
}

/** Stabil nøkkel for én brukers rapport. */
export function reportKey(userId: string, identity: ReportIdentity): string {
  return `${userId}:${identity.workOrderId}:${identity.templateId}`;
}

/**
 * Sorterer eldste først. Dermed sendes den nyeste kladden for en rapport sist,
 * og vinner på serveren dersom en eldre oppføring skulle ha blitt liggende.
 */
export function sortOutboxOldestFirst<T extends { id: string; createdAt: number }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

/**
 * Velger hvilke oppføringer som faktisk skal sendes. For hver rapport beholdes
 * bare den nyeste; resten returneres som `stale` og kan fjernes uten sending.
 * Terminale oppføringer blir liggende som nyeste, slik at de kan vises og
 * slettes/forsøkes manuelt – de skal ikke erstattes av en eldre kladd.
 */
export function newestPerReport<T extends OutboxOrderItem>(
  items: T[],
  userId: string,
): { ordered: T[]; stale: T[] } {
  const ordered = sortOutboxOldestFirst(items);
  const newest = new Map<string, T>();

  for (const item of ordered) {
    if (item.userId !== userId) continue;
    const identity = itemReportIdentity(item);
    if (!identity) continue;
    newest.set(reportKey(userId, identity), item);
  }

  const stale: T[] = [];
  const toSend: T[] = [];
  for (const item of ordered) {
    if (item.userId !== userId) continue;
    const identity = itemReportIdentity(item);
    if (!identity) {
      toSend.push(item);
      continue;
    }
    if (newest.get(reportKey(userId, identity)) === item) {
      toSend.push(item);
    } else {
      stale.push(item);
    }
  }

  return { ordered: toSend, stale };
}

/** Antall bytes i en serialisert payload, slik serveren måler den. */
export function payloadByteLength(payload: string): number {
  if (typeof TextEncoder === "undefined") return payload.length;
  return new TextEncoder().encode(payload).byteLength;
}

/** Payloaden kan sendes til `/api/offline/draft` uten å bli avvist som 413. */
export function isPayloadWithinLimit(payload: string): boolean {
  return payloadByteLength(payload) <= MAX_OUTBOX_PAYLOAD_BYTES;
}

/** Terminale oppføringer skal ikke sendes automatisk. */
export function isOutboxTerminal(
  item: Pick<OutboxOrderItem, "failedAt">,
): boolean {
  return typeof item.failedAt === "number" && item.failedAt > 0;
}

/** Oppføringen er ikke terminal og backoff-vinduet er passert. */
export function isOutboxReady(
  item: Pick<OutboxOrderItem, "failedAt" | "nextAttemptAt">,
  now = Date.now(),
): boolean {
  if (isOutboxTerminal(item)) return false;
  return !item.nextAttemptAt || item.nextAttemptAt <= now;
}

/**
 * Eksponentiell backoff med tak. Første feil gir kort pause (montøren kan ha
 * mistet nettet et øyeblikk), senere feil gir lengre pause. Etter
 * `MAX_OUTBOX_ATTEMPTS` blir oppføringen terminal uansett.
 */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 16));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
}

/** Neste forsøk er terminalt fordi maks antall forsøk er brukt opp. */
export function isAttemptLimitReached(attempts: number): boolean {
  return attempts >= MAX_OUTBOX_ATTEMPTS;
}
