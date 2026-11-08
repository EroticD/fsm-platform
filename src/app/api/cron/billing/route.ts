import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/secrets";
import { moduleEnabled } from "@/server/modules";
import { expireQuotes } from "@/server/quotes";
import { markOverdueInvoices } from "@/server/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Planlagt vedlikehold for tilbud og faktura. Kjøres med samme `CRON_SECRET`
 * som de øvrige cron-rutene. Begge operasjonene er idempotente, og modulene
 * kan slås av uavhengig av hverandre.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const [quotesOn, invoicingOn] = await Promise.all([
    moduleEnabled("quotes"),
    moduleEnabled("invoicing"),
  ]);
  if (!quotesOn && !invoicingOn) {
    return NextResponse.json({ error: "module_disabled" }, { status: 404 });
  }

  const expiredQuotes = quotesOn ? await expireQuotes() : 0;
  const overdueInvoices = invoicingOn ? await markOverdueInvoices() : 0;
  return NextResponse.json({ ok: true, expiredQuotes, overdueInvoices });
}

export const POST = GET;
