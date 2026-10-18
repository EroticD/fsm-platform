import { getServerSession } from "next-auth/next";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { uploadDir } from "@/lib/uploads";

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return new Response(JSON.stringify({ error: "Ikke autentisert" }), { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(JSON.stringify({ error: "Ingen fil valgt" }), { status: 400 });
    }

    // Valider filtype (bare bilder og PDF)
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({ error: "Ugyldig filtype. Bare bilder og PDF er tillatt." }), { status: 400 });
    }

    // Max 10MB
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return new Response(JSON.stringify({ error: "Filen er for stor (maks 10MB)" }), { status: 400 });
    }

    // Lag unik filnavn
    const fileExtension = file.name.split(".").pop();
    const fileName = `${crypto.randomUUID()}.${fileExtension}`;

    // Filene ligger utenfor public/ og leses gjennom /uploads/[...sti].
    // Se src/lib/uploads.ts for hvorfor.
    const uploadDirPath = uploadDir();

    // Sørg for at mappen eksisterer
    if (!fs.existsSync(uploadDirPath)) {
      fs.mkdirSync(uploadDirPath, { recursive: true });
    }

    const filePath = path.join(uploadDirPath, fileName);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    fs.writeFileSync(filePath, buffer);

    // Returner fil-URL
    const fileUrl = `/uploads/${fileName}`;

    return new Response(JSON.stringify({
      success: true,
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    }), { status: 200 });
  } catch (error) {
    console.error("Feil ved opplasting:", error);
    return new Response(JSON.stringify({ error: "Kunne ikke laste opp fil" }), { status: 500 });
  }
}
