import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasValidBearer } from "@/lib/secrets";
import { logger, requestIdFrom } from "@/lib/logger";
import {
  collectMetrics,
  serializePrometheus,
  type MetricsPrisma,
} from "@/lib/metrics";

/**
 * Beskyttet driftsendepunkt for Prometheus og eksterne prober.
 *
 * `METRICS_SECRET` må være satt; uten den svarer ruten 503, slik at den aldri
 * blir et åpent innsyn i database, kø og disk. Bruk Bearer-token:
 *
 *   curl -H "Authorization: Bearer $METRICS_SECRET" \
 *     http://127.0.0.1:3000/api/metrics
 *
 * Standard er JSON. Prometheus kan scrape `?format=prometheus` (eller sende
 * `Accept: text/plain`). Endepunktet svarer 200 også når noe er galt, slik at
 * hvert signal kan brukes i en egen alarmregel; `fsm_ready` og de øvrige
 * gauge-verdiene viser tilstanden.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFrom(new Headers(request.headers));
  const secret = process.env.METRICS_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      { error: "metrics_disabled", message: "METRICS_SECRET is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!hasValidBearer(request, [secret])) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const snapshot = await collectMetrics({
      prisma: prisma as unknown as MetricsPrisma,
    });
    const wantsPrometheus =
      new URL(request.url).searchParams.get("format") === "prometheus" ||
      request.headers.get("accept")?.includes("text/plain") === true;

    if (wantsPrometheus) {
      return new NextResponse(serializePrometheus(snapshot), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      { ...snapshot, requestId },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Metrics: collection failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "metrics_unavailable", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
