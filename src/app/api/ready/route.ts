import { NextResponse } from "next/server";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";
import { logger, requestIdFrom } from "@/lib/logger";
import { hasValidBearer } from "@/lib/secrets";
import { clientIpFrom } from "@/lib/client-ip";
import { allowRequestMemory } from "@/lib/rate-limit-memory";

/**
 * Readiness-sjekk for container/orchestrator.
 *
 * Uautentiserte kall får bare en billig databasekontroll og en kort status –
 * aldri disk- eller køarbeid. Detaljene (skrivbart volum, jobbkø) er gated bak
 * READY_SECRET/CRON_SECRET. Kall uten hemmelighet rate-limites i minnet, slik
 * at ruten ikke kan brukes til å hamre på databasen.
 */
export const dynamic = "force-dynamic";

/** Hvor mange uautentiserte readiness-kall som godtas per IP og minutt. */
const UNAUTHENTICATED_LIMIT = 120;

export async function GET(request: Request) {
  const requestId = requestIdFrom(new Headers(request.headers));
  const authorized = hasValidBearer(request, [
    process.env.READY_SECRET,
    process.env.CRON_SECRET,
  ]);

  if (!authorized) {
    const ip = clientIpFrom(request.headers) ?? "ukjent";
    const limit = allowRequestMemory(
      `ready:${ip}`,
      UNAUTHENTICATED_LIMIT,
      60_000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { status: "throttled" },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    let database: "up" | "down" = "down";
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "up";
    } catch (error) {
      logger.error("Readiness: databasen svarer ikke", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const ready = database === "up";
    return NextResponse.json(
      { status: ready ? "ready" : "not_ready" },
      { status: ready ? 200 : 503 },
    );
  }

  let ready = true;

  let database: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch (error) {
    ready = false;
    logger.error("Readiness: databasen svarer ikke", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let disk: "writable" | "unwritable" = "unwritable";
  try {
    await fs.mkdir(uploadDir(), { recursive: true });
    await fs.access(uploadDir(), constants.W_OK);
    disk = "writable";
  } catch (error) {
    ready = false;
    logger.error("Readiness: opplastingsvolumet er ikke skrivbart", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let queue = { pending: 0, failed: 0 };
  try {
    const [pending, failed] = await Promise.all([
      prisma.documentJob.count({ where: { status: "PENDING" } }),
      prisma.documentJob.count({ where: { status: "FAILED" } }),
    ]);
    queue = { pending, failed };
  } catch (error) {
    ready = false;
    logger.error("Readiness: jobbkøen kan ikke leses", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const status = ready ? "ready" : "not_ready";
  return NextResponse.json(
    {
      status,
      database,
      disk,
      queue,
      requestId,
      time: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
