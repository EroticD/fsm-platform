import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { getCurrentUser, isOffice } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { moduleApiGuard } from "@/lib/module-guards";
import { exportProfitabilityCsv } from "@/server/bi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV-eksport av lønnsomhetsrapporten. Samme filterparametre som siden, og
 * nøyaktig samme tjenestefunksjon – dermed kan ikke eksporten vise et annet
 * avdelingsomfang enn skjermen.
 */
export async function GET(request: Request) {
  const moduleGuard = await moduleApiGuard("bi");
  if (moduleGuard) return moduleGuard;

  const user = await getCurrentUser();
  if (
    !user?.isActive ||
    !isOffice(user.role) ||
    !hasPermission(user, "reports.view")
  ) {
    return internalApiError("forbidden", 403);
  }

  const url = new URL(request.url);
  const result = await exportProfitabilityCsv(user, {
    from: url.searchParams.get("fra") ?? "",
    to: url.searchParams.get("til") ?? "",
    departmentId: url.searchParams.get("avdeling") ?? "",
    customerId: url.searchParams.get("kunde") ?? "",
    technicianId: url.searchParams.get("tekniker") ?? "",
  });

  if (!result.ok) {
    if (result.reason === "forbidden") return internalApiError("forbidden", 403);
    if (result.reason === "too_large") {
      return internalApiError("export_too_large", 413);
    }
    return internalApiError("invalid_request", 400);
  }

  return new NextResponse(result.data.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.data.fileName}"`,
      "Content-Length": String(Buffer.byteLength(result.data.csv, "utf8")),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
