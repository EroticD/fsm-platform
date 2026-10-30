import { NextResponse } from "next/server";
import { runScheduledJobs } from "@/lib/recurring-scheduler";
import { safeEqual } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manuell/ekstern kjøring av bakgrunnsjobbene: avtalefornyelse, generering av
 * serviceoppdrag og SLA-sveip.
 *
 * Appen starter jobbene selv ved oppstart, men denne ruten gjør det mulig å
 * bruke en ekstern cron (eller å teste) uten å vente på neste intervall.
 * Krever `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const run = await runScheduledJobs();

  return NextResponse.json({
    ok: true,
    generated: run.recurring.filter((result) => result.workOrderId).length,
    renewed: run.lifecycle.renewed,
    expired: run.lifecycle.expired,
    sla: run.sla,
    results: run.recurring,
  });
}

export const POST = GET;
