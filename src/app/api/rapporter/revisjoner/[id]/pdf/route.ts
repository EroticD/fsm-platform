import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { attachmentDisposition, inlineDisposition } from "@/lib/http";
import { sanitizePdfActiveContent } from "@/lib/pdf-active-content";
import { getReportRevisionForPdf } from "@/server/report-revisions";
import { moduleApiGuard } from "@/lib/module-guards";

export const runtime = "nodejs";

/**
 * Eksporterer et revisjonsøyeblikksbilde som PDF. Ingenting skrives til
 * databasen eller PDF-cachen – dokumentet bygges utelukkende fra revisjonen.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const moduleGuard = await moduleApiGuard("reports");
  if (moduleGuard) return moduleGuard;
  const viewer = await getCurrentUser();
  if (!viewer?.isActive) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const url = new URL(request.url);

  // Samme regel som for vanlige rapport-PDF-er: standard er vedlegg, og inline
  // brukes bare når den innebygde viseren ber om det og saneringen lykkes.
  const wantsInline =
    url.searchParams.get("inline") === "1" &&
    url.searchParams.get("download") !== "1";

  // Samme tak som for vanlige rapport-PDF-er; rendering er CPU-tungt.
  const limit = await allowRequestDb(`pdf:${viewer.id}`, 10, 60_000);
  if (!limit.allowed) {
    return new NextResponse(
      `Too many PDF requests. Retry in ${limit.retryAfterSeconds} seconds.`,
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const result = await getReportRevisionForPdf(viewer, id);
  if (!result.ok) {
    return new NextResponse(
      result.error === "forbidden" ? "Forbidden" : "Revision not found",
      { status: result.error === "forbidden" ? 403 : 404 },
    );
  }

  const { workOrder, ...revision } = result.data;
  const pdf = await (
    await import("@/lib/report-pdf")
  ).renderReportRevisionPdf(
    {
      ...workOrder,
      customer: workOrder.customerName
        ? { name: workOrder.customerName }
        : null,
    },
    revision,
  );

  const sanitized = await sanitizePdfActiveContent(pdf.buffer);
  if (!sanitized.ok) {
    return new NextResponse("PDF contains active content", { status: 422 });
  }

  const fileName = pdf.fileName.toLowerCase().endsWith(".pdf")
    ? pdf.fileName
    : `${pdf.fileName}.pdf`;

  return new NextResponse(new Uint8Array(sanitized.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      // Direkte lenker er vedlegg. Revisjonsviseren får inline bare etter at
      // aktivt innhold er sanert eller fjernet ovenfor.
      "Content-Disposition": wantsInline
        ? inlineDisposition(fileName)
        : attachmentDisposition(fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
