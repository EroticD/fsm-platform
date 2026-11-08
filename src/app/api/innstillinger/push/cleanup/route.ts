import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { clearStalePushDevices } from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Sletter deaktiverte og foreldede enheter. Kaskaderer til push-utboksen. */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "invalid-origin" }, { status: 403, headers: NO_STORE });
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const limit = await allowRequestDb(`push-cleanup:${user.id}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate-limited" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const result = await clearStalePushDevices(user);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403, headers: NO_STORE });
  }

  return NextResponse.json({ ok: true, ...result.data }, { headers: NO_STORE });
}
