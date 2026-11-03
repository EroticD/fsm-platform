import { NextResponse } from "next/server";
import { getPublicTrackingEta } from "@/server/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Polling-endepunkt for den offentlige sporingssiden.
 *
 * Tokenet i URL-en er hele autorisasjonen, men gir bare tilgang til den ene
 * visitten. Svaret inneholder verken montørens navn, adresse eller
 * koordinater – bare ETA, planlagt tid og hvor fersk posisjonen er. Et gammelt
 * ping merkes som `stale` i stedet for å presenteres som live.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await getPublicTrackingEta(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return NextResponse.json(
        { error: "for-mange-foresporsler" },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
          },
        },
      );
    }
    return json({ error: "ikke-funnet" }, 404);
  }

  const data = result.data;
  return json({
    status: data.status,
    etaSource: data.etaSource,
    etaMinutes: data.etaMinutes,
    estimatedArrivalAt: data.estimatedArrivalAt?.toISOString() ?? null,
    plannedStartsAt: data.plannedStartsAt.toISOString(),
    lastUpdatedAt: data.lastUpdatedAt?.toISOString() ?? null,
    pingAgeMinutes: data.pingAgeMinutes,
    stale: data.stale,
    hasLivePosition: data.hasLivePosition,
    travelProvider: data.travelProvider,
  });
}
