import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  registerPushDevice,
  unregisterPushDevice,
} from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function guard(request: Request) {
  if (!assertSameOrigin(request)) {
    return { response: json({ error: "invalid-origin" }, 403) };
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return { response: json({ error: "unauthenticated" }, 401) };
  }

  const limit = await allowRequestDb(
    `mobile-push-tokens:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return {
      response: NextResponse.json(
        { error: "rate-limited" },
        {
          status: 429,
          headers: {
            ...NO_STORE,
            "Retry-After": String(limit.retryAfterSeconds),
          },
        },
      ),
    };
  }

  return { user };
}

async function body(request: Request) {
  const parsed = await readJsonWithLimit<Record<string, unknown>>(
    request,
    JSON_BODY_LIMIT,
  );
  if (!parsed.ok) {
    return {
      response: json(
        {
          error:
            parsed.status === 413 ? "payload-too-large" : "invalid-request",
        },
        parsed.status,
      ),
    };
  }
  return { data: parsed.data ?? {} };
}

/**
 * Registrerer en push-enhet for den innloggede brukeren.
 *
 * Ruten godtar bare en aktiv økt fra samme opphav, validerer lengder og
 * tegnsett og rate-limiter per bruker. Selve tokenet returneres aldri og
 * skrives aldri til logger eller revisjon.
 */
export async function POST(request: Request) {
  const auth = await guard(request);
  if ("response" in auth) return auth.response;

  const parsed = await body(request);
  if ("response" in parsed) return parsed.response;

  const result = await registerPushDevice(auth.user, {
    token: parsed.data.token,
    platform: parsed.data.platform,
    appVersion: parsed.data.appVersion,
    deviceId: parsed.data.deviceId,
  });

  if (result.ok) {
    return json({
      ok: true,
      device: {
        id: result.data.id,
        platform: result.data.platform,
        appVersion: result.data.appVersion,
        active: result.data.active,
        lastSeenAt: result.data.lastSeenAt.toISOString(),
      },
    });
  }

  switch (result.reason) {
    case "forbidden":
      return json({ error: "forbidden" }, 403);
    default:
      return json({ error: "invalid-device" }, 400);
  }
}

/** Avregistrerer en enhet. Idempotent: ukjent token gir fortsatt 200. */
export async function DELETE(request: Request) {
  const auth = await guard(request);
  if ("response" in auth) return auth.response;

  const parsed = await body(request);
  if ("response" in parsed) return parsed.response;

  const result = await unregisterPushDevice(auth.user, {
    token: parsed.data.token,
    platform: parsed.data.platform,
  });

  if (result.ok) {
    return json({ ok: true, removed: result.data.removed });
  }
  if (result.reason === "forbidden") {
    return json({ error: "forbidden" }, 403);
  }
  return json({ error: "invalid-device" }, 400);
}
