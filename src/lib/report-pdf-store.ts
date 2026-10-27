import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import {
  loadReportPdf,
  reportFileNameForWorkOrder,
  type ReportPdfResult,
} from "@/lib/report-pdf";
import { withRenderSlot } from "@/lib/render-queue";
import { uploadDir } from "@/lib/uploads";
import { releaseUpload } from "@/lib/upload-cleanup";

/**
 * Mellomlagring av genererte rapport-PDF-er.
 *
 * Rendering er den dyreste delen av PDF-nedlastingen. Hver gang en rapport
 * endres får den ny `updatedAt`, og da blir hashen ulik og PDF-en lages på
 * nytt. Så lenge innholdet er uendret, leses filen rett fra opplastingsmappen.
 *
 * PDF-en registreres også som en vanlig `Upload`, slik at `/uploads/...` kan
 * bruke samme tilgangskontroll som alle andre filer.
 */

export type ReportPdfHashInput = {
  id: string;
  updatedAt: Date | string;
  comments?: string | null;
  technicianSignatureUrl?: string | null;
  customerSignatureUrl?: string | null;
  technicianName?: string | null;
  customerName?: string | null;
  lockedByName?: string | null;
  templateId?: string | null;
  name?: string | null;
  requiresUnits?: boolean | null;
  templateSnapshotJson?: string | null;
  units?: ReadonlyArray<{
    id?: string;
    label?: string | null;
    status?: string | null;
    answersJson?: string | null;
    comment?: string | null;
    sortOrder?: number | null;
  }> | null;
};

/** Kanonisk beskrivelse av det PDF-innholdet faktisk avhenger av. */
function canonicalReport(report: ReportPdfHashInput) {
  const updatedAt =
    report.updatedAt instanceof Date
      ? report.updatedAt.toISOString()
      : new Date(report.updatedAt).toISOString();

  return {
    // Økes når PDF-renderingen endres, slik at gamle, ufullstendige
    // PDF-er (for eksempel uten signaturbilder) ikke gjenbrukes fra cachen.
    rendererVersion: 3,
    id: report.id,
    updatedAt,
    comments: report.comments ?? null,
    technicianSignatureUrl: report.technicianSignatureUrl ?? null,
    customerSignatureUrl: report.customerSignatureUrl ?? null,
    technicianName: report.technicianName ?? null,
    customerName: report.customerName ?? null,
    lockedByName: report.lockedByName ?? null,
    templateId: report.templateId ?? null,
    name: report.name ?? null,
    requiresUnits: report.requiresUnits !== false,
    templateSnapshot: report.templateSnapshotJson ?? null,
    unitCount: report.units?.length ?? 0,
    units: (report.units ?? []).map((unit) => ({
      id: unit.id ?? null,
      label: unit.label ?? null,
      status: unit.status ?? null,
      answers: unit.answersJson ?? null,
      comment: unit.comment ?? null,
      sortOrder: unit.sortOrder ?? null,
    })),
  };
}

/** SHA-256 over innholdet i én rapport. */
export function computeReportPdfHash(report: ReportPdfHashInput): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalReport(report)))
    .digest("hex");
}

/**
 * Hash for hele PDF-en. En PDF kan inneholde flere rapporter (én per mal), og
 * da må alle inngå – ellers ville en endring i en av dem ikke ført til ny PDF.
 */
export function computeReportPdfHashForReports(
  reports: ReportPdfHashInput[],
): string {
  if (reports.length === 1) return computeReportPdfHash(reports[0]);

  const hash = crypto.createHash("sha256");
  for (const report of reports) hash.update(computeReportPdfHash(report));
  return hash.digest("hex");
}

/** Oversetter `/uploads/<fil>` til en sti under opplastingsmappen. */
function cachedPdfPath(pdfUrl: string): string | null {
  const marker = "/uploads/";
  const index = pdfUrl.indexOf(marker);
  if (index === -1) return null;

  let storedName: string;
  try {
    storedName = decodeURIComponent(pdfUrl.slice(index + marker.length));
  } catch {
    return null;
  }

  // Bare filer helt øverst i opplastingsmappen; ingen underkataloger eller
  // `..` – samme regel som /uploads-ruten bruker.
  if (!storedName || storedName.includes("/") || storedName.includes("\\")) {
    return null;
  }
  if (storedName === "." || storedName === "..") return null;

  return path.join(uploadDir(), storedName);
}

function defaultBaseUrl(): string | undefined {
  // Aldri stol på X-Forwarded-Host: den kan settes av klienten. Den offentlige
  // adressen må komme fra konfigurasjonen.
  return process.env.APP_URL || process.env.NEXTAUTH_URL || undefined;
}

type StorePdfParams = {
  workOrderId: string;
  reportId: string;
  departmentId: string;
  customerId: string | null;
  pdfHash: string;
  pdf: ReportPdfResult;
};

/**
 * Skriver PDF-en til opplastingsmappen og registrerer den. Returnerer
 * `/uploads/...`, eller null når lagringen feiler (da skal filen ikke bli
 * liggende igjen på disken).
 */
async function storeReportPdf({
  workOrderId,
  reportId,
  departmentId,
  customerId,
  pdfHash,
  pdf,
}: StorePdfParams): Promise<string | null> {
  const storedName = `${crypto.randomUUID()}.pdf`;
  const root = uploadDir();
  const filePath = path.join(root, storedName);
  const url = `/uploads/${storedName}`;

  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(filePath, pdf.buffer);

    await prisma.$transaction([
      prisma.upload.create({
        data: {
          storedName,
          originalName: `${pdf.fileName}.pdf`,
          mimeType: "application/pdf",
          size: pdf.buffer.length,
          ownerType: "WORK_ORDER",
          ownerId: workOrderId,
          departmentId,
          customerId,
          uploadedById: null,
        },
      }),
      prisma.report.update({
        where: { id: reportId },
        data: {
          pdfUrl: url,
          pdfHash,
          pdfGeneratedAt: new Date(),
        },
      }),
    ]);

    return url;
  } catch (error) {
    console.error(`Kunne ikke lagre PDF for rapport ${reportId}:`, error);
    await fs.unlink(filePath).catch(() => {});
    return null;
  }
}

/**
 * Henter rapport-PDF-en for et oppdrag, og lager den bare når den mangler
 * eller rapporten er endret siden forrige gang.
 */
export async function getOrRenderReportPdf(
  workOrderId: string,
  baseUrl?: string,
): Promise<ReportPdfResult | null> {
  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, deletedAt: null },
    include: {
      customer: true,
      reports: {
        where: { deletedAt: null },
        include: { units: { orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!workOrder || workOrder.reports.length === 0) return null;

  const reports = workOrder.reports;
  const latest = reports[reports.length - 1];
  const pdfHash = computeReportPdfHashForReports(reports);
  const fileName = reportFileNameForWorkOrder(workOrder);

  // Uendret innhold og filen finnes fortsatt: bruk mellomlagringen.
  if (latest.pdfUrl && latest.pdfHash === pdfHash) {
    const filePath = cachedPdfPath(latest.pdfUrl);
    if (filePath) {
      try {
        const buffer = await fs.readFile(filePath);
        return { buffer, fileName, url: latest.pdfUrl };
      } catch {
        // Filen er borte (for eksempel etter et bytte av volum). Da lages den
        // på nytt under, og den gamle raden overskrives.
      }
    }
  }

  const pdf = await withRenderSlot(() =>
    loadReportPdf(workOrderId, baseUrl || defaultBaseUrl()),
  );
  if (!pdf) return null;

  const previousPdfUrl = latest.pdfUrl;
  const url = await storeReportPdf({
    workOrderId,
    reportId: latest.id,
    departmentId: workOrder.departmentId,
    customerId: workOrder.customerId,
    pdfHash,
    pdf,
  });

  // Den forrige PDF-cachen er ikke lenger referert fra rapporten. Frigjør den
  // når den nye er lagret; filen blir liggende hvis den også brukes andre
  // steder (for eksempel av en revisjon).
  if (url && previousPdfUrl && previousPdfUrl !== url) {
    await releaseUpload(previousPdfUrl);
  }

  return url ? { ...pdf, url } : pdf;
}
