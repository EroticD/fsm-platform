import { readRequestBodyWithLimit } from "./upload-validation";

/**
 * Små, faste grenser for API-kropper som aldri er store.
 *
 * Uten en egen grense arver rutene den globale proxy-grensen (100 MB), og en
 * innlogget klient kan tvinge serveren til å bufret og parse vilkårlig mye før
 * valideringen i det hele tatt starter. Grensene her er bevisst romslige nok
 * for skjemaene, men små nok til at en misbrukt konto ikke kan spise minnet.
 */
export const JSON_BODY_LIMIT = 64 * 1024;
export const FORM_BODY_LIMIT = 1024 * 1024;

export type LimitedBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 413; reason: "too-large" | "invalid" };

type RawBodyResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; status: 400 | 413; reason: "too-large" | "invalid" };

/**
 * Leser kroppen med både Content-Length- og strømgrense.
 *
 * Content-Length kan mangle (chunked) eller lyve. Derfor sjekkes den bare som
 * en rask forskjerm; den faktiske grensen håndheves mens strømmen leses, før
 * noe blir parset.
 */
async function readRawBody(request: Request, maxBytes: number): Promise<RawBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      return { ok: false, status: 413, reason: "too-large" };
    }
  }

  const result = await readRequestBodyWithLimit(request, maxBytes);
  if (!result.ok) {
    return result.reason === "too-large"
      ? { ok: false, status: 413, reason: "too-large" }
      : { ok: false, status: 400, reason: "invalid" };
  }

  return { ok: true, buffer: result.buffer };
}

/** Leser og parser JSON, men aldri mer enn `maxBytes` byte. */
export async function readJsonWithLimit<T = unknown>(
  request: Request,
  maxBytes: number = JSON_BODY_LIMIT,
): Promise<LimitedBodyResult<T>> {
  const raw = await readRawBody(request, maxBytes);
  if (!raw.ok) return raw;

  try {
    return { ok: true, data: JSON.parse(raw.buffer.toString("utf8")) as T };
  } catch {
    return { ok: false, status: 400, reason: "invalid" };
  }
}

/** Leser multipart/skjemadata, men aldri mer enn `maxBytes` byte. */
export async function readFormDataWithLimit(
  request: Request,
  maxBytes: number = FORM_BODY_LIMIT,
): Promise<LimitedBodyResult<FormData>> {
  const raw = await readRawBody(request, maxBytes);
  if (!raw.ok) return raw;

  const contentType = request.headers.get("content-type");
  if (!contentType) {
    return { ok: false, status: 400, reason: "invalid" };
  }

  try {
    const formData = await new Response(new Uint8Array(raw.buffer), {
      headers: { "content-type": contentType },
    }).formData();
    return { ok: true, data: formData };
  } catch {
    return { ok: false, status: 400, reason: "invalid" };
  }
}
