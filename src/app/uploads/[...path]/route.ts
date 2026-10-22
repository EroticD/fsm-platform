import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { contentTypeFor, uploadDir } from "@/lib/uploads";
import { getCurrentUser } from "@/lib/session";

// Bilder og vedlegg leses fra disk for hver forespørsel, slik at filer som
// lastes opp mens appen kjører blir synlige umiddelbart.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Bilder og vedlegg kan inneholde kundedata. UUID-navnet er ikke en
  // tilgangskontroll i seg selv, så alle filer krever en gyldig økt.
  // Merkevarelogoen er en ekstern URL (se Branding.logoUrl) og rammes ikke.
  const user = await getCurrentUser();
  if (!user?.isActive) {
    return new NextResponse("Ikke autentisert", { status: 401 });
  }

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
        "X-Content-Type-Options": "nosniff",
        // Filnavnet er en tilfeldig UUID, så innholdet endres aldri. private:
        // filen skal ikke mellomlagres i delte proxyer.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Fant ikke filen", { status: 404 });
  }
}
