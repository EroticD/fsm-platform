import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getPushAdminStatus } from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Trygg driftsoppsummering for innstillingene. Aldri tokens eller nøkler. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isActive) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const result = await getPushAdminStatus(user);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      ok: true,
      ...result.data,
      lastSentAt: result.data.lastSentAt?.toISOString() ?? null,
    },
    { headers: NO_STORE },
  );
}
