import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getOrRenderReportPdf } from "@/lib/report-pdf-store";
import { allowRequestDb } from "@/lib/rate-limit-db";

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

  // Maks 10 PDF-visninger per minutt per bruker. Rendering er CPU-tungt, og
  // cachen gjør at gjentatte visninger normalt er billige.
  const limit = await allowRequestDb(`pdf:${viewer.id}`, 10, 60_000);
  if (!limit.allowed) {
    return new NextResponse(
      `For mange PDF-forespørsler. Prøv igjen om ${limit.retryAfterSeconds} sekunder.`,
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

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
  // Vi bruker den konfigurerte adressen, ikke X-Forwarded-Host, som klienten
  // selv kan sette. Bare når appen ikke har noen adresse konfigurert, faller
  // vi tilbake til adressen forespørselen kom inn på.
  const baseUrl =
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    new URL(request.url).origin;

  const pdf = await getOrRenderReportPdf(id, baseUrl);
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
