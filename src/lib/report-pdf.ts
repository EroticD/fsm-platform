import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import prisma from "@/lib/prisma";
import ReportDocument from "@/components/ReportDocument";
import {
  buildPdfImagesDetailed,
  collectReportImageUrls,
  isEmbeddedImageUrl,
} from "@/lib/report-images";
import { formatDate } from "@/lib/dates";
import { isSafeLogoUrl } from "@/lib/logo";
import {
  BRANDING_LOGO_OWNER_TYPES,
  REPORT_IMAGE_OWNER_TYPES,
  isUploadOwnedBy,
} from "@/lib/upload-ownership";
import {
  revisionToDocumentData,
  type RevisionSnapshotSource,
} from "@/lib/report-revision";

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
export function reportFileNameForWorkOrder(
  workOrder: {
    customer?: { name?: string | null } | null;
    scheduledFor?: Date | string | null;
    orderNumber?: string | null;
  },
  reportName?: string | null,
): string {
  // Bruk oppdragets dato når det finnes, slik at PDF-en fra et intervall får
  // et stabilt navn også når den legges ved neste oppdrag.
  const datePart =
    formatDate(workOrder.scheduledFor) ||
    formatDate(new Date()) ||
    new Date().toISOString().slice(0, 10);
  const customerName = workOrder.customer?.name ?? "kunde";
  const titlePart = safeReportFileName(reportName || "servicerapport");
  const orderPart = workOrder.orderNumber
    ? `-${safeReportFileName(workOrder.orderNumber)}`
    : "";
  return safeReportFileName(
    `${customerName}-${titlePart}${orderPart}-${datePart}`,
  );
}

/** Filnavn for en eksportert revisjon, uten å skrive noe til databasen. */
export function reportRevisionFileName(
  workOrder: {
    customer?: { name?: string | null } | null;
    scheduledFor?: Date | string | null;
    orderNumber?: string | null;
  },
  revision: Pick<RevisionSnapshotSource, "revision" | "name" | "templateTitle">,
): string {
  const base = reportFileNameForWorkOrder(
    workOrder,
    revision.name || revision.templateTitle,
  );
  return safeReportFileName(`${base}-revisjon-${revision.revision}`);
}

/**
 * Rendrer et ferdig rapportdatasett til PDF. Datasettet kan komme fra en
 * levende rapport eller fra et revisjonsøyeblikksbilde – komponenten bryr seg
 * ikke om hvor det kommer fra.
 */
export async function renderReportPdf(
  data: unknown,
  baseUrl?: string,
): Promise<Buffer> {
  const branding = await prisma.branding.findFirst().catch(() => null);

  // Bildene skaleres ned på forhånd, slik at PDF-en blir til å sende på e-post.
  // Signaturer og opplastet logo tas med, slik at PDF-motoren slipper å hente
  // dem fra det innloggingsbeskyttede /uploads over HTTP.
  //
  // Datasettet kan komme i to former: `loadReportPdf` sender arbeidsoppdraget
  // direkte (med `reports` på toppnivå), mens revisjons-PDF-en sender
  // `{ workOrder, reports }`. Begge må gi samme bildeliste – ellers mister
  // den levende PDF-en alle bildene uten at selve teksten feiler.
  const root = (data ?? {}) as Record<string, unknown>;
  const nestedWorkOrder =
    root.workOrder && typeof root.workOrder === "object"
      ? (root.workOrder as Record<string, unknown>)
      : null;
  const workOrderRecord = (nestedWorkOrder ?? root) as {
    id?: string | null;
    departmentId?: string | null;
    customerId?: string | null;
  };
  const rawReports = Array.isArray(root.reports)
    ? root.reports
    : root.report
      ? [root.report]
      : undefined;
  const reportImageUrls = collectReportImageUrls(
    rawReports as Parameters<typeof collectReportImageUrls>[0],
  );

  // Bildene må valideres mot rapportens oppdrag. Den levende PDF-en har
  // avdeling/kunde i arbeidsoppdraget; revisjons-PDF-en har bare id, så de
  // hentes inn når de mangler.
  let workOrderScope: {
    id: string;
    departmentId?: string | null;
    customerId?: string | null;
  } | null = null;
  if (workOrderRecord.id) {
    const scope = {
      id: workOrderRecord.id,
      departmentId: workOrderRecord.departmentId,
      customerId: workOrderRecord.customerId,
    };
    if (
      (scope.departmentId === undefined || scope.customerId === undefined) &&
      reportImageUrls.length > 0
    ) {
      const fresh = await prisma.workOrder
        .findUnique({
          where: { id: scope.id },
          select: { departmentId: true, customerId: true },
        })
        .catch(() => null);
      if (fresh) {
        scope.departmentId = fresh.departmentId;
        scope.customerId = fresh.customerId;
      }
    }
    // Uten både avdeling og kunde kan eierskapet ikke verifiseres fullt ut.
    // Da utelates bildene heller enn å falle tilbake til eiertype alene.
    workOrderScope =
      scope.departmentId === undefined || scope.customerId === undefined
        ? null
        : scope;
  }

  // Logoen må være lastet opp som merkevare. En fil uten `Upload`-rad – eller
  // en fil som tilhører et oppdrag, en kunde eller en bruker – skal verken
  // leses fra disk eller sendes videre til PDF-motoren.
  const logoUrl =
    branding?.logoUrl && isSafeLogoUrl(branding.logoUrl) ? branding.logoUrl : null;
  const logoIsOwned = logoUrl
    ? await isUploadOwnedBy(logoUrl, BRANDING_LOGO_OWNER_TYPES)
    : false;
  const safeLogoUrl = logoIsOwned ? logoUrl : null;

  const imageRequests = [
    ...(workOrderScope
      ? reportImageUrls.map((url) => ({
          url,
          ownerTypes: REPORT_IMAGE_OWNER_TYPES,
          workOrder: workOrderScope!,
        }))
      : []),
    ...(safeLogoUrl
      ? [{ url: safeLogoUrl, ownerTypes: BRANDING_LOGO_OWNER_TYPES }]
      : []),
  ];
  const { images: pdfImages, missing } =
    await buildPdfImagesDetailed(imageRequests);

  // Bilder som var forventet i rapporten, men som ikke kunne bygges inn, skal
  // ikke forsvinne stille. Vi logger en stabil kode med antall (aldri filnavn
  // eller personopplysninger) og viser en advarsel i selve PDF-en.
  const missingImageCount = workOrderScope
    ? missing.length
    : reportImageUrls.filter((url) => !isEmbeddedImageUrl(url)).length;
  if (missingImageCount > 0) {
    console.error("report_pdf_images_missing", {
      code: "report_pdf_images_missing",
      count: missingImageCount,
      reason: workOrderScope ? "not_embedded" : "no_work_order_scope",
    });
  }

  const origin =
    baseUrl ||
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  const element = React.createElement(ReportDocument, {
    data,
    // Bare logoer som er lastet opp gjennom appen og har gyldig
    // merkevare-eierskap. Eldre eksterne URL-er og filer uten metadata
    // ignoreres, slik at PDF-generering ikke kan brukes til SSRF eller til å
    // vise andres filer.
    globalLogoUrl: safeLogoUrl,
    globalPrimaryColor: branding?.primaryColor ?? undefined,
    globalCompanyName: branding?.companyName ?? undefined,
    baseUrl: origin,
    pdfImages,
    missingImageCount,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(element as any);
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
  reportId?: string,
): Promise<ReportPdfResult | null> {
  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, deletedAt: null },
    include: {
      customer: true,
      templates: true,
      technicians: true,
      reports: {
        where: reportId
          ? { deletedAt: null, id: reportId }
          : { deletedAt: null },
        include: { units: { orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!workOrder || workOrder.reports.length === 0) return null;

  const buffer = await renderReportPdf(workOrder, baseUrl);
  const reportName =
    workOrder.reports.length === 1 ? workOrder.reports[0].name : null;

  return { buffer, fileName: reportFileNameForWorkOrder(workOrder, reportName) };
}

/**
 * Rendrer en historisk revisjon. Ingenting skrives til databasen, og den
 * levende malen brukes ikke – alt innhold kommer fra øyeblikksbildet.
 */
export async function renderReportRevisionPdf(
  workOrder: {
    id?: string;
    title?: string | null;
    orderNumber?: string | null;
    status?: string | null;
    scheduledFor?: Date | string | null;
    customer?: { name?: string | null } | null;
  },
  revision: RevisionSnapshotSource,
): Promise<ReportPdfResult> {
  const data = revisionToDocumentData(workOrder, revision);
  const buffer = await renderReportPdf(data);
  return {
    buffer,
    fileName: reportRevisionFileName(workOrder, revision),
  };
}
