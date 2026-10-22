import fs from "fs";
import path from "path";
import crypto from "crypto";
import { uploadDir } from "@/lib/uploads";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

export async function POST(request: Request) {
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
    hasPermission(user, "equipment.manage");

  if (!canUpload) {
    return new Response(JSON.stringify({ error: "Ingen tilgang" }), { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(JSON.stringify({ error: "Ingen fil valgt" }), { status: 400 });
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

    // Lag unikt filnavn
    const fileName = `${crypto.randomUUID()}.${fileExtension}`;

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
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    fs.writeFileSync(filePath, buffer);

    // Returner fil-URL
    const fileUrl = `/uploads/${fileName}`;

    return new Response(JSON.stringify({
      success: true,
      fileUrl,
      // Filnavnet vises bare i grensesnittet; det lagres ikke og brukes aldri
      // som sti på disk (se filnavnet over).
      fileName: cleanText(file.name, { maxLength: LIMITS.line }),
      fileSize: file.size,
      fileType: file.type
    }), { status: 200 });
  } catch (error) {
    console.error("Feil ved opplasting:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke laste opp fil" }), { status: 500 });
  }
}
