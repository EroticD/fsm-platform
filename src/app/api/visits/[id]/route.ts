import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { moveVisit } from "@/server/visits";

/** ISO 8601 med dato og klokkeslett. FullCalendar sender alltid dette. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (!ISO_DATE_TIME.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function conflictCode(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function conflicts(details: unknown): unknown[] | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { conflicts?: unknown }).conflicts;
  return Array.isArray(value) ? value : undefined;
}

/**
 * Intern rute for dra/resize i kalenderen. Den er øktbasert og bruker samme
 * tjenestelag som resten av appen; den offentlige v1-API-et har egen
 * autentisering og skal ikke dele denne ruten.
 *
 * `moveVisit` kontrollerer `workorders.assign`, avdelingsscope, låste
 * oppdrag/visiter og overlapp på nytt. Ruten oversetter bare resultatet til
 * stabile HTTP-feilkoder.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "ugyldig-origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ikke-autentisert" }, { status: 401 });
  }

  if (!user.isActive || !hasPermission(user, "workorders.assign")) {
    return NextResponse.json({ error: "ingen-tilgang" }, { status: 403 });
  }

  // Samme tak som de andre små mutasjonsrutene. Grensen ligger før kroppen
  // leses, slik at en misbrukt konto ikke kan bruke parsing som DoS-vektor.
  const limit = await allowRequestDb(`visit-move:${user.id}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "for-mange-foresporsler" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ikke-funnet" }, { status: 404 });
  }

  const parsed = await readJsonWithLimit<Record<string, unknown>>(
    request,
    JSON_BODY_LIMIT,
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "for-stor-foresporsel" : "ugyldig-data" },
      { status: parsed.status },
    );
  }

  const startsAt = parseInstant(parsed.data?.startsAt);
  const endsAt = parseInstant(parsed.data?.endsAt);
  if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json(
      { error: "ugyldig-data", code: "visits.errors.invalidTimeRange" },
      { status: 400 },
    );
  }

  const result = await moveVisit(user, id, { startsAt, endsAt });

  if (result.ok) {
    return NextResponse.json({
      success: true,
      visit: {
        id: result.data.id,
        startsAt: result.data.startsAt.toISOString(),
        endsAt: result.data.endsAt.toISOString(),
      },
    });
  }

  const code = conflictCode(result.details);

  switch (result.reason) {
    case "forbidden":
      return NextResponse.json({ error: "ingen-tilgang" }, { status: 403 });
    case "not_found":
      return NextResponse.json({ error: "ikke-funnet" }, { status: 404 });
    case "invalid":
      return NextResponse.json(
        { error: "ugyldig-data", code },
        { status: 400 },
      );
    case "conflict":
      return NextResponse.json(
        { error: "konflikt", code, conflicts: conflicts(result.details) },
        { status: 409 },
      );
    case "rate_limited":
      return NextResponse.json(
        { error: "for-mange-foresporsler" },
        { status: 429 },
      );
    default:
      return NextResponse.json({ error: "ukjent" }, { status: 500 });
  }
}
