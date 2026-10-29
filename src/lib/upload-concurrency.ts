/**
 * Prosesslokal grense for lesing av opplastingskropper.
 *
 * En opplasting kan bufres til MAX_REQUEST_BYTES (50 MB PDF + multipart-
 * overhead) før den parses. Uten en grense kan mange samtidige forespørsler
 * spise opp hele Node-prosessens minne. Denne køen slipper derfor bare et
 * lite antall kropper inn i lesefasen om gangen; resten får 503 med
 * Retry-After og kan prøve igjen.
 *
 * Grensen er bevisst per prosess. Med flere replikaer blir den globale
 * grensen MAX_CONCURRENT_UPLOAD_BODY_READS × antall replikaer, så proxy/
 * ingress må fortsatt håndheve egne grenser for kroppsstørrelse, samtidige
 * tilkoblinger og tidsavbrudd. Denne køen erstatter ikke slike grenser.
 */
export const MAX_CONCURRENT_UPLOAD_BODY_READS = Math.max(
  1,
  Number.parseInt(process.env.UPLOAD_BODY_CONCURRENCY ?? "", 10) || 4,
);

/** Antall sekunder klienten bes vente før den prøver opplastingen igjen. */
export const UPLOAD_BODY_RETRY_AFTER_SECONDS = 2;

export type UploadBodyGateState = {
  /** Antall kropper som leses akkurat nå. */
  active: number;
  /** Øvre grense for samtidige kroppslesinger i denne prosessen. */
  max: number;
};

export type UploadBodyLease = {
  /** Frigir plassen. Kan kalles flere ganger uten å påvirke telleren. */
  release: () => void;
};

let active = 0;

export function getUploadBodyGateState(): UploadBodyGateState {
  return { active, max: MAX_CONCURRENT_UPLOAD_BODY_READS };
}

/**
 * Reserverer en leseplass uten å vente. Returnerer `null` når alle plassene
 * er opptatt, slik at rutelaget kan svare 503 umiddelbart i stedet for å la
 * forespørselen henge og holde på en åpen forbindelse.
 */
export function tryAcquireUploadBodySlot(): UploadBodyLease | null {
  if (active >= MAX_CONCURRENT_UPLOAD_BODY_READS) return null;

  active += 1;
  let released = false;

  return {
    release() {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    },
  };
}
