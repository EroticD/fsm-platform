import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger, requestIdFrom } from "@/lib/logger";

// Helsesjekk for Docker/orchestrator: svarer 200 bare hvis databasen er tilgjengelig.
// Ruten krever ikke innlogging, slik at containeren kan sjekke seg selv.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFrom(new Headers(request.headers));
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "up",
      requestId,
      time: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Helsesjekk feilet", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: "error", database: "down", requestId },
      { status: 503 },
    );
  }
}
