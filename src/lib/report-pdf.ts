import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import prisma from "@/lib/prisma";
import ReportDocument from "@/components/ReportDocument";
import { buildPdfImages, collectReportImageUrls } from "@/lib/report-images";
import { formatDate } from "@/lib/dates";

export type ReportPdfResult = {
  buffer: Buffer;
  fileName: string;
  /**
   * `/uploads/...` når PDF-en er lagret og registrert. Brukes når PDF-en skal
   * legges ved et annet oppdrag, slik at den ikke må skrives på nytt.
   */
  url?: string;
};

/** Gjør om «Tore Ligaard AS – Servicerapport» til et trygt filnavn. */
export function safeReportFileName(input: string): string {
  const cleaned = input
    .replace(/[æÆ]/g, "ae")
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || "servicerapport";
}

/** Filnavnet (uten `.pdf`) for rapporten til et oppdrag. */
export function reportFileNameForWorkOrder(workOrder: {
  customer?: { name?: string | null } | null;
  scheduledFor?: Date | null;
}): string {
  // Bruk oppdragets dato når det finnes, slik at PDF-en fra et intervall får
  // et stabilt navn også når den legges ved neste oppdrag.
  const datePart =
    formatDate(workOrder.scheduledFor) ||
    formatDate(new Date()) ||
    new Date().toISOString().slice(0, 10);
  const customerName = workOrder.customer?.name ?? "kunde";
  return safeReportFileName(`${customerName}-servicerapport-${datePart}`);
}

/**
 * Rendrer rapporten for et oppdrag til en PDF.
 *
 * Brukes både av PDF-ruten og av serviceavtale-generatoren, slik at den
 * vedlagte PDF-en i et nytt oppdrag blir nøyaktig samme dokument som brukeren
 * kan laste ned fra det forrige oppdraget.
 */
export async function loadReportPdf(
  workOrderId: string,
  baseUrl?: string,
): Promise<ReportPdfResult | null> {
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
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

  if (!workOrder || workOrder.reports.length === 0) return null;

  const branding = await prisma.branding.findFirst().catch(() => null);

  // Bildene skaleres ned på forhånd, slik at PDF-en blir til å sende på e-post.
  const pdfImages = await buildPdfImages(collectReportImageUrls(workOrder.reports));

  const origin =
    baseUrl ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  const element = React.createElement(ReportDocument, {
    data: workOrder,
    globalLogoUrl: branding?.logoUrl ?? null,
    globalPrimaryColor: branding?.primaryColor ?? undefined,
    globalCompanyName: branding?.companyName ?? undefined,
    baseUrl: origin,
    pdfImages,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  return { buffer, fileName: reportFileNameForWorkOrder(workOrder) };
}
