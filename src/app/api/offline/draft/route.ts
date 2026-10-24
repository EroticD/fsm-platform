import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { saveDraft } from "@/server/reports";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";

/**
 * Største kladd vi tar imot over nett. Kladden lagres uansett aldri over 1 MB i
 * databasen; denne grensen hindrer at vi i det hele tatt leser og parser en
 * vilkårlig stor JSON-kropp.
 */
const MAX_BODY_BYTES = 2_000_000;

type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; tooLarge: boolean };

/**
 * Leser kroppen med en hard grense. `Content-Length` sjekkes først, men den kan
 * mangle ved chunked overføring – derfor telles bytene mens strømmen leses, og
 * vi avbryter så snart grensen passeres uten å parse noe.
 */
async function readBodyLimited(request: Request): Promise<BodyReadResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return { ok: false, tooLarge: true };
    }
  }

  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(body) };
}

/**
 * Tar imot en kladd fra offline-outboxen. Kladden er allerede lagret i
 * IndexedDB på enheten; dette er bare replay når nettet er tilbake.
 *
 * Ruten bruker samme tjeneste og autorisasjon som den vanlige autolagringen,
 * så en outbox kan ikke omgå avdelings- eller rapporttilgang.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Ugyldig origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  const limit = await allowRequestDb(`offline-draft:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange kladdesendinger" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const read = await readBodyLimited(request);
  if (!read.ok) {
    return read.tooLarge
      ? NextResponse.json({ error: "Kladden er for stor" }, { status: 413 })
      : NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "string") formData.set(key, value);
    else if (value != null) formData.set(key, JSON.stringify(value));
  }

  const result = await saveDraft(user, formData);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
