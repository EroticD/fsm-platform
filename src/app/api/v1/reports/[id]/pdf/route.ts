import { NextResponse } from "next/server";
import type { AccessUser } from "@/lib/access";
import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { auditRequestContext, auditStandalone } from "@/lib/audit";
import { attachmentDisposition } from "@/lib/http";
import { sanitizePdfActiveContent } from "@/lib/pdf-active-content";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { reportWorkOrderScope } from "@/lib/report-scope";
import { getReportPdfForViewer } from "@/server/reports";

export const runtime = "nodejs";

/** Best effort: revisjonsloggen skal aldri velte et API-svar. */
async function logReportPdfView(input: {
  actor: {
    id: string;
    name?: string | null;
    email?: string | null;
    departmentId?: string | null;
  };
  reportId: string;
  workOrderId: string;
}): Promise<void> {
  try {
    await auditStandalone({
      entityType: "Report",
      entityId: input.reportId,
      action: "Viste rapport-PDF via API",
      actor: {
        id: input.actor.id,
        name: input.actor.name ?? null,
        email: input.actor.email ?? null,
        departmentId: input.actor.departmentId ?? null,
      },
      actionCode: "report.pdf.viewed",
      metadata: {
        workOrderId: input.workOrderId,
        channel: "api",
      },
      context: await auditRequestContext(),
    });
  } catch (error) {
    console.error("[audit] kunne ikke logge report.pdf.viewed (API)", {
      reportId: input.reportId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * PDF-en for én rapport.
 *
 * API-nøkkelen autentiseres og rate-limites av `authenticateApiRequest`.
 * Rapportens oppdrag slås opp gjennom rapportomfanget først, slik at en
 * rapport utenfor egen avdeling gir 404 uten å kalle PDF-tjenesten.
 * Tjenesten kontrollerer deretter de samme reglene på nytt, inkludert
 * kansellerte oppdrag og kundens egne rapporter.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "reports.view")) {
    return apiError("forbidden", 403, { messageKey: "errors.api.reports.forbidden" });
  }

  const { id } = await params;
  const report = await prisma.report.findFirst({
    where: {
      id,
      deletedAt: null,
      workOrder: {
        AND: [reportWorkOrderScope(auth.actor), { deletedAt: null }],
      },
    },
    select: { id: true, workOrderId: true },
  });
  if (!report) {
    return apiError("not_found", 404, { messageKey: "errors.api.reports.notFound" });
  }

  // Tjenestelaget er skrevet for øktbrukeren, men trenger bare feltene
  // ServiceActor allerede har. API-nøkkelen er allerede validert, så casten
  // tilfører ingen nye rettigheter.
  const result = await getReportPdfForViewer(
    auth.actor as unknown as AccessUser,
    report.workOrderId,
    report.id,
  );

  if (!result.ok) {
    if (result.status === 403) {
      return apiError("forbidden", 403, { message: result.message });
    }
    return apiError("not_found", 404, { message: result.message });
  }

  const sanitized = await sanitizePdfActiveContent(result.buffer);
  if (!sanitized.ok) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.reports.activeContent",
    });
  }

  const fileName = result.fileName.toLowerCase().endsWith(".pdf")
    ? result.fileName
    : `${result.fileName}.pdf`;

  await logReportPdfView({
    actor: auth.actor,
    reportId: report.id,
    workOrderId: report.workOrderId,
  });

  return new NextResponse(new Uint8Array(sanitized.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentDisposition(fileName),
      "Cache-Control": "no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
