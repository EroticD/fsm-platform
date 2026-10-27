import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { assertSameOrigin } from "@/lib/origin";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return new Response(JSON.stringify({ error: "Ugyldig origin" }), { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return new Response(JSON.stringify({ error: "Ikke autentisert" }), { status: 401 });
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
    return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
  }

  // Maks 30 opplastinger per minutt per konto.
  const limit = await allowRequestDb(`upload:minute:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        error: `For mange opplastinger. Prøv igjen om ${limit.retryAfterSeconds} sekunder.`,
      }),
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(JSON.stringify({ error: "Ingen fil valgt" }), { status: 400 });
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
        return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
      }
      const workOrder = await prisma.workOrder.findFirst({
        where: { id: workOrderId, ...workOrderScope(user) },
        select: { departmentId: true, customerId: true },
      });
      if (!workOrder) {
        return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
      }
      ownerType = "WORK_ORDER";
      ownerId = workOrderId;
      departmentId = workOrder.departmentId;
      ownerCustomerId = workOrder.customerId;
    } else if (customerId) {
      if (!hasPermission(user, "customers.manage")) {
        return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
      }
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, departmentId: true },
      });
      if (!customer) {
        return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
      }
      ownerType = "CUSTOMER";
      ownerId = customer.id;
      departmentId = customer.departmentId;
      ownerCustomerId = customer.id;
    } else if (purpose === "document") {
      if (!hasPermission(user, "documents.manage")) {
        return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
      }
      ownerType = "DOCUMENT";
      ownerId = null;
    } else if (purpose === "branding") {
      // Logo vises for alle innloggede, også kundeportalen.
      if (!hasPermission(user, "settings.manage")) {
        return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
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
      return new Response(JSON.stringify({ error: "Ugyldig filtype. Bare bilder og PDF er tillatt." }), { status: 400 });
    }

    // Max 100MB (stemmer overens med proxyClientMaxBodySize i next.config.ts)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return new Response(JSON.stringify({ error: "Filen er for stor (maks 100MB)" }), { status: 400 });
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
      return new Response(
        JSON.stringify({ error: "Daglig lagringskvote er nådd. Prøv igjen senere." }),
        { status: 429 },
      );
    }

    // Komprimer bilder før de skrives til disk. Feltbilder kan være store;
    // vi begrenser til 2000 px og reduserer kvaliteten. PDF-er røres ikke.
    let buffer = Buffer.from(await file.arrayBuffer());
    let finalExtension = fileExtension;
    let finalMime = file.type;
    let finalBytes = file.size;

    if (file.type.startsWith("image/") && file.type !== "image/gif") {
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
          finalExtension = "png";
          finalMime = "image/png";
        } else if (file.type === "image/webp") {
          buffer = await pipeline.webp({ quality: 82 }).toBuffer();
          finalExtension = "webp";
          finalMime = "image/webp";
        } else {
          buffer = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
          finalExtension = "jpg";
          finalMime = "image/jpeg";
        }
        finalBytes = buffer.length;
      } catch (error) {
        console.error("Bildekomprimering feilet, bruker original:", error);
      }
    }

    // Lag unikt filnavn
    const fileName = `${crypto.randomUUID()}.${finalExtension}`;

    // Filene ligger utenfor public/ og leses gjennom /uploads/[...sti].
    // Se src/lib/uploads.ts for hvorfor.
    const uploadDirPath = uploadDir();

    // Sørg for at mappen eksisterer
    if (!fs.existsSync(uploadDirPath)) {
      fs.mkdirSync(uploadDirPath, { recursive: true });
    }

    // Turbopack skal ikke prøve å spore opplastingsmappen: den er en dynamisk
    // datamappe på containeren, ikke en del av app-bundelen.
    const filePath = path.join(/*turbopackIgnore: true*/ uploadDirPath, fileName);
    fs.writeFileSync(filePath, buffer);

    // Registrer metadata. Feiler det, fjernes filen igjen slik at disken ikke
    // får filer uten tilgangsmetadata.
    try {
      await prisma.upload.create({
        data: {
          storedName: fileName,
          originalName: cleanText(file.name, { maxLength: LIMITS.line }) || "fil",
          mimeType: finalMime,
          size: finalBytes,
          ownerType,
          ownerId,
          departmentId,
          customerId: ownerCustomerId,
          uploadedById: user.id,
        },
      });
    } catch (error) {
      console.error("Kunne ikke registrere opplasting:", error);
      try {
        fs.unlinkSync(filePath);
      } catch {}
      return new Response(JSON.stringify({ error: "Kunne ikke lagre filen" }), { status: 500 });
    }

    // Returner fil-URL
    const fileUrl = `/uploads/${fileName}`;

    return new Response(JSON.stringify({
      success: true,
      fileUrl,
      // Filnavnet vises bare i grensesnittet; det lagres ikke og brukes aldri
      // som sti på disk (se filnavnet over).
      fileName: cleanText(file.name, { maxLength: LIMITS.line }),
      fileSize: finalBytes,
      fileType: finalMime
    }), { status: 200 });
  } catch (error) {
    console.error("Feil ved opplasting:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke laste opp fil" }), { status: 500 });
  }
}
