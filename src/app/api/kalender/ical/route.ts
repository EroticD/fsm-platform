import { NextResponse } from "next/server";
import { getCalendarFeed } from "@/server/calendar-feed";

export const dynamic = "force-dynamic";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
} as const;

/**
 * Read-only iCal-feed. Tokenet i URL-en er hemmeligheten; det kan tilbakekalles
 * fra innstillingene. Ruten er bevisst utenfor sesjonsinnlogging, slik at
 * Google Calendar/Outlook kan abonnere.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await getCalendarFeed(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return new NextResponse("For mange forespørsler", {
        status: 429,
        headers: {
          ...SECURITY_HEADERS,
          "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
        },
      });
    }
    return new NextResponse("Ugyldig eller tilbakekalt kalenderlenke", {
      status: 401,
      headers: SECURITY_HEADERS,
    });
  }

  return new NextResponse(result.feed, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="fsm-kalender.ics"',
    },
  });
}
