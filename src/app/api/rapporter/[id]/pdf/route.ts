import { NextResponse } from "next/server";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { loadReportPdf } from "@/lib/report-pdf";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getCurrentUser();
  if (!viewer?.isActive) {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }

  const { id } = await params;

  if (viewer.role !== "CUSTOMER" && !hasPermission(viewer, "reports.view")) {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }

  // Kundeportalbrukere kan bare hente rapporter for sin egen kundekonto.
  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    select: { customerId: true, status: true, reports: { select: { id: true } } },
  });

  if (!workOrder) {
    return new NextResponse("Fant ikke oppdraget", { status: 404 });
  }

  if (viewer.role === "CUSTOMER" && workOrder.customerId !== viewer.customerId) {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }
  if (viewer.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }

  if (workOrder.reports.length === 0) {
    return new NextResponse("Oppdraget har ingen rapport ennå", { status: 404 });
  }

  // Bilder ligger som /uploads/... og må gjøres absolutte for PDF-motoren.
  const requestHeaders = await headers();
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const baseUrl = host ? `${proto}://${host}` : new URL(request.url).origin;

  const pdf = await loadReportPdf(id, baseUrl);
  if (!pdf) {
    return new NextResponse("Oppdraget har ingen rapport ennå", { status: 404 });
  }

  const asDownload = new URL(request.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${pdf.fileName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
