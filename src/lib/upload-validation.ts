/**
 * Håndhever størrelsesgrensen på selve strømmen, ikke bare Content-Length.
 *
 * En klient kan utelate Content-Length (chunked) eller oppgi en mindre verdi
 * enn den faktisk sender. Da må vi stoppe så snart vi har lest mer enn grensen,
 * før hele forespørselen er bufret i minnet.
 */
export type LimitedBodyResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "too-large" | "empty" | "unreadable" };

export async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<LimitedBodyResult> {
  const body = request.body;
  if (!body) return { ok: false, reason: "empty" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return { ok: false, reason: "empty" };
  return { ok: true, buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) };
}

/**
 * Gjenkjenner filtypen fra de første bytene. Filnavn og `Content-Type` fra
 * klienten er bare påstander; de kan ikke brukes til å velge hvordan filen
 * lagres eller serveres.
 */
export function sniffFileMime(buffer: Uint8Array): string | null {
  const startsWith = (bytes: number[], offset = 0) =>
    bytes.every((byte, index) => buffer[offset + index] === byte);

  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif"; // GIF8
  if (
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    startsWith([0x57, 0x45, 0x42, 0x50], 8) // RIFF....WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/** Er filinnholdet faktisk den typen klienten hevder? */
export function declaredMimeMatches(
  declaredMime: string,
  actualMime: string | null,
): boolean {
  if (!actualMime) return false;
  return declaredMime.toLowerCase() === actualMime.toLowerCase();
}
