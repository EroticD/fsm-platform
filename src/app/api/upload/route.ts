import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "path";
import crypto from "crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import prisma from "@/lib/prisma";
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

export const dynamic = "force-dynamic";

function jsonError(
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return jsonError("Ugyldig origin", 403);
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return jsonError("Ikke autentisert", 401);
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
    return jsonError("Ingen tilgang", 403);
  }

  // Avvis åpenbart for store forespørsler før vi leser og parser multipart.
  // Content-Length kan mangle eller lyve, så filstørrelsen sjekkes også under.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonError("Filen er for stor", 413);
  }

  // Maks 30 opplastinger per minutt per konto.
  const limit = await allowRequestDb(`upload:minute:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return jsonError(
      `For mange opplastinger. Prøv igjen om ${limit.retryAfterSeconds} sekunder.`,
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let filePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return jsonError("Ingen fil valgt", 400);
    }

    // Konteksten avgjør hvem som senere kan lese filen.
    const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
    const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
    const purpose = cleanText(formData.get("purpose"), { maxLength: LIMITS.short });

    let ownerType: "WORK_ORDER" | "CUSTOMER" | "DOCUMENT" | "USER" | "BRANDING" = "USER";
    let ownerId: string | null = user.id;
    let departmentId: string | null = user.departmentId ?? null;
    let ownerCustomerId: string | null = user.customerId ?? null;

    if (workOrderId) {
      if (
        !hasPermission(user, "workorders.update") &&
        !hasPermission(user, "reports.write")
      ) {
        return jsonError("Ingen tilgang", 403);
      }
      const workOrder = await prisma.workOrder.findFirst({
        where: { id: workOrderId, ...workOrderScope(user) },
        select: { departmentId: true, customerId: true },
      });
      if (!workOrder) {
        return jsonError("Ingen tilgang", 403);
      }
      ownerType = "WORK_ORDER";
      ownerId = workOrderId;
      departmentId = workOrder.departmentId;
      ownerCustomerId = workOrder.customerId;
    } else if (customerId) {
      if (!hasPermission(user, "customers.manage")) {
        return jsonError("Ingen tilgang", 403);
      }
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, departmentId: true },
      });
      if (!customer) {
        return jsonError("Ingen tilgang", 403);
      }
      ownerType = "CUSTOMER";
      ownerId = customer.id;
      departmentId = customer.departmentId;
      ownerCustomerId = customer.id;
    } else if (purpose === "document") {
      if (!hasPermission(user, "documents.manage")) {
        return jsonError("Ingen tilgang", 403);
      }
      ownerType = "DOCUMENT";
      ownerId = null;
    } else if (purpose === "branding") {
      // Logo vises for alle innloggede, også kundeportalen.
      if (!hasPermission(user, "settings.manage")) {
        return jsonError("Ingen tilgang", 403);
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
    const fileExtension = allowedTypes[file.type];
    if (!fileExtension) {
      return jsonError("Ugyldig filtype. Bare bilder og PDF er tillatt.", 400);
    }

    const maxSize = maxBytesForMime(file.type);
    if (file.size > maxSize) {
      return jsonError(
        `Filen er for stor (maks ${Math.round(maxSize / (1024 * 1024))} MB)`,
        413,
      );
    }

    // Daglig lagringskvote per bruker (2 GiB de siste 24 timene). Hindrer at en
    // kompromittert konto fyller opplastingsvolumet.
    const dailyQuota = 2 * 1024 * 1024 * 1024;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await prisma.upload.aggregate({
      where: { uploadedById: user.id, createdAt: { gte: since } },
      _sum: { size: true },
    });
    if ((used._sum.size ?? 0) + file.size > dailyQuota) {
      return jsonError("Daglig lagringskvote er nådd. Prøv igjen senere.", 429);
    }

    const uploadDirPath = uploadDir();
    const fileName = `${crypto.randomUUID()}.${fileExtension}`;
    const targetPath = path.join(/*turbopackIgnore: true*/ uploadDirPath, fileName);

    let finalMime = file.type;
    let finalBytes = file.size;

    const processImage = file.type.startsWith("image/") && file.type !== "image/gif";

    if (processImage) {
      // Komprimer bilder før de skrives til disk. Feltbilder kan være store;
      // vi begrenser til 2000 px og reduserer kvaliteten. Sharp er CPU-tungt,
      // så både innlesing og behandling går gjennom den delte opplastingskøen.
      await withUploadSlot(async () => {
        const arrayBuffer = await file.arrayBuffer();
        let buffer = Buffer.from(arrayBuffer);
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

          if (file.type === "image/png") {
            buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
            extension = "png";
            finalMime = "image/png";
          } else if (file.type === "image/webp") {
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
          // Behold originalen hvis Sharp ikke klarer filen.
          console.error("Bildekomprimering feilet, bruker original:", error);
          buffer = Buffer.from(arrayBuffer);
          finalMime = file.type;
          finalBytes = file.size;
          extension = fileExtension;
        }

        // Filene ligger utenfor public/ og leses gjennom /uploads/[...sti].
        await fs.mkdir(uploadDirPath, { recursive: true });
        const finalPath = path.join(
          /*turbopackIgnore: true*/ uploadDirPath,
          `${path.basename(targetPath, path.extname(targetPath))}.${extension}`,
        );
        filePath = finalPath;
        await fs.writeFile(finalPath, buffer);
      });
      // Filnavnet må bygges på nytt hvis endelsen endret seg (png/webp/jpg).
      if (filePath) {
        const actualName = path.basename(filePath);
        return await storeUpload({
          fileName: actualName,
          filePath,
          originalName: file.name,
          mimeType: finalMime,
          size: finalBytes,
          ownerType,
          ownerId,
          departmentId,
          customerId: ownerCustomerId,
          uploadedById: user.id,
        });
      }
      return jsonError("Kunne ikke lagre filen", 500);
    }

    // PDF-er og GIF-er skrives direkte fra strømmen. Da slipper vi å holde en
    // full kopi av en stor fil i minnet.
    await fs.mkdir(uploadDirPath, { recursive: true });
    filePath = targetPath;
    await withUploadSlot(async () => {
      await pipeline(
        Readable.fromWeb(file.stream() as unknown as import("node:stream/web").ReadableStream),
        createWriteStream(targetPath),
      );
    });

    return await storeUpload({
      fileName,
      filePath: targetPath,
      originalName: file.name,
      mimeType: finalMime,
      size: finalBytes,
      ownerType,
      ownerId,
      departmentId,
      customerId: ownerCustomerId,
      uploadedById: user.id,
    });
  } catch (error) {
    console.error("Feil ved opplasting:", error);
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch {
        // Filen kan allerede være borte.
      }
    }
    return jsonError("Kunne ikke laste opp fil", 500);
  }
}

async function storeUpload(input: {
  fileName: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  ownerType: "WORK_ORDER" | "CUSTOMER" | "DOCUMENT" | "USER" | "BRANDING";
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
        originalName: cleanText(input.originalName, { maxLength: LIMITS.line }) || "fil",
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
    console.error("Kunne ikke registrere opplasting:", error);
    try {
      await fs.unlink(input.filePath);
    } catch {}
    return jsonError("Kunne ikke lagre filen", 500);
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
