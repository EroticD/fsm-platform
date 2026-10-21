import { NextResponse } from "next/server";
import { generateDueRecurringWorkOrders } from "@/lib/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manuell/ekstern kjøring av serviceavtale-jobben.
 *
 * Appen starter jobben selv ved oppstart, men denne ruten gjør det mulig å
 * bruke en ekstern cron (eller å teste) uten å vente på neste intervall.
 * Krever `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET er ikke satt" },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 401 });
  }

  const results = await generateDueRecurringWorkOrders();

  return NextResponse.json({
    ok: true,
    generated: results.filter((result) => result.workOrderId).length,
    results,
  });
}

export const POST = GET;
