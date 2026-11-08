import { NextResponse } from "next/server";
import { cleanupAbandonedUploads } from "@/lib/upload-cleanup";
import { releaseExpiredUploadQuotaReservations } from "@/lib/upload-quota";
import { cleanupUploadTempFiles } from "@/lib/upload-multipart";
import { uploadTempDir } from "@/lib/uploads";
import prisma from "@/lib/prisma";
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

  // SAML-cachen skal ryddes uavhengig av dokumentmodulen. En utløpt
  // AuthnRequest/replay-rad er død og skal ikke bli liggende.
  const samlCacheRemoved = await prisma.samlCacheEntry
    .deleteMany({ where: { expiresAt: { lte: new Date() } } })
    .then((result) => result.count)
    .catch(() => 0);

  if (!(await moduleEnabled("documents"))) {
    return NextResponse.json({ error: "module_disabled", samlCacheRemoved }, { status: 404 });
  }

  const result = await cleanupAbandonedUploads();
  // Reservasjoner fra krasjede eller avbrutte opplastinger må ikke låse
  // kvoten. Aktive opplastinger er langt yngre enn reservasjonens levetid.
  const reservationsReleased = await releaseExpiredUploadQuotaReservations();
  // Midlertidige filer fra avbrutte eller krasjede opplastinger skal ikke bli
  // liggende. Aktive opplastinger er langt yngre enn fristen på 24 timer.
  const temp = await cleanupUploadTempFiles({ tempDir: uploadTempDir() });

  return NextResponse.json({
    ok: true,
    ...result,
    reservationsReleased,
    tempRemoved: temp.removed,
    samlCacheRemoved,
  });
}

export const POST = GET;
