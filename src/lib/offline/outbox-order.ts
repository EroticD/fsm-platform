/**
 * Ren logikk for rekkefølge og sammenslåing av offline-outboxen.
 *
 * Outboxen skal aldri inneholde flere ventende versjoner av samme rapport.
 * Når en ny kladd legges i køen, erstatter den den gamle. Eldre oppføringer
 * (fra før sammenslåingen ble innført) sorteres slik at den nyeste sendes sist,
 * og eldre duplikater hoppes over – en gammel kladd skal aldri kunne overskrive
 * en nyere.
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
};

export type ReportIdentity = {
  workOrderId: string;
  templateId: string;
};

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

export function sameReport(
  a: ReportIdentity,
  b: ReportIdentity,
): boolean {
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
