import { NextResponse } from "next/server";
import type { AccessUser } from "@/lib/access";
import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { attachmentDisposition } from "@/lib/http";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { reportWorkOrderScope } from "@/lib/report-scope";
import { getReportPdfForViewer } from "@/server/reports";

export const runtime = "nodejs";

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
    return apiError(403, "forbidden", "Du har ikke tilgang til rapporter.");
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
    return apiError(404, "not_found", "Fant ikke rapporten.");
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
      return apiError(403, "forbidden", result.message);
    }
    return apiError(404, "not_found", result.message);
  }

  const fileName = result.fileName.toLowerCase().endsWith(".pdf")
    ? result.fileName
    : `${result.fileName}.pdf`;

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentDisposition(fileName),
      "Cache-Control": "no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
