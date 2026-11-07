import { NextResponse, type NextRequest } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { moduleApiGuard } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { exportInvoicesCsv, isInvoiceStatus } from "@/server/invoices";

/**
 * CSV-eksport for regnskap. Eksporten er lesende og idempotent: samme filtre
 * gir samme fil så lenge fakturaene ikke er endret. Ingen ekstern PSP er
 * involvert.
 */
export async function GET(request: NextRequest) {
  const guard = await moduleApiGuard("invoicing");
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user?.isActive) return internalApiError("forbidden", 403);

  const params = request.nextUrl.searchParams;
  const rawStatus = params.get("status");
  const status = rawStatus && isInvoiceStatus(rawStatus) ? rawStatus : null;
  const result = await exportInvoicesCsv(user, {
    status,
    overdue: params.get("overdue") === "1",
    query: params.get("q") ?? undefined,
    customerId: params.get("customerId") ?? undefined,
  });
  if (!result.ok) {
    return internalApiError(
      result.reason === "forbidden" ? "forbidden" : "invalid_data",
      result.reason === "forbidden" ? 403 : 400,
    );
  }

  return new NextResponse(result.data.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.data.filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(result.data.count),
    },
  });
}
