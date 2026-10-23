import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { getReportPdfForViewer } from "@/server/reports";

export const runtime = "nodejs";

/**
 * Henter (og eventuelt rendrer) rapport-PDF-en for et oppdrag. Tilgang,
 * kundeavgrensning og PDF-cache ligger i `getReportPdfForViewer`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getCurrentUser();
  if (!viewer?.isActive) {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }

  const { id } = await params;

  // Maks 10 PDF-visninger per minutt per bruker. Rendering er CPU-tungt, og
  // cachen gjør at gjentatte visninger normalt er billige.
  const limit = await allowRequestDb(`pdf:${viewer.id}`, 10, 60_000);
  if (!limit.allowed) {
    return new NextResponse(
      `For mange PDF-forespørsler. Prøv igjen om ${limit.retryAfterSeconds} sekunder.`,
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const result = await getReportPdfForViewer(viewer, id, request.url);
  if (!result.ok) {
    return new NextResponse(result.message, { status: result.status });
  }

  const asDownload = new URL(request.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${result.fileName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
