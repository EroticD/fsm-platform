/**
 * Begrenser hvor mange PDF-er som rendres samtidig.
 *
 * PDF-motoren er CPU-tung, og en stor rapport kan bruke flere hundre
 * millisekunder. Uten en grense kan noen få samtidige nedlastinger bruke opp
 * hele Node-prosessen, slik at resten av appen blir treg. Køen er bevisst
 * liten og lever bare i denne prosessen; den er en beskyttelse mot overlast,
 * ikke en distribuerte jobbkø.
 */

/** Maks antall samtidige PDF-rendringer i denne prosessen. */
export const MAX_CONCURRENT_RENDERS = 2;

const waiters: Array<() => void> = [];
let inUse = 0;

export type RenderQueueState = {
  /** Antall pågående rendringer akkurat nå. */
  active: number;
  /** Øvre grense for samtidige rendringer. */
  max: number;
  /** Antall som venter på en ledig plass. */
  waiting: number;
};

/** Tilstand for tester og helsesjekker. */
export function getRenderQueueState(): RenderQueueState {
  return { active: inUse, max: MAX_CONCURRENT_RENDERS, waiting: waiters.length };
}

function releaseSlot() {
  // Gi plassen direkte til neste som venter, slik at en ny forespørsel ikke
  // kan snike i køen mellom at plassen frigis og at venteren våkner.
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  inUse = Math.max(0, inUse - 1);
}

/**
 * Kjører `fn` når en render-plass er ledig. Plassen frigis alltid, også når
 * rendringen feiler.
 */
export async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inUse < MAX_CONCURRENT_RENDERS) {
    inUse += 1;
  } else {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}
