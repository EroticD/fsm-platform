import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { auditRequestContext, auditStandalone } from "@/lib/audit";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { attachmentDisposition, inlineDisposition } from "@/lib/http";
import { sanitizePdfActiveContent } from "@/lib/pdf-active-content";
import { getReportPdfForViewer } from "@/server/reports";
import { moduleApiGuard } from "@/lib/module-guards";

export const runtime = "nodejs";

/**
 * Revisjonslogg for PDF-visning. En feil her skal aldri hindre at PDF-en
 * leveres; avviket rapporteres til operatør med handlingens kode.
 */
async function logReportPdfView(input: {
  viewer: {
    id: string;
    name?: string | null;
    email?: string | null;
    departmentId?: string | null;
  };
  reportId: string;
  workOrderId: string;
  inline: boolean;
}): Promise<void> {
  try {
    await auditStandalone({
      entityType: "Report",
      entityId: input.reportId,
      action: "Viste rapport-PDF",
      actor: {
        id: input.viewer.id,
        name: input.viewer.name ?? null,
        email: input.viewer.email ?? null,
        departmentId: input.viewer.departmentId ?? null,
      },
      actionCode: "report.pdf.viewed",
      metadata: {
        workOrderId: input.workOrderId,
        delivery: input.inline ? "inline" : "attachment",
      },
      context: await auditRequestContext(),
    });
  } catch (error) {
    console.error("[audit] kunne ikke logge report.pdf.viewed", {
      reportId: input.reportId,
      workOrderId: input.workOrderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Henter (og eventuelt rendrer) rapport-PDF-en for et oppdrag. Tilgang,
 * kundeavgrensning og PDF-cache ligger i `getReportPdfForViewer`.
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
  const reportId = url.searchParams.get("rapport")?.trim() || undefined;

  // Standard er et trygt vedlegg. Bare den innebygde viseren ber eksplisitt om
  // inline, og aldri dersom samme forespørsel også ber om nedlasting.
  const wantsInline =
    url.searchParams.get("inline") === "1" &&
    url.searchParams.get("download") !== "1";

  // Rapport-id-en brukes direkte i oppslaget og må derfor være en trygg id.
  if (reportId && !/^[A-Za-z0-9_-]{1,64}$/.test(reportId)) {
    return new NextResponse("Invalid report id", { status: 400 });
  }

  // Maks 10 PDF-visninger per minutt per bruker. Rendering er CPU-tungt, og
  // cachen gjør at gjentatte visninger normalt er billige.
  const limit = await allowRequestDb(`pdf:${viewer.id}`, 10, 60_000);
  if (!limit.allowed) {
    return new NextResponse(
      `Too many PDF requests. Retry in ${limit.retryAfterSeconds} seconds.`,
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // `getReportPdfForViewer` kontrollerer at rapporten tilhører oppdraget,
  // kunden og brukerens tilgang før PDF-en leses fra cachen eller rendres.
  const result = await getReportPdfForViewer(viewer, id, reportId);
  if (!result.ok) {
    return new NextResponse(result.message, { status: result.status });
  }

  // Rapporter kan inneholde aktivt innhold dersom en fremmed PDF er blitt
  // lagt inn i flyten. Aktivt innhold saneres eller avvises før filen sendes.
  const sanitized = await sanitizePdfActiveContent(result.buffer);
  if (!sanitized.ok) {
    return new NextResponse("PDF contains active content", { status: 422 });
  }

  const fileName = result.fileName.toLowerCase().endsWith(".pdf")
    ? result.fileName
    : `${result.fileName}.pdf`;

  await logReportPdfView({
    viewer,
    reportId: reportId ?? id,
    workOrderId: id,
    inline: wantsInline,
  });

  return new NextResponse(new Uint8Array(sanitized.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      // Direkte lenker er alltid vedlegg. Kun den innebygde viseren får inline,
      // og først etter at aktivt innhold er sanert eller fjernet ovenfor.
      "Content-Disposition": wantsInline
        ? inlineDisposition(fileName)
        : attachmentDisposition(fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
