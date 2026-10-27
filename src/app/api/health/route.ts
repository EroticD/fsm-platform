import { NextResponse } from "next/server";
import { requestIdFrom } from "@/lib/logger";

/**
 * Liveness-sjekk for Docker/orchestrator.
 *
 * Denne ruten skal være billig: den svarer bare på at Node-prosessen lever og
 * kan håndtere forespørsler. Database, disk og jobbkø sjekkes i `/api/ready`,
 * slik at en treg database ikke får containeren til å bli drept og restartet i
 * en løkke.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFrom(new Headers(request.headers));
  return NextResponse.json({
    status: "ok",
    requestId,
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}
