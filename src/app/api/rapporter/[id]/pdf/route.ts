import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getServerSession } from "next-auth/next";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import prisma from "@/lib/prisma";
import ReportDocument from "@/components/ReportDocument";

export const runtime = "nodejs";

/** Gjør om "Tore Ligaard AS – Servicerapport" til et trygt filnavn. */
function safeFileName(input: string) {
  const cleaned = input
    .replace(/[æÆ]/g, "ae")
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || "servicerapport";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return new NextResponse("Ikke autentisert", { status: 401 });
  }

  const { id } = await params;

  const viewer = await prisma.user.findUnique({ where: { email: session.user.email } });

  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      templates: true,
      technicians: true,
      reports: {
        include: { units: { orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!workOrder) {
    return new NextResponse("Fant ikke oppdraget", { status: 404 });
  }

  // Kundeportalbrukere kan bare hente rapporter for sin egen kundekonto.
  if (viewer?.role === "CUSTOMER" && workOrder.customerId !== viewer.customerId) {
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

  const branding = await prisma.branding.findFirst().catch(() => null);

  const element = React.createElement(ReportDocument, {
    data: workOrder,
    globalLogoUrl: branding?.logoUrl ?? null,
    globalPrimaryColor: branding?.primaryColor ?? undefined,
    globalCompanyName: branding?.companyName ?? undefined,
    baseUrl,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const asDownload = new URL(request.url).searchParams.get("download") === "1";
  const customerName = workOrder.customer?.name ?? "kunde";
  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = safeFileName(`${customerName}-servicerapport-${datePart}`);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${fileName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
