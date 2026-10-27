import { Client } from "pg";
import {
  isRealtimeKind,
  REALTIME_CHANNEL,
  type RealtimeKind,
} from "./realtime";

/**
 * Én delt PostgreSQL-lytter per prosess, med fan-out til alle tilkoblede
 * nettlesere.
 *
 * Tidligere åpnet hver SSE-tilkobling sin egen `LISTEN`-forbindelse. Med mange
 * faner og brukere tømte det Postgres for tilkoblinger. Nå lytter vi én gang
 * per prosess og sprer bare kategori-navnet videre i minnet – aldri data.
 */

/** Maks samtidige SSE-tilkoblinger per bruker og per IP. */
export const MAX_SSE_PER_USER = 3;
export const MAX_SSE_PER_IP = 3;

type Subscriber = (kind: RealtimeKind) => void;

type HubState = {
  client: Client | null;
  subscribers: Set<Subscriber>;
  connecting: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  userCounts: Map<string, number>;
  ipCounts: Map<string, number>;
};

const globalForHub = globalThis as typeof globalThis & {
  __fsmRealtimeHub?: HubState;
};

function hub(): HubState {
  if (!globalForHub.__fsmRealtimeHub) {
    globalForHub.__fsmRealtimeHub = {
      client: null,
      subscribers: new Set(),
      connecting: false,
      retryTimer: null,
      attempt: 0,
      userCounts: new Map(),
      ipCounts: new Map(),
    };
  }
  return globalForHub.__fsmRealtimeHub;
}

/**
 * node-postgres kjenner ikke Prismas `?schema=`-parameter. Den må fjernes før
 * tilkoblingsstrengen brukes, ellers tolkes den som en ukjent parameter.
 */
export function realtimeConnectionString(): string {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return raw;
  }
}

export type RealtimeSlot = { userId: string; ip?: string };

/** Prøver å reservere en plass. Returnerer false når grensen er nådd. */
export function acquireRealtimeSlot(slot: RealtimeSlot): boolean {
  const state = hub();
  const userCount = state.userCounts.get(slot.userId) ?? 0;
  if (userCount >= MAX_SSE_PER_USER) return false;

  if (slot.ip) {
    const ipCount = state.ipCounts.get(slot.ip) ?? 0;
    if (ipCount >= MAX_SSE_PER_IP) return false;
  }

  state.userCounts.set(slot.userId, userCount + 1);
  if (slot.ip) {
    state.ipCounts.set(slot.ip, (state.ipCounts.get(slot.ip) ?? 0) + 1);
  }
  return true;
}

/** Frigir plassen. Idempotent nok til at dobbel opprydding ikke teller feil. */
export function releaseRealtimeSlot(slot: RealtimeSlot): void {
  const state = hub();
  decrement(state.userCounts, slot.userId);
  if (slot.ip) decrement(state.ipCounts, slot.ip);
}

function decrement(map: Map<string, number>, key: string) {
  const next = (map.get(key) ?? 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

function fanOut(kind: RealtimeKind) {
  for (const subscriber of hub().subscribers) {
    try {
      subscriber(kind);
    } catch {
      // En lukket nettleserstrøm skal ikke stoppe de andre abonnentene.
    }
  }
}

/** Tømmer delt tilstand. Bare for enhetstester. */
export function resetRealtimeHubForTests(): void {
  const state = hub();
  for (const timer of [state.retryTimer]) {
    if (timer) clearTimeout(timer);
  }
  state.retryTimer = null;
  state.attempt = 0;
  state.connecting = false;
  state.subscribers.clear();
  state.userCounts.clear();
  state.ipCounts.clear();
  const client = state.client;
  state.client = null;
  if (client) void client.end().catch(() => {});
}

/** Sender en hendelse til alle abonnenter. Eksportert for tester. */
export function deliverRealtimeKind(kind: RealtimeKind): void {
  fanOut(kind);
}

function scheduleReconnect(delayMs: number) {
  const state = hub();
  if (state.retryTimer || state.subscribers.size === 0) return;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    void ensureRealtimeConnection();
  }, delayMs);
  state.retryTimer.unref?.();
}

function stopClient(state: HubState) {
  const current = state.client;
  state.client = null;
  if (current) void current.end().catch(() => {});
}

function handleDisconnect(state: HubState) {
  state.connecting = false;
  stopClient(state);
  if (state.subscribers.size === 0) return;

  // Eksponentiell pause med tak, slik at en nede-database ikke gir en tett
  // reconnect-storm fra hver prosess.
  state.attempt = Math.min(state.attempt + 1, 6);
  scheduleReconnect(Math.min(30_000, 1_000 * 2 ** state.attempt));
}

async function ensureRealtimeConnection(): Promise<void> {
  const state = hub();
  if (state.client || state.connecting || state.retryTimer) return;
  if (state.subscribers.size === 0) return;

  const connectionString = realtimeConnectionString();
  if (!connectionString) return;

  state.connecting = true;
  const client = new Client({ connectionString });
  state.client = client;

  client.on("notification", (message) => {
    if (message.channel !== REALTIME_CHANNEL) return;
    const kind = message.payload?.trim();
    if (!kind || !isRealtimeKind(kind)) return;
    fanOut(kind);
  });
  client.on("error", () => handleDisconnect(state));
  client.on("end", () => handleDisconnect(state));

  try {
    await client.connect();
    if (state.client !== client) {
      // Abonnentene forsvant mens vi koblet til.
      state.connecting = false;
      void client.end().catch(() => {});
      return;
    }
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    state.connecting = false;
    state.attempt = 0;
  } catch {
    handleDisconnect(state);
  }
}

/**
 * Abonnerer på sanntidshendelser. Den første abonnenten starter den delte
 * lytteren; den siste som forlater lukker den, slik at en tom prosess ikke
 * holder en ubrukt databasetilkobling åpen.
 */
export function subscribeRealtime(subscriber: Subscriber): () => void {
  const state = hub();
  state.subscribers.add(subscriber);
  void ensureRealtimeConnection();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    state.subscribers.delete(subscriber);

    if (state.subscribers.size > 0) return;
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
    state.attempt = 0;
    stopClient(state);
  };
}

/** Antall aktive abonnenter, for tester og drift. */
export function realtimeSubscriberCount(): number {
  return hub().subscribers.size;
}
