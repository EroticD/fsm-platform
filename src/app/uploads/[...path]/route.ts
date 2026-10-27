import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { contentTypeFor, uploadDir } from "@/lib/uploads";
import { getCurrentUser } from "@/lib/session";
import { canReadUpload } from "@/lib/upload-access";

// Bilder og vedlegg leses fra disk for hver forespørsel, slik at filer som
// lastes opp mens appen kjører blir synlige umiddelbart.
export const dynamic = "force-dynamic";

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
    if (!canReadUpload(user, upload)) {
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
      const workOrder = await prisma.workOrder.findUnique({
        where: { id: upload.ownerId },
        select: { deletedAt: true },
      });
      if (!workOrder || workOrder.deletedAt) {
        return new NextResponse("Fant ikke filen", { status: 404 });
      }
    }
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
