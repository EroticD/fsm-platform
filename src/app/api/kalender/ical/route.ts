import { NextResponse } from "next/server";
import { getCalendarFeed } from "@/server/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * Read-only iCal-feed. Tokenet i URL-en er hemmeligheten; det kan tilbakekalles
 * fra innstillingene. Ruten er bevisst utenfor sesjonsinnlogging, slik at
 * Google Calendar/Outlook kan abonnere.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const feed = await getCalendarFeed(token);

  if (!feed) {
    return new NextResponse("Ugyldig eller tilbakekalt kalenderlenke", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new NextResponse(feed, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="fsm-kalender.ics"',
      "Cache-Control": "no-store",
    },
  });
}
