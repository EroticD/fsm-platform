import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/session";
import { exportEvidenceArchive } from "@/server/evidence-export";
import { moduleApiGuard } from "@/lib/module-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Administrator-eksport av én bevispakke. Oppdrags-id-en valideres i
 * tjenestelaget, og alle filer leses gjennom opplastingsmappens trygge oppslag.
 */
export async function GET(request: Request) {
  const moduleGuard = await moduleApiGuard("auditExport");
  if (moduleGuard) return moduleGuard;
  const user = await getCurrentUser();
  if (!user?.isActive || user.role !== "ADMIN") {
    return internalApiError("forbidden", 403);
  }

  const workOrderId = new URL(request.url).searchParams.get("oppdrag")?.trim();
  if (!workOrderId) return internalApiError("missing_field", 400);

  const result = await exportEvidenceArchive(user, workOrderId);
  if (!result.ok) {
    if (result.reason === "forbidden") return internalApiError("forbidden", 403);
    if (result.reason === "not_found") return internalApiError("not_found", 404);
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
