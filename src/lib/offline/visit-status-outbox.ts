/**
 * Kø for visittstatusser som er registrert uten nett.
 *
 * Samme mønster som `draft-outbox`, men med en viktig forskjell: postene er
 * små og inneholder bare id-er, status og tidspunkt. De krypteres derfor ikke,
 * og kan legges i køen før montøren har låst opp PIN-nøkkelen. Uten det ville
 * en ankomst ikke kunne tidfestes i det hele tatt når appen er offline.
 *
 * Køen er bevisst begrenset til avreise og ankomst (`EN_ROUTE`/`ON_SITE`).
 * Fullføring krever rapport og PDF og går alltid gjennom den vanlige,
 * nettavhengige flyten.
 */
import {
  clearPendingVisitStatuses,
  listPendingVisitStatuses as listStoredVisitStatuses,
  putPendingVisitStatus,
  removePendingVisitStatus,
  type PendingVisitStatus,
} from "./db";
import { currentOfflineUserId } from "./draft-outbox";
import {
  isOfflineVisitStatus,
  visitStatusKey,
  visitStatusTimestampProblem,
  type OfflineVisitStatus,
  type VisitStatusSendResult,
} from "./visit-status-rules";

export type { OfflineVisitStatus, PendingVisitStatus };
export {
  OFFLINE_VISIT_STATUSES,
  VISIT_STATUS_MAX_AGE_MS,
  VISIT_STATUS_MAX_FUTURE_MS,
  isOfflineVisitStatus,
  visitStatusKey,
  visitStatusTimestampProblem,
} from "./visit-status-rules";
export type { VisitStatusSendResult } from "./visit-status-rules";

/** Resultat av å legge en statusregistrering i køen. */
export type QueueVisitStatusResult =
  | "queued"
  | "duplicate"
  | "invalid"
  | "unavailable";

export type VisitStatusSender = (
  item: PendingVisitStatus,
) => Promise<VisitStatusSendResult>;

export type VisitStatusFlushResult = {
  /** Antall registreringer serveren kvitterte for. */
  sent: number;
  /** Antall registreringer som aldri kan sendes (utløpt eller avvist). */
  discarded: number;
  /** Antall registreringer som fortsatt ligger i køen. */
  pending: number;
};

/**
 * Legger en statusregistrering i køen med idempotensnøkkelen
 * `visitId + status + at`. Samme handling to ganger gir én oppføring.
 *
 * Tidsstempelet valideres med de samme grensene som serveren bruker, slik at
 * en urimelig klokke ikke fyller køen med poster som uansett blir avvist.
 */
export async function queueVisitStatus(input: {
  visitId: string;
  status: OfflineVisitStatus;
  at: number;
  /** Eieren av køen. Standard er brukeren som er husket i denne nettleseren. */
  userId?: string | null;
}): Promise<QueueVisitStatusResult> {
  if (!input.visitId || !isOfflineVisitStatus(input.status)) return "invalid";
  if (visitStatusTimestampProblem(input.at) !== null) return "invalid";

  const userId =
    input.userId === undefined ? currentOfflineUserId() : input.userId;

  return putPendingVisitStatus({
    key: visitStatusKey(input.visitId, input.status, input.at),
    visitId: input.visitId,
    status: input.status,
    at: input.at,
    userId: userId ?? null,
    queuedAt: Date.now(),
  });
}

/**
 * Kronologisk rekkefølge. Avreise må alltid sendes før ankomst, ellers ville
 * serveren avvist ankomsten som en ulovlig overgang. Ved likt tidspunkt avgjør
 * køtid og nøkkel, slik at rekkefølgen er stabil mellom kjøringer.
 */
export function sortPendingVisitStatuses(
  items: readonly PendingVisitStatus[],
): PendingVisitStatus[] {
  return [...items].sort(
    (a, b) => a.at - b.at || a.queuedAt - b.queuedAt || a.key.localeCompare(b.key),
  );
}

/**
 * Ventende registreringer i kronologisk rekkefølge.
 *
 * Uten `userId` returneres hele køen. Med `userId` tas bare den brukerens
 * poster med – pluss poster uten kjent eier, som er lagt inn før innloggingen
 * rakk å huske brukeren. Er eieren ukjent, returneres alt: serveractionen
 * avviser uansett visiter den innloggede brukeren ikke har tilgang til, og en
 * kø som aldri kan tømmes er verre enn et avvist forsøk.
 */
export async function listPendingVisitStatuses(
  userId?: string | null,
): Promise<PendingVisitStatus[]> {
  const items = sortPendingVisitStatuses(await listStoredVisitStatuses());
  if (!userId) return items;
  return items.filter(
    (item) => item.userId === null || item.userId === userId,
  );
}

/** Hindrer at to samtidige tømminger (oppstart og «online») sender samme post. */
let flushing = false;

/**
 * Sender køen i kronologisk rekkefølge og sletter det serveren kvitterer for.
 *
 * `send` injiseres av klienten (se `flushVisitStatuses`-kallet i
 * `VisitStatusButton`). Dermed avhenger ikke kømodulen av serveractionen, og
 * kan testes uten serverkode.
 *
 * En feil som kan lykkes senere (nettbrudd, 5xx) stopper tømmingen og lar
 * posten – og resten av køen – ligge. En definitiv avvisning fjernes, slik at
 * én gammel registrering ikke blokkerer all senere arbeidstid. Postens eget
 * tidsstempel brukes uendret; det er hele poenget med køen.
 */
export async function flushVisitStatuses(
  send: VisitStatusSender,
  options: { userId?: string | null } = {},
): Promise<VisitStatusFlushResult> {
  const userId =
    options.userId === undefined ? currentOfflineUserId() : options.userId;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      sent: 0,
      discarded: 0,
      pending: (await listPendingVisitStatuses(userId)).length,
    };
  }
  if (flushing) {
    return {
      sent: 0,
      discarded: 0,
      pending: (await listPendingVisitStatuses(userId)).length,
    };
  }

  flushing = true;
  let sent = 0;
  let discarded = 0;

  try {
    const items = await listPendingVisitStatuses(userId);

    for (const item of items) {
      // Serveren avviser et for gammelt eller ugyldig tidsstempel uansett. Da
      // er det ærligere å rydde det bort enn å prøve det i det uendelige. Et
      // tidspunkt litt fram i tid kan bli gyldig når klokken har kommet seg,
      // og blir derfor liggende.
      const timestampProblem = visitStatusTimestampProblem(item.at);
      if (timestampProblem === "too-old" || timestampProblem === "invalid") {
        await removePendingVisitStatus(item.key);
        discarded += 1;
        continue;
      }
      if (timestampProblem === "in-future") break;

      let result: VisitStatusSendResult;
      try {
        result = await send(item);
      } catch {
        // Nettet forsvant under sendingen. Behold posten og rekkefølgen.
        break;
      }

      if (result.ok) {
        await removePendingVisitStatus(item.key);
        sent += 1;
        continue;
      }
      if (result.retryable) break;

      await removePendingVisitStatus(item.key);
      discarded += 1;
    }
  } finally {
    flushing = false;
  }

  return {
    sent,
    discarded,
    pending: (await listPendingVisitStatuses(userId)).length,
  };
}

/** Tømmer hele statuskøen. Brukes av tester og ved bevisst opprydding. */
export async function clearVisitStatusOutbox(): Promise<void> {
  await clearPendingVisitStatuses();
}
