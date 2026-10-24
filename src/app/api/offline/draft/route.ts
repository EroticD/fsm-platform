import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { saveDraft } from "@/server/reports";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";

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

  const body = await request.json().catch(() => null);
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
