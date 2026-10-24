import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";

/** Signaturbilder er små; 5 MB dekodet er rikelig for en underskrift. */
const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;

/** Bare bildeformatene signaturpaden kan lagre. */
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp);base64,[a-z\d+/=\s]+$/i;

const EXT_BY_SUBTYPE: Record<string, string> = {
  png: ".png",
  jpg: ".jpg",
  jpeg: ".jpg",
  webp: ".webp",
};

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

/** Kladdesignaturer per bruker og døgn. Feltbrukere kan laste opp mange bilder;
 * grensene skal ikke treffes i normal bruk (50 bilder x 4 økter), men stopper
 * en kompromittert konto fra å fylle volumet. */
export const MAX_USER_SIGNATURE_UPLOADS = 400;
export const MAX_USER_DAILY_SIGNATURE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Lagrer en signatur som er tegnet i nettleseren (data-URL) som en vanlig
 * opplastet fil med tilhørende `Upload`-rad.
 *
 * Rapporter skal ikke bære bildedataene i selve raden: det gjør listespørringer
 * tunge og dupliserer megabytes for hver rapport. Filen får et tilfeldig navn,
 * og `Upload`-raden gir `/uploads`-ruten den tilgangskontrollen den trenger.
 *
 * Kastes det en feil under databaseinnsettingen, slettes filen igjen slik at
 * disken ikke fylles av foreldreløse signaturbilder.
 */
export async function storeDataImage(
  dataUrl: string,
  ctx: {
    /**
     * `USER` brukes for signaturer som ennå bare finnes i en kladd. De blir
     * først knyttet til oppdraget når rapporten signeres (se
     * `resolveSignature`), og kan da ryddes bort sammen med kladden.
     */
    ownerType: "WORK_ORDER" | "USER";
    ownerId: string;
    departmentId: string | null;
    customerId: string | null;
    uploadedById: string;
  },
): Promise<string> {
  const trimmed = typeof dataUrl === "string" ? dataUrl.trim() : "";

  // Avvis svært store strenger før vi dekoder, så vi ikke bruker minne på dem.
  if (trimmed.length === 0 || trimmed.length > MAX_SIGNATURE_BYTES * 2) {
    throw new Error("Ugyldig eller for stor signatur");
  }
  if (!DATA_IMAGE.test(trimmed)) {
    throw new Error("Ugyldig bildedata for signatur");
  }

  const commaIndex = trimmed.indexOf(",");
  const header = trimmed.slice(5, commaIndex); // image/png;base64
  const subtype = header.split(";")[0].split("/")[1]?.toLowerCase() ?? "";
  const extension = EXT_BY_SUBTYPE[subtype];
  if (!extension) throw new Error("Ugyldig bildetype for signatur");

  const base64 = trimmed.slice(commaIndex + 1);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new Error("Tom signatur");
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    throw new Error("Signaturbildet er for stort");
  }

  const mimeType = subtype === "jpg" || subtype === "jpeg" ? "image/jpeg" : `image/${subtype}`;
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  // En identisk kladdesignatur kan gjenbrukes. Da slipper vi både ny fil og ny
  // Upload-rad, og en tekniker som lagrer samme signatur mange ganger fyller
  // ikke lagringsvolumet.
  if (ctx.ownerType === "USER") {
    const existing = await prisma.upload.findFirst({
      where: {
        contentHash,
        ownerType: "USER",
        ownerId: ctx.uploadedById,
        uploadedById: ctx.uploadedById,
      },
      select: { storedName: true },
    });
    if (existing) {
      try {
        await fs.access(path.join(uploadDir(), existing.storedName));
        return `/uploads/${existing.storedName}`;
      } catch {
        // Filen er borte; rydd metadata og lag en ny kopi under.
        await prisma.upload.deleteMany({ where: { storedName: existing.storedName } });
      }
    }

    const count = await prisma.upload.count({
      where: { ownerType: "USER", ownerId: ctx.uploadedById },
    });
    if (count >= MAX_USER_SIGNATURE_UPLOADS) {
      throw new Error("For mange lagrede kladdesignaturer");
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await prisma.upload.aggregate({
      where: {
        uploadedById: ctx.uploadedById,
        ownerType: "USER",
        createdAt: { gte: since },
      },
      _sum: { size: true },
    });
    if ((used._sum.size ?? 0) + buffer.length > MAX_USER_DAILY_SIGNATURE_BYTES) {
      throw new Error("Daglig lagringskvote for kladdesignaturer er nådd");
    }
  }

  const storedName = `${randomUUID()}${extension}`;
  const directory = uploadDir();
  const filePath = path.join(directory, storedName);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, buffer);

  try {
    await prisma.upload.create({
      data: {
        storedName,
        originalName: `signatur${extension}`,
        mimeType,
        size: buffer.length,
        ownerType: ctx.ownerType,
        ownerId: ctx.ownerId,
        departmentId: ctx.departmentId,
        customerId: ctx.customerId,
        uploadedById: ctx.uploadedById,
        contentHash,
      },
    });
  } catch (error) {
    // Databasen avviste raden – da skal ikke filen bli liggende igjen.
    await fs.unlink(filePath).catch(() => undefined);
    throw error;
  }

  return `/uploads/${storedName}`;
}

/**
 * Sletter en tidligere signaturfil, men bare når `Upload`-raden faktisk eies av
 * det samme oppdraget. Filer som tilhører en annen rapport, kunde eller et
 * dokument røres ikke. Feil ignoreres – opprydding er best effort.
 */
export async function deleteUploadIfOwned(
  fileUrl: string | null | undefined,
  owner: { ownerType: "WORK_ORDER" | "USER"; ownerId: string },
): Promise<void> {
  if (!fileUrl || !UPLOAD_URL.test(fileUrl)) return;

  const storedName = fileUrl.slice(fileUrl.lastIndexOf("/") + 1);
  if (!storedName) return;

  try {
    // Slettingen er betinget i selve SQL-setningen, slik at en samtidig
    // eierskapsoverføring ikke kan føre til at feil fil slettes.
    const result = await prisma.upload.deleteMany({
      where: {
        storedName,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
      },
    });
    if (result.count === 0) return;

    // Slett raden først. Da kan ikke filen lenger nås gjennom /uploads, selv om
    // unlink skulle feile.
    await fs.unlink(path.join(uploadDir(), storedName)).catch(() => undefined);
  } catch (error) {
    console.error("Kunne ikke slette gammel signatur:", error);
  }
}
