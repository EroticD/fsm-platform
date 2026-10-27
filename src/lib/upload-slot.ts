/**
 * Prosesslokal grense for bildebehandling og skriving av opplastinger.
 *
 * Sharp er CPU- og minnetungt. Uten en grense kan noen samtidige store
 * feltbilder bruke opp hele prosessen. Køen er bevisst liten og deles av alle
 * opplastingsforespørsler i denne prosessen.
 */

export const MAX_CONCURRENT_UPLOADS = Math.max(
  1,
  Number.parseInt(process.env.UPLOAD_CONCURRENCY ?? "", 10) || 2,
);

function mb(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 1024 * 1024;
}

/** Bilder komprimeres uansett; 15 MB er rikelig for et mobilkamera. */
export const MAX_IMAGE_BYTES = mb(process.env.UPLOAD_MAX_IMAGE_MB, 15);

/** Skannede PDF-er kan være større, men 50 MB holder for normal feltbruk. */
export const MAX_DOCUMENT_BYTES = mb(process.env.UPLOAD_MAX_DOCUMENT_MB, 50);

/** Tak for hele multipart-forespørselen, inkludert skjemaets overhead. */
export const MAX_REQUEST_BYTES =
  Math.max(MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES) + 5 * 1024 * 1024;

export function maxBytesForMime(mime: string): number {
  return mime === "application/pdf" ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
}

const waiters: Array<() => void> = [];
let inUse = 0;

export type UploadSlotState = {
  active: number;
  max: number;
  waiting: number;
};

export function getUploadSlotState(): UploadSlotState {
  return { active: inUse, max: MAX_CONCURRENT_UPLOADS, waiting: waiters.length };
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  inUse = Math.max(0, inUse - 1);
}

/** Kjører `fn` med en ledig opplastingsplass. Frigis alltid. */
export async function withUploadSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inUse < MAX_CONCURRENT_UPLOADS) {
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
