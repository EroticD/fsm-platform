import { NextResponse, type NextRequest } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { auditRequestContext, auditStandalone } from "@/lib/audit";
import { moduleApiGuard } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { exportInvoicesCsv, isInvoiceStatus } from "@/server/invoices";

/**
 * Logger CSV-uttrekket av fakturaer. Fakturaer er regnskapsmateriale med
 * fem års oppbevaringsplikt. En loggfeil skal ikke stoppe eksporten.
 */
async function logInvoiceExport(input: {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    departmentId?: string | null;
  };
  rows: number;
  filename: string;
  filters: { status: string | null; overdue: boolean; customerId: string | null };
}): Promise<void> {
  try {
    await auditStandalone({
      entityType: "Invoice",
      entityId: "eksport",
      action: `Eksporterte ${input.rows} fakturaer som CSV`,
      actor: {
        id: input.user.id,
        name: input.user.name ?? null,
        email: input.user.email ?? null,
        departmentId: input.user.departmentId ?? null,
      },
      actionCode: "invoice.exported",
      retentionClass: "ACCOUNTING_5Y",
      metadata: {
        rows: input.rows,
        filename: input.filename,
        status: input.filters.status,
        overdue: input.filters.overdue,
        customerId: input.filters.customerId,
      },
      context: await auditRequestContext(),
    });
  } catch (error) {
    console.error("[audit] kunne ikke logge invoice.exported", {
      rows: input.rows,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
  const overdue = params.get("overdue") === "1";
  const customerId = params.get("customerId") ?? null;
  const query = params.get("q") ?? undefined;
  const result = await exportInvoicesCsv(user, {
    status,
    overdue,
    query,
    customerId: customerId ?? undefined,
  });
  if (!result.ok) {
    return internalApiError(
      result.reason === "forbidden" ? "forbidden" : "invalid_data",
      result.reason === "forbidden" ? 403 : 400,
    );
  }

  await logInvoiceExport({
    user,
    rows: result.data.count,
    filename: result.data.filename,
    filters: { status, overdue, customerId },
  });

  return new NextResponse(result.data.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.data.filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(result.data.count),
    },
  });
}
