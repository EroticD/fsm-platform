import { NextResponse } from "next/server";
import {
  guardTransferRoute,
  requireSameOrigin,
  transferFailureResponse,
  transferRateLimit,
} from "@/lib/customer-transfer/http";
import { downloadExportPackage } from "@/server/customer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardTransferRoute();
  if (!guard.ok) return guard.response;
  const { jobId } = await params;

  // Nedlasting er en GET, men samme-origin-sjekken hindrer at en fremmed side
  // kan trigge en nedlasting i en innlogget administratørs nettleser.
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  const limited = await transferRateLimit(
    `customer-transfer-download:${jobId}`,
    10,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  const result = await downloadExportPackage(guard.actor, jobId);
  if (!result.ok) return transferFailureResponse(result);

  return new NextResponse(new Uint8Array(result.data.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.data.fileName}"`,
      "Content-Length": String(result.data.buffer.length),
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "X-Package-Sha256": result.data.checksum,
    },
  });
}
