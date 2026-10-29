import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "path";
import prisma from "@/lib/prisma";
import type { AccessUser } from "@/lib/access";
import { contentTypeFor, uploadDir } from "@/lib/uploads";
import { getCurrentUser } from "@/lib/session";
import { canReadUpload } from "@/lib/upload-access";
import { hasPermission } from "@/lib/permissions";

// Bilder og vedlegg leses fra disk for hver forespørsel, slik at filer som
// lastes opp mens appen kjører blir synlige umiddelbart.
export const dynamic = "force-dynamic";

/** Fjerner kontrolltegn og sti-/sitattegn før filnavnet går i en header. */
function safeFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .trim();
  return base || "fil";
}

/**
 * PDF-er lastes ned, bilder vises i nettleseren. Filnavnet er sanert slik at
 * en opprinnelig fil med anførselstegn eller linjeskift ikke kan bryte ut av
 * Content-Disposition-headeren.
 */
function contentDisposition(filePath: string, originalName?: string | null) {
  const name = safeFileName(originalName || path.basename(filePath));
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const disposition = contentTypeFor(filePath).startsWith("image/")
    ? "inline"
    : "attachment";
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/**
 * Ansatte i en deaktivert avdeling skal ikke kunne hente filer, selv om
 * økten ble opprettet før avdelingen ble deaktivert. Kundeportalen og
 * administrator er ikke avdelingssperret.
 */
async function staffDepartmentInactive(user: AccessUser): Promise<boolean> {
  if (user.role === "ADMIN" || user.role === "CUSTOMER") return false;
  if (user.department) return user.department.isActive === false;
  if (!user.departmentId) return false;

  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { isActive: true },
  });
  return !department?.isActive;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Bilder og vedlegg kan inneholde kundedata. Alle filer krever en gyldig
  // økt, og tilgangen avgjøres per fil ut fra Upload-raden.
  const user = await getCurrentUser();
  if (!user?.isActive) {
    return new NextResponse("Ikke autentisert", { status: 401 });
  }

  if (await staffDepartmentInactive(user)) {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }

  const { path: segments } = await params;
  const root = uploadDir();
  const filePath = path.join(root, ...segments);

  // Aldri les filer utenfor opplastingsmappen.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return new NextResponse("Ugyldig sti", { status: 400 });
  }

  const storedName = path.basename(filePath);
  const upload = await prisma.upload.findUnique({ where: { storedName } });

  if (!upload) {
    // Eldre filer uten metadata: bare administrator kan lese dem. Backfill-
    // skriptet (scripts/backfill-uploads.mjs) registrerer dem.
    if (user.role !== "ADMIN") {
      return new NextResponse("Fant ikke filen", { status: 404 });
    }
  } else {
    // Oppdragsfilen lastes før tilgangskontrollen, slik at en deaktivert
    // avdeling kan avvises av samme regel som oppdragsscope.
    const workOrder =
      upload.ownerType === "WORK_ORDER" && upload.ownerId
        ? await prisma.workOrder.findUnique({
            where: { id: upload.ownerId },
            select: {
              deletedAt: true,
              status: true,
              department: { select: { isActive: true } },
              customer: { select: { deletedAt: true } },
            },
          })
        : null;

    if (
      !canReadUpload(user, {
        ...upload,
        departmentIsActive: workOrder?.department?.isActive,
      })
    ) {
      return new NextResponse("Ingen tilgang", { status: 403 });
    }

    // En oppdragsfil skal ikke være lesbar etter at oppdraget er mykt slettet.
    // Administrator beholder tilgangen slik at gjenoppretting og revisjon er
    // mulig. Selve slettingen rører ikke filen.
    if (
      upload.ownerType === "WORK_ORDER" &&
      upload.ownerId &&
      user.role !== "ADMIN"
    ) {
      if (!workOrder || workOrder.deletedAt) {
        return new NextResponse("Fant ikke filen", { status: 404 });
      }

      // Kansellerte oppdrag er lukket for montørene, også filene deres.
      if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
        return new NextResponse("Ingen tilgang", { status: 403 });
      }

      // En slettet kunde skal ikke kunne lese oppdragsfilene via portalen.
      if (
        user.role === "CUSTOMER" &&
        (!workOrder.customer || workOrder.customer.deletedAt)
      ) {
        return new NextResponse("Fant ikke filen", { status: 404 });
      }

      // En rapport-PDF lagres som en WORK_ORDER-opplasting, men inneholder
      // hele rapporten. Den skal derfor kreve reports.view i tillegg til
      // oppdragstilgangen. Vanlige vedlegg på samme oppdrag er ikke berørt.
      const reportPdf = await prisma.report.findFirst({
        where: { pdfUrl: `/uploads/${storedName}` },
        select: {
          id: true,
          deletedAt: true,
          workOrder: { select: { deletedAt: true, status: true } },
        },
      });
      if (reportPdf) {
        if (reportPdf.deletedAt || reportPdf.workOrder?.deletedAt) {
          return new NextResponse("Fant ikke filen", { status: 404 });
        }
        if (
          user.role === "TECHNICIAN" &&
          reportPdf.workOrder?.status === "CANCELLED"
        ) {
          return new NextResponse("Ingen tilgang", { status: 403 });
        }
        if (!hasPermission(user, "reports.view")) {
          return new NextResponse("Ingen tilgang", { status: 403 });
        }
      }
    }

    // Mykt slettede kunder og dokumenter stenger også filene deres. En
    // administrator beholder tilgangen for gjenoppretting og revisjon.
    if (upload.ownerType === "CUSTOMER" && user.role !== "ADMIN") {
      const ownerCustomerId = upload.ownerId ?? upload.customerId;
      if (ownerCustomerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: ownerCustomerId },
          select: { deletedAt: true },
        });
        if (!customer || customer.deletedAt) {
          return new NextResponse("Fant ikke filen", { status: 404 });
        }
      }
    }

    if (
      upload.ownerType === "DOCUMENT" &&
      upload.ownerId &&
      user.role !== "ADMIN"
    ) {
      const document = await prisma.document.findUnique({
        where: { id: upload.ownerId },
        select: { deletedAt: true },
      });
      if (!document || document.deletedAt) {
        return new NextResponse("Fant ikke filen", { status: 404 });
      }
    }
  }

  try {
    const info = await stat(filePath);
    const stream = createReadStream(filePath);
    // En feil etter at headeren er sendt kan ellers bli en uhåndtert
    // stream-feil. Svarstrømmen avsluttes uansett.
    stream.on("error", () => {});

    return new NextResponse(
      Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": contentTypeFor(filePath),
          "Content-Length": String(info.size),
          "Content-Disposition": contentDisposition(
            filePath,
            upload?.originalName,
          ),
          "X-Content-Type-Options": "nosniff",
          // Filnavnet er tilfeldig, men innholdet kan være kundedata og
          // tilgangen kan trekkes tilbake. Derfor skal ingen delt cache eller
          // nettleser beholde filen etter at den er vist.
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch {
    return new NextResponse("Fant ikke filen", { status: 404 });
  }
}
