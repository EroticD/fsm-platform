import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/session";
import { exportAuditArchive } from "@/server/audit-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Administrator-eksport av revisjonsloggen som ZIP med manifest og hash-kjede.
 * Ruten er bevisst ikke en server action: filen kan bli stor, og nettleseren
 * skal laste den ned direkte uten å holde hele arkivet i React-treet.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.isActive || user.role !== "ADMIN") {
    return internalApiError("forbidden", 403);
  }

  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("fra")?.trim() || null;
  const dateTo = url.searchParams.get("til")?.trim() || null;
  const departmentId = url.searchParams.get("avdeling")?.trim() || null;

  const result = await exportAuditArchive(user, {
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : null,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : null,
    departmentId,
  });
  if (!result.ok) {
    if (result.reason === "forbidden") return internalApiError("forbidden", 403);
    if (result.reason === "too_large") {
      return internalApiError("export_too_large", 413);
    }
    return internalApiError("invalid_request", 400);
  }

  return new NextResponse(new Uint8Array(result.data.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.data.fileName}"`,
      "Content-Length": String(result.data.buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
