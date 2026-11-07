import fs from "node:fs/promises";
import path from "path";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { internalApiError, type ApiErrorCode } from "@/lib/api-errors";
import { uploadDir } from "@/lib/uploads";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { assertSameOrigin } from "@/lib/origin";
import {
  MAX_REQUEST_BYTES,
  maxBytesForMime,
  withUploadSlot,
} from "@/lib/upload-slot";
import {
  tryAcquireUploadBodySlot,
  UPLOAD_BODY_RETRY_AFTER_SECONDS,
} from "@/lib/upload-concurrency";
import {
  declaredMimeMatches,
  sniffFileMime,
} from "@/lib/upload-validation";
import { readMultipartUpload } from "@/lib/upload-multipart";
import { checkUploadQuota } from "@/lib/upload-quota";
import { moduleApiGuard } from "@/lib/module-guards";

export const dynamic = "force-dynamic";

function jsonError(
  code: ApiErrorCode,
  status: number,
  messageKey?: string,
  headers?: Record<string, string>,
): Response {
  return internalApiError(code, status, { messageKey, headers });
}

export async function POST(request: Request) {
  const moduleGuard = await moduleApiGuard("documents");
  if (moduleGuard) return moduleGuard;
  if (!assertSameOrigin(request)) {
    return jsonError("invalid_origin", 403, "errors.api.upload.invalidOrigin");
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return jsonError("not_authenticated", 401);
  }
  // Opplasting i seg selv gir ingen tilgang til filen. Selve vedlegget eller
  // dokumentet krever en av rettighetene under, også for brukere med rollen
  // USER som har fått utvidede rettigheter.
  const canUpload =
    hasPermission(user, "customers.manage") ||
    hasPermission(user, "workorders.update") ||
    hasPermission(user, "reports.write") ||
    hasPermission(user, "documents.manage") ||
    hasPermission(user, "equipment.manage") ||
    hasPermission(user, "settings.manage");

  if (!canUpload) {
    return jsonError("forbidden", 403);
  }

  // Avvis åpenbart for store forespørsler før vi leser og parser multipart.
  // Content-Length kan mangle eller lyve, så grensene sjekkes også underveis.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonError("too_large", 413, "errors.api.upload.tooLarge");
  }

  // Maks 30 opplastinger per minutt per konto.
  const limit = await allowRequestDb(`upload:minute:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return jsonError(
      "rate_limited",
      429,
      "errors.api.upload.rateLimited",
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  // Selv om parsing nå strømmer til disk, holder denne porten antallet
  // samtidige kroppslesinger nede. Da er minnebruken forutsigbar også når
  // mange store filer kommer samtidig. Grensen er per instans; proxy/ingress
  // må fortsatt begrense kroppsstørrelse og samtidige tilkoblinger.
  const bodyLease = tryAcquireUploadBodySlot();
  if (!bodyLease) {
    return jsonError(
      "upload_busy",
      503,
      "errors.api.upload.busy",
      { "Retry-After": String(UPLOAD_BODY_RETRY_AFTER_SECONDS) },
    );
  }

  const uploadDirPath = uploadDir();
  let tempPath: string | null = null;
  let filePath: string | null = null;

  const removeTemp = async () => {
    if (!tempPath) return;
    const target = tempPath;
    tempPath = null;
    await fs.unlink(target).catch(() => undefined);
  };

  try {
    // Den absolutte filgrensen er den største tillatte typen. Den konkrete
    // MIME-grensen kontrolleres etter parsing, når innholdstypen er kjent.
    const maxFileBytes = Math.max(
      maxBytesForMime("application/pdf"),
      maxBytesForMime("image/png"),
    );

    const parsed = await (async () => {
      try {
        return await readMultipartUpload(request, {
          maxRequestBytes: MAX_REQUEST_BYTES,
          maxFileBytes,
          tempDir: uploadDirPath,
        });
      } finally {
        bodyLease.release();
      }
    })();

    if (!parsed.ok) {
      switch (parsed.reason) {
        case "too_large":
          return jsonError("too_large", 413, "errors.api.upload.tooLarge");
        case "no_file":
          return jsonError("no_file", 400, "errors.api.upload.noFile");
        default:
          return jsonError("invalid_request", 400);
      }
    }

    const { fields, file } = parsed.data;
    if (!file) {
      return jsonError("no_file", 400, "errors.api.upload.noFile");
    }
    tempPath = file.tempPath;

    // Konteksten avgjør hvem som senere kan lese filen.
    const workOrderId = cleanText(fields.workOrderId, { maxLength: LIMITS.line });
    const customerId = cleanText(fields.customerId, { maxLength: LIMITS.line });
    const equipmentId = cleanText(fields.equipmentId, { maxLength: LIMITS.line });
    const purpose = cleanText(fields.purpose, { maxLength: LIMITS.short });

    let ownerType:
      | "WORK_ORDER"
      | "CUSTOMER"
      | "DOCUMENT"
      | "USER"
      | "BRANDING"
      | "EQUIPMENT"
      | "CONTRACT" = "USER";
    let ownerId: string | null = user.id;
    let departmentId: string | null = user.departmentId ?? null;
    let ownerCustomerId: string | null = user.customerId ?? null;

    if (workOrderId) {
      if (
        !hasPermission(user, "workorders.update") &&
        !hasPermission(user, "reports.write")
      ) {
        return jsonError("forbidden", 403);
      }
      const workOrder = await prisma.workOrder.findFirst({
        where: { id: workOrderId, ...workOrderScope(user) },
        select: {
          departmentId: true,
          customerId: true,
          status: true,
          legalHold: true,
          department: { select: { isActive: true } },
        },
      });
      if (!workOrder) {
        return jsonError("forbidden", 403);
      }
      // En deaktivert avdeling skal ikke kunne ta imot nye filer, heller ikke
      // fra administrator som ellers ser alle avdelinger.
      if (!workOrder.department?.isActive) {
        return jsonError("department_inactive", 403, "errors.api.upload.departmentInactive");
      }
      // Lukkede oppdrag og bevaringsplikt er låst historikk. Samme regel
      // gjelder alle roller; en administrator må gjenåpne oppdraget eller
      // fjerne bevaringsplikten før nye filer kan lastes opp.
      if (workOrder.legalHold) {
        return jsonError("legal_hold", 403, "errors.api.upload.legalHold");
      }
      if (
        workOrder.status === "COMPLETED" ||
        workOrder.status === "CANCELLED"
      ) {
        return jsonError("work_order_locked", 403, "errors.api.upload.locked");
      }
      ownerType = "WORK_ORDER";
      ownerId = workOrderId;
      departmentId = workOrder.departmentId;
      ownerCustomerId = workOrder.customerId;
    } else if (equipmentId) {
      if (!hasPermission(user, "equipment.manage")) {
        return jsonError("forbidden", 403);
      }
      const equipment = await prisma.product.findFirst({
        where: { id: equipmentId, customer: { deletedAt: null } },
        select: {
          id: true,
          customerId: true,
          customer: { select: { departmentId: true } },
        },
      });
      if (!equipment) {
        return jsonError("forbidden", 403);
      }
      ownerType = "EQUIPMENT";
      ownerId = equipment.id;
      departmentId = equipment.customer.departmentId;
      ownerCustomerId = equipment.customerId;
    } else if (purpose === "customer-logo") {
      // Kundelogo er merkevare, ikke et dokument. Den lagres som BRANDING slik
      // at den er synlig i portalens ramme også for en delegert kontakt uten
      // dokumenttilgang, men bare når den faktisk tilhører kunden.
      if (!hasPermission(user, "customers.manage")) {
        return jsonError("forbidden", 403);
      }
      const targetCustomerId = cleanText(customerId, {
        maxLength: LIMITS.line,
      });
      const customer = targetCustomerId
        ? await prisma.customer.findFirst({
            where: { id: targetCustomerId, deletedAt: null },
            select: { id: true },
          })
        : null;
      if (!customer) return jsonError("forbidden", 403);
      ownerType = "BRANDING";
      ownerId = null;
      departmentId = null;
      ownerCustomerId = customer.id;
    } else if (customerId) {
      if (!hasPermission(user, "customers.manage")) {
        return jsonError("forbidden", 403);
      }
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, departmentId: true },
      });
      if (!customer) {
        return jsonError("forbidden", 403);
      }
      ownerType = "CUSTOMER";
      ownerId = customer.id;
      departmentId = customer.departmentId;
      ownerCustomerId = customer.id;
    } else if (purpose === "document") {
      if (!hasPermission(user, "documents.manage")) {
        return jsonError("forbidden", 403);
      }
      ownerType = "DOCUMENT";
      ownerId = null;
    } else if (purpose === "branding") {
      // Logo vises for alle innloggede, også kundeportalen.
      if (!hasPermission(user, "settings.manage")) {
        return jsonError("forbidden", 403);
      }
      ownerType = "BRANDING";
      ownerId = null;
      departmentId = null;
      ownerCustomerId = null;
    }

    // Valider filtype (bare bilder og PDF). Endelsen utledes av typen, ikke av
    // filnavnet brukeren oppgir – et filnavn kan inneholde «/» og «..», og skal
    // aldri få bestemme hvor filen havner.
    const allowedTypes: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "application/pdf": "pdf",
    };
    const fileExtension = allowedTypes[file.contentType];
    if (!fileExtension) {
      return jsonError("invalid_file_type", 400, "errors.api.upload.invalidType");
    }

    const maxSize = maxBytesForMime(file.contentType);
    if (file.size > maxSize) {
      return jsonError("too_large", 413, "errors.api.upload.tooLarge");
    }

    // Magiske bytes avgjør hva filen faktisk er. En HTML-fil som hevder å være
    // PNG skal ikke lagres som bilde, og en EXE som hevder PDF skal ikke kunne
    // leveres med PDF-innholdstype.
    const actualMime = sniffFileMime(file.headerBytes);
    if (!declaredMimeMatches(file.contentType, actualMime)) {
      return jsonError("mime_mismatch", 415, "errors.api.upload.mimeMismatch");
    }

    // Kvoter kontrolleres etter at eierskapet er kjent, men før filen flyttes
    // til den endelige mappen. Da blir det ingen orphan-fil ved avvisning.
    const quota = await checkUploadQuota({
      userId: user.id,
      customerId: ownerCustomerId,
      size: file.size,
    });
    if (!quota.allowed) {
      return jsonError("storage_quota_exceeded", 507, "errors.api.upload.quota");
    }

    const fileName = `${crypto.randomUUID()}.${fileExtension}`;
    const targetPath = path.join(/*turbopackIgnore: true*/ uploadDirPath, fileName);

    let finalMime = file.contentType;
    let finalBytes = file.size;

    const processImage =
      file.contentType.startsWith("image/") && file.contentType !== "image/gif";

    if (processImage) {
      // Komprimer bilder før de skrives til disk. Feltbilder kan være store;
      // vi begrenser til 2000 px og reduserer kvaliteten. Sharp er CPU-tungt,
      // så både innlesing og behandling går gjennom den delte opplastingskøen.
      let imageFailed = false;
      const processed = await withUploadSlot(async () => {
        let buffer = await fs.readFile(file.tempPath);
        let extension = fileExtension;
        try {
          const sharp = (await import("sharp")).default;
          const image = sharp(buffer).rotate();
          const meta = await image.metadata();
          const needsResize =
            (meta.width && meta.width > 2000) || (meta.height && meta.height > 2000);
          const pipeline = needsResize
            ? image.resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
            : image;

          if (file.contentType === "image/png") {
            buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
            extension = "png";
            finalMime = "image/png";
          } else if (file.contentType === "image/webp") {
            buffer = await pipeline.webp({ quality: 82 }).toBuffer();
            extension = "webp";
            finalMime = "image/webp";
          } else {
            buffer = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
            extension = "jpg";
            finalMime = "image/jpeg";
          }
          finalBytes = buffer.length;
        } catch (error) {
          // Vi lagrer aldri den ubehandlede originalen under en påstått
          // bilde-MIME. En fil Sharp ikke kan dekode, er ikke et bilde vi kan
          // garantere at nettleseren håndterer trygt.
          console.error("Image compression failed:", error);
          imageFailed = true;
          return null;
        }

        // Filene ligger utenfor public/ og leses gjennom /uploads/[...sti].
        await fs.mkdir(uploadDirPath, { recursive: true });
        const finalPath = path.join(
          /*turbopackIgnore: true*/ uploadDirPath,
          `${path.basename(targetPath, path.extname(targetPath))}.${extension}`,
        );
        await fs.writeFile(finalPath, buffer);
        return finalPath;
      });
      if (imageFailed || !processed) {
        return jsonError("image_processing_failed", 415, "errors.api.upload.imageFailed");
      }
      filePath = processed;
      await removeTemp();

      return await storeUpload({
        fileName: path.basename(processed),
        filePath: processed,
        originalName: file.fileName,
        mimeType: finalMime,
        size: finalBytes,
        ownerType,
        ownerId,
        departmentId,
        customerId: ownerCustomerId,
        uploadedById: user.id,
      });
    }

    // PDF-er og GIF-er flyttes direkte fra den midlertidige filen. Da slipper
    // vi å holde en full kopi av en stor fil i minnet.
    await fs.mkdir(uploadDirPath, { recursive: true });
    await fs.rename(file.tempPath, targetPath);
    tempPath = null;
    filePath = targetPath;

    return await storeUpload({
      fileName,
      filePath: targetPath,
      originalName: file.fileName,
      mimeType: finalMime,
      size: finalBytes,
      ownerType,
      ownerId,
      departmentId,
      customerId: ownerCustomerId,
      uploadedById: user.id,
    });
  } catch (error) {
    console.error("Upload failed:", error);
    await removeTemp();
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch {
        // Filen kan allerede være borte.
      }
    }
    return jsonError("server_error", 500, "errors.api.upload.failed");
  } finally {
    await removeTemp();
  }
}

async function storeUpload(input: {
  fileName: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  ownerType:
    | "WORK_ORDER"
    | "CUSTOMER"
    | "DOCUMENT"
    | "USER"
    | "BRANDING"
    | "EQUIPMENT"
    | "CONTRACT";
  ownerId: string | null;
  departmentId: string | null;
  customerId: string | null;
  uploadedById: string;
}): Promise<Response> {
  // Registrer metadata. Feiler det, fjernes filen igjen slik at disken ikke
  // får filer uten tilgangsmetadata.
  try {
    await prisma.upload.create({
      data: {
        storedName: input.fileName,
        originalName: cleanText(input.originalName, { maxLength: LIMITS.line }) || "file",
        mimeType: input.mimeType,
        size: input.size,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        departmentId: input.departmentId,
        customerId: input.customerId,
        uploadedById: input.uploadedById,
      },
    });
  } catch (error) {
    console.error("Could not register upload:", error);
    try {
      await fs.unlink(input.filePath);
    } catch {}
    return jsonError("save_failed", 500, "errors.api.upload.saveFailed");
  }

  const fileUrl = `/uploads/${input.fileName}`;

  return new Response(JSON.stringify({
    success: true,
    fileUrl,
    // Filnavnet vises bare i grensesnittet; det lagres ikke og brukes aldri
    // som sti på disk (se filnavnet over).
    fileName: cleanText(input.originalName, { maxLength: LIMITS.line }),
    fileSize: input.size,
    fileType: input.mimeType,
  }), { status: 200 });
}
