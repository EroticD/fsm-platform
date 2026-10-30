import { NextResponse } from "next/server";
import { cleanupAbandonedUploads } from "@/lib/upload-cleanup";
import { safeEqual } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rydder opplastinger som aldri ble knyttet til et dokument, vedlegg eller en
 * rapport. Kjøres med samme `CRON_SECRET` som de andre cron-rutene.
 *
 * `releaseUpload` kontrollerer alle referanser på nytt, inkludert
 * rapportrevisjoner og kladder, så en fil som fortsatt brukes blir liggende.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const result = await cleanupAbandonedUploads();

  return NextResponse.json({ ok: true, ...result });
}

export const POST = GET;
