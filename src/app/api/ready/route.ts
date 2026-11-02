import { NextResponse } from "next/server";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";
import { logger, requestIdFrom } from "@/lib/logger";
import { hasValidBearer } from "@/lib/secrets";
import { clientIpFrom } from "@/lib/client-ip";
import { allowRequestMemory } from "@/lib/rate-limit-memory";
import {
  roleCanDdl,
  runtimeRoleIsUnsafe,
  type DatabaseRoleInfo,
} from "@/lib/db-roles";

/**
 * Readiness-sjekk for container/orchestrator.
 *
 * Uautentiserte kall får en billig database- og rollekontroll og en kort
 * status – aldri disk- eller køarbeid. Rollekontrollen gjør at
 * Compose-healthchecken blir unhealthy når runtime-rollen kan DDL, uten å
 * avsløre detaljer. Detaljene (rolle, skrivbart volum, jobbkø) er gated bak
 * READY_SECRET/CRON_SECRET. Kall uten hemmelighet rate-limites i minnet, slik
 * at ruten ikke kan brukes til å hamre på databasen.
 */
export const dynamic = "force-dynamic";

/** Hvor mange uautentiserte readiness-kall som godtas per IP og minutt. */
const UNAUTHENTICATED_LIMIT = 120;

/**
 * Leser rollen appen faktisk er koblet til. Kalles også for uautentiserte
 * kall, slik at Compose-healthchecken blir unhealthy når runtime-rollen kan
 * endre skjema. Detaljene returneres bare til autentiserte kall.
 */
async function inspectDatabaseRole(
  requestId: string,
): Promise<DatabaseRoleInfo | null> {
  try {
    const rows = await prisma.$queryRaw<DatabaseRoleInfo[]>`
      SELECT current_user AS "currentUser",
             r.rolsuper AS "superuser",
             r.rolcreatedb AS "createDb",
             r.rolcreaterole AS "createRole",
             has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate"
      FROM pg_roles r
      WHERE r.rolname = current_user
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    logger.error("Readiness: database role cannot be inspected", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFrom(new Headers(request.headers));
  const authorized = hasValidBearer(request, [
    process.env.READY_SECRET,
    process.env.CRON_SECRET,
  ]);

  if (!authorized) {
    const ip = clientIpFrom(request.headers) ?? "unknown";
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
      logger.error("Readiness: database is not responding", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const role = database === "up" ? await inspectDatabaseRole(requestId) : null;
    const roleCheckRequired = process.env.NODE_ENV === "production";
    const ready =
      database === "up" &&
      (!roleCheckRequired || role !== null) &&
      !runtimeRoleIsUnsafe(role);
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
    logger.error("Readiness: database is not responding", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const inspectedRole =
    database === "up" ? await inspectDatabaseRole(requestId) : null;
  const databaseRole = inspectedRole
    ? { ...inspectedRole, canDdl: roleCanDdl(inspectedRole) }
    : null;

  if (database === "up" && !inspectedRole) {
    // Rollen kunne ikke leses. Det er tryggere å være ikke-klar enn å anta at
    // den er DML-only.
    ready = false;
  }

  if (databaseRole && runtimeRoleIsUnsafe(databaseRole)) {
    ready = false;
    logger.error("Readiness: runtime database role can change schema", {
      requestId,
      role: databaseRole.currentUser,
      canDdl: databaseRole.canDdl,
      hint: "Run scripts/provision-db-roles.sh or set ALLOW_DB_DDL_ROLE=true deliberately.",
    });
  }

  let disk: "writable" | "unwritable" = "unwritable";
  try {
    await fs.mkdir(uploadDir(), { recursive: true });
    await fs.access(uploadDir(), constants.W_OK);
    disk = "writable";
  } catch (error) {
    ready = false;
    logger.error("Readiness: upload volume is not writable", {
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
    logger.error("Readiness: document job queue cannot be read", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const status = ready ? "ready" : "not_ready";
  return NextResponse.json(
    {
      status,
      database,
      databaseRole,
      disk,
      queue,
      requestId,
      time: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
