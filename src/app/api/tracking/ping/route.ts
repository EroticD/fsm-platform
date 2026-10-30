import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { recordLocationPing } from "@/server/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Posisjonsping er små og skal aldri mellomlagres eller replayes offline. */
const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Tar imot ett ferskt posisjonsping fra en innlogget montør.
 *
 * Tjenestelaget avgjør om brukeren faktisk er tildelt visitten, om visitten er
 * EN_ROUTE og om avdelingen har sporing på. Ruten validerer bare formen og
 * setter en egen rate limit per bruker.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return json({ error: "ugyldig-origin" }, 403);
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return json({ error: "ikke-autentisert" }, 401);
  }

  const limit = await allowRequestDb(
    `tracking-ping:${user.id}`,
    30,
    60_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "for-mange-foresporsler" },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  const parsed = await readJsonWithLimit<Record<string, unknown>>(
    request,
    JSON_BODY_LIMIT,
  );
  if (!parsed.ok) {
    return json(
      { error: parsed.status === 413 ? "for-stor-foresporsel" : "ugyldig-data" },
      parsed.status,
    );
  }

  const result = await recordLocationPing(user, {
    visitId: typeof parsed.data?.visitId === "string" ? parsed.data.visitId : "",
    latitude:
      typeof parsed.data?.latitude === "number" ? parsed.data.latitude : NaN,
    longitude:
      typeof parsed.data?.longitude === "number" ? parsed.data.longitude : NaN,
  });

  if (result.ok) {
    return json({
      ok: true,
      recordedAt: result.data.recordedAt.toISOString(),
    });
  }

  switch (result.reason) {
    case "forbidden":
      return json({ error: "ingen-tilgang" }, 403);
    case "not_found":
      return json({ error: "ikke-funnet" }, 404);
    case "rate_limited":
      return json({ error: "for-mange-foresporsler" }, 429);
    case "invalid":
      return json(
        {
          error: "ugyldig-data",
          code:
            result.details &&
            typeof result.details === "object" &&
            "code" in result.details
              ? (result.details as { code?: string }).code
              : undefined,
        },
        400,
      );
    default:
      return json({ error: "ukjent" }, 500);
  }
}
