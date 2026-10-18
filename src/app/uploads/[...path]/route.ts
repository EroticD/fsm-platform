import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { contentTypeFor, uploadDir } from "@/lib/uploads";

// Bilder og vedlegg leses fra disk for hver forespørsel, slik at filer som
// lastes opp mens appen kjører blir synlige umiddelbart.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const root = uploadDir();
  const filePath = path.join(root, ...segments);

  // Aldri les filer utenfor opplastingsmappen.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return new NextResponse("Ugyldig sti", { status: 400 });
  }

  try {
    const data = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(filePath),
        // Filnavnet er en tilfeldig UUID, så innholdet endres aldri.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Fant ikke filen", { status: 404 });
  }
}
