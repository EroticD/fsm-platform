import { NextResponse } from "next/server";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";
import { logger, requestIdFrom } from "@/lib/logger";

/**
 * Readiness-sjekk for container/orchestrator.
 *
 * Forskjellen fra /api/health (liveness) er at denne også kontrollerer at
 * opplastingsvolumet er skrivbart og at jobbkøen kan leses. En app som svarer
 * på HTTP, men ikke kan lagre bilder eller lese jobber, er ikke klar til trafikk.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFrom(new Headers(request.headers));
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

  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      database,
      disk,
      queue,
      requestId,
      time: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
