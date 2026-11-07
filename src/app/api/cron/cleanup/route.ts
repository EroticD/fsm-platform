import { NextResponse } from "next/server";
import { cleanupAbandonedUploads } from "@/lib/upload-cleanup";
import { cleanupUploadTempFiles } from "@/lib/upload-multipart";
import { uploadDir } from "@/lib/uploads";
import { safeEqual } from "@/lib/secrets";
import { moduleEnabled } from "@/server/modules";

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

  if (!(await moduleEnabled("documents"))) {
    return NextResponse.json({ error: "module_disabled" }, { status: 404 });
  }

  const result = await cleanupAbandonedUploads();
  // Midlertidige filer fra avbrutte eller krasjede opplastinger skal ikke bli
  // liggende. Aktive opplastinger er langt yngre enn fristen på 24 timer.
  const temp = await cleanupUploadTempFiles({ tempDir: uploadDir() });

  return NextResponse.json({ ok: true, ...result, tempRemoved: temp.removed });
}

export const POST = GET;
