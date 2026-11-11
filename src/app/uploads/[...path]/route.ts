import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import path from "path";
import prisma from "@/lib/prisma";
import type { AccessUser } from "@/lib/access";
import {
  auditRequestContext,
  auditStandalone,
  type AuditActor,
  type AuditOutcome,
} from "@/lib/audit";
import { contentTypeFor } from "@/lib/uploads";
import {
  getStorageDriver,
  isInternalStorageKey,
  tryNormaliseStorageKey,
} from "@/lib/storage";
import { getCurrentUser } from "@/lib/session";
import { canReadUpload } from "@/lib/upload-access";
import { hasPermission } from "@/lib/permissions";
import {
  portalAccessAllows,
  resolvePortalAccess,
} from "@/server/portal-access";

// Bilder og vedlegg leses fra disk for hver forespørsel, slik at filer som
// lastes opp mens appen kjører blir synlige umiddelbart.
export const dynamic = "force-dynamic";

/** Fjerner kontrolltegn og sti-/sitattegn før filnavnet går i en header. */
function safeFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .trim();
  return base || "file";
}

/**
 * PDF-er lastes ned, bilder vises i nettleseren. Filnavnet er sanert slik at
 * en opprinnelig fil med anførselstegn eller linjeskift ikke kan bryte ut av
 * Content-Disposition-headeren.
 */
function contentDisposition(fileKey: string, originalName?: string | null) {
  const name = safeFileName(originalName || path.basename(fileKey));
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const disposition = contentTypeFor(fileKey).startsWith("image/")
    ? "inline"
    : "attachment";
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/**
 * Revisjonslogg for filutlevering. Loggen skal aldri blokkere en nedlasting:
 * feilen rapporteres til operatør, men svaret går videre.
 */
type FileAuditTarget = {
  entityType: "Upload" | "Document" | "Report" | "Contract" | "Customer";
  entityId: string;
  departmentId?: string | null;
};

type UploadOwnerRow = {
  id: string;
  ownerType: string;
  ownerId: string | null;
  departmentId: string | null;
};

function auditActorFor(user: AccessUser): AuditActor {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    departmentId: user.departmentId ?? null,
  };
}

/**
 * Rapporten eier filen når opplastingen er en rapport-PDF. Ellers følger
 * entitetstypen opplastingens eier, slik at loggen kan følges på tvers av
 * dokument, avtale og kunde.
 */
function auditTargetFor(
  upload: UploadOwnerRow | null,
  fallbackId: string,
  reportId?: string | null,
): FileAuditTarget {
  if (reportId) {
    return {
      entityType: "Report",
      entityId: reportId,
      departmentId: upload?.departmentId ?? null,
    };
  }
  if (upload?.ownerType === "DOCUMENT" && upload.ownerId) {
    return {
      entityType: "Document",
      entityId: upload.ownerId,
      departmentId: upload.departmentId,
    };
  }
  if (upload?.ownerType === "CONTRACT" && upload.ownerId) {
    return {
      entityType: "Contract",
      entityId: upload.ownerId,
      departmentId: upload.departmentId,
    };
  }
  if (upload?.ownerType === "CUSTOMER" && upload.ownerId) {
    return {
      entityType: "Customer",
      entityId: upload.ownerId,
      departmentId: upload.departmentId,
    };
  }
  return {
    entityType: "Upload",
    entityId: upload?.id ?? fallbackId,
    departmentId: upload?.departmentId ?? null,
  };
}

async function logFileAccess(input: {
  user: AccessUser;
  fileKey: string;
  target: FileAuditTarget;
  actionCode: "file.downloaded" | "file.denied";
  outcome: AuditOutcome;
  metadata?: Prisma.InputJsonObject;
}): Promise<void> {
  try {
    const metadata: Prisma.InputJsonObject = {
      fileKey: input.fileKey.slice(0, 300),
      ...(input.metadata ?? {}),
    };
    await auditStandalone({
      entityType: input.target.entityType,
      entityId: input.target.entityId,
      action:
        input.actionCode === "file.downloaded"
          ? "Lastet ned fil"
          : "Avviste filtilgang",
      actor: auditActorFor(input.user),
      departmentId: input.target.departmentId ?? null,
      actionCode: input.actionCode,
      outcome: input.outcome,
      metadata,
      context: await auditRequestContext(),
    });
  } catch (error) {
    // En manglende revisjonsrad skal ikke gi brukeren en 500 på en fil.
    console.error(`[audit] kunne ikke logge ${input.actionCode}`, {
      entityType: input.target.entityType,
      entityId: input.target.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Logger et ACL-avslag og returnerer 403 uten å avsløre filens eksistens. */
async function denyFile(
  user: AccessUser,
  fileKey: string,
  reason: string,
  target?: FileAuditTarget,
): Promise<NextResponse> {
  await logFileAccess({
    user,
    fileKey,
    target:
      target ?? {
        entityType: "Upload",
        entityId: fileKey.slice(0, 200) || "ukjent",
      },
    actionCode: "file.denied",
    outcome: "DENIED",
    metadata: { reason },
  });
  return new NextResponse("Forbidden", { status: 403 });
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
    return new NextResponse("Not authenticated", { status: 401 });
  }

  // Stien leses før tilgangskontrollen slik at også avviste forsøk kan
  // registreres i revisjonsloggen med den forespurte nøkkelen.
  const { path: segments } = await params;
  const requestedPath = segments.join("/");

  if (await staffDepartmentInactive(user)) {
    return denyFile(user, requestedPath, "department_inactive");
  }

  // Kundeportalens delegasjon gjelder også direkte fil-URL-er. Uten dette
  // kunne en delegert kontakt uten dokumenttilgang omgått portalen ved å
  // bokmerke /uploads/....
  const portalAccess =
    user.role === "CUSTOMER" ? await resolvePortalAccess(user) : null;
  if (user.role === "CUSTOMER" && !portalAccess?.ok) {
    return denyFile(user, requestedPath, "portal_access_denied");
  }

  const fileKey = tryNormaliseStorageKey(requestedPath);

  // Aldri les filer utenfor opplastingsroten eller interne stagingfiler.
  if (!fileKey || isInternalStorageKey(fileKey)) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  const storedName = path.basename(fileKey);
  const upload = await prisma.upload.findUnique({ where: { storedName } });
  // Rapport-PDF-er eies av rapporten, ikke av oppdraget. Id-en brukes i loggen.
  let reportPdfId: string | null = null;
  const targetFor = (): FileAuditTarget =>
    auditTargetFor(upload, storedName, reportPdfId);

  if (!upload) {
    // Eldre filer uten metadata: bare administrator kan lese dem. Backfill-
    // skriptet (scripts/backfill-uploads.mjs) registrerer dem.
    if (user.role !== "ADMIN") {
      return new NextResponse("File not found", { status: 404 });
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
      return denyFile(user, fileKey, "acl_denied", targetFor());
    }

    if (user.role === "CUSTOMER") {
      if (!portalAccess?.ok) {
        return denyFile(user, fileKey, "portal_access_denied", targetFor());
      }
      const required =
        upload.ownerType === "EQUIPMENT"
          ? "canViewEquipment"
          : upload.ownerType === "CONTRACT"
            ? "canViewContracts"
            : upload.ownerType === "CUSTOMER" ||
                upload.ownerType === "DOCUMENT"
              ? "canViewDocuments"
              : null;
      if (required && !portalAccessAllows(portalAccess.data, required)) {
        return denyFile(user, fileKey, "portal_permission_denied", targetFor());
      }
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
        return new NextResponse("File not found", { status: 404 });
      }

      // Kansellerte oppdrag er lukket for montørene, også filene deres.
      if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
        return denyFile(user, fileKey, "work_order_cancelled", targetFor());
      }

      // En slettet kunde skal ikke kunne lese oppdragsfilene via portalen.
      if (
        user.role === "CUSTOMER" &&
        (!workOrder.customer || workOrder.customer.deletedAt)
      ) {
        return new NextResponse("File not found", { status: 404 });
      }

      // En rapport-PDF lagres som en WORK_ORDER-opplasting, men inneholder
      // hele rapporten. Den skal derfor kreve reports.view i tillegg til
      // oppdragstilgangen. Vanlige vedlegg på samme oppdrag er ikke berørt.
      const reportPdf = await prisma.report.findFirst({
        where: { pdfUrl: `/uploads/${storedName}` },
        select: {
          id: true,
          deletedAt: true,
          isLocked: true,
          workOrder: { select: { deletedAt: true, status: true } },
        },
      });
      if (reportPdf) {
        reportPdfId = reportPdf.id;
        if (reportPdf.deletedAt || reportPdf.workOrder?.deletedAt) {
          return new NextResponse("File not found", { status: 404 });
        }
        if (
          user.role === "TECHNICIAN" &&
          reportPdf.workOrder?.status === "CANCELLED"
        ) {
          return denyFile(user, fileKey, "work_order_cancelled", targetFor());
        }
        if (user.role === "CUSTOMER") {
          // Rapport-PDF-en er et dokument. Kunden må ha dokumenttilgang, og
          // bare en låst (signert) rapport kan leses – også via denne URL-en.
          if (
            !portalAccess?.ok ||
            !portalAccessAllows(portalAccess.data, "canViewDocuments")
          ) {
            return denyFile(
              user,
              fileKey,
              "portal_permission_denied",
              targetFor(),
            );
          }
          if (!reportPdf.isLocked) {
            return new NextResponse("File not found", { status: 404 });
          }
        } else if (!hasPermission(user, "reports.view")) {
          return denyFile(user, fileKey, "permission_missing", targetFor());
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
          return new NextResponse("File not found", { status: 404 });
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
        return new NextResponse("File not found", { status: 404 });
      }
    }
  }

  try {
    const storage = getStorageDriver();
    const info = await storage.stat(fileKey);
    if (!info) return new NextResponse("File not found", { status: 404 });
    const stream = await storage.stream(fileKey);

    // Først når filen faktisk kan leveres, registreres utleveringen. Feiler
    // loggen, går nedlastingen likevel gjennom (se `logFileAccess`).
    await logFileAccess({
      user,
      fileKey,
      target: targetFor(),
      actionCode: "file.downloaded",
      outcome: "SUCCESS",
      metadata: {
        bytes: info.size,
        contentType: contentTypeFor(fileKey),
        delivery: contentTypeFor(fileKey).startsWith("image/")
          ? "inline"
          : "attachment",
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentTypeFor(fileKey),
        "Content-Length": String(info.size),
        "Content-Disposition": contentDisposition(
          fileKey,
          upload?.originalName,
        ),
        "X-Content-Type-Options": "nosniff",
        // Filnavnet er tilfeldig, men innholdet kan være kundedata og
        // tilgangen kan trekkes tilbake. Derfor skal ingen delt cache eller
        // nettleser beholde filen etter at den er vist.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("File not found", { status: 404 });
  }
}
