import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import prisma from "@/lib/prisma";
import {
  deleteUploadFile,
  statUploadFile,
  uploadStorage,
  writeUploadFile,
} from "@/lib/uploads";
import { hashFileStream, linkFileOver } from "@/lib/upload-dedupe";

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
        if (await statUploadFile(existing.storedName)) {
          return `/uploads/${existing.storedName}`;
        }
        throw new Error("Filen mangler");
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

  await writeUploadFile(storedName, buffer, mimeType);

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
    await deleteUploadFile(storedName).catch(() => undefined);
    throw error;
  }

  return `/uploads/${storedName}`;
}

export type StoredUploadFile = {
  storedName: string;
  /** SHA-256 av det lagrede innholdet, satt på `Upload`-raden. */
  contentHash: string;
  /** Sant når filen ble hardlenket til en identisk, eldre opplasting. */
  deduped: boolean;
};

/**
 * Absolutt sti for en lagringsnøkkel, men bare når lagringen er lokal.
 * S3 (og testdobbeltgjengere uten `uploadStorage`) gir null, og da skrives
 * filen som normalt.
 */
async function localUploadPath(storedName: string): Promise<string | null> {
  try {
    const storage = uploadStorage();
    if (storage.kind !== "local") return null;
    return storage.localPath(storedName);
  } catch {
    return null;
  }
}

/**
 * Lager `storedName` som en hardlenke til en eldre opplasting med samme
 * innhold. Filen får nytt navn, men deler inode med originalen, så innholdet
 * bare lagres én gang. `storedName` er unik i databasen, så hver rad eier sin
 * egen lenke og sletting av én rad fjerner aldri en annen rads fil.
 *
 * Returnerer false når ingenting ble lenket – da skriver kalleren filen selv.
 * Alle feil svelges med vilje: dedupe er en diskoptimalisering, ikke noe en
 * opplasting skal feile på.
 */
async function linkExistingContent(
  storedName: string,
  contentHash: string,
): Promise<boolean> {
  if (!contentHash) return false;

  const target = await localUploadPath(storedName);
  if (!target) return false;

  let candidates: { storedName: string }[];
  try {
    candidates = await prisma.upload.findMany({
      where: { contentHash },
      select: { storedName: true },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
  } catch {
    return false;
  }

  for (const candidate of candidates) {
    if (!candidate.storedName || candidate.storedName === storedName) continue;
    const source = await localUploadPath(candidate.storedName);
    if (!source) continue;

    try {
      const info = await fs.stat(source);
      if (!info.isFile()) continue;
      // Atomisk: lenken lages under et midlertidig navn og renames over målet.
      await linkFileOver(source, target);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Skriver en ferdig behandlet buffer til opplastingsmappen og returnerer
 * innholdshashen. En identisk fil som allerede ligger der, gjenbrukes som
 * hardlenke i stedet for å skrive en ny kopi.
 */
export async function storeUploadBytes(input: {
  storedName: string;
  data: Buffer;
  mimeType: string;
}): Promise<StoredUploadFile> {
  const contentHash = createHash("sha256").update(input.data).digest("hex");

  if (await linkExistingContent(input.storedName, contentHash)) {
    return { storedName: input.storedName, contentHash, deduped: true };
  }

  await writeUploadFile(input.storedName, input.data, input.mimeType);
  return { storedName: input.storedName, contentHash, deduped: false };
}

/**
 * Som `storeUploadBytes`, men for filer som allerede ligger i en midlertidig
 * fil. Innholdet leses strømmende for hashing, slik at en stor PDF ikke må
 * inn i minnet. Kilden røres ikke når den lenkes; kalleren rydder den.
 */
export async function storeUploadFromFile(input: {
  storedName: string;
  sourcePath: string;
  mimeType: string;
}): Promise<StoredUploadFile> {
  let contentHash = "";
  try {
    contentHash = await hashFileStream(input.sourcePath);
  } catch {
    // Uten hash kan vi ikke dedupe, men opplastingen skal fortsatt lykkes.
    contentHash = "";
  }

  if (contentHash && (await linkExistingContent(input.storedName, contentHash))) {
    return { storedName: input.storedName, contentHash, deduped: true };
  }

  await uploadStorage().writeFromFile(input.storedName, input.sourcePath, {
    contentType: input.mimeType,
    cacheControl: "private, no-store",
  });
  return {
    storedName: input.storedName,
    contentHash,
    deduped: false,
  };
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

    // `storedName` er unik, men hardlenker gjør at flere rader kan dele samme
    // innhold under ulike navn. Denne raden eier bare sitt eget navn, så vi
    // fjerner lenken bare når ingen annen rad peker på samme navn.
    const remaining = await prisma.upload.count({ where: { storedName } });
    if (remaining > 0) return;

    // Slett raden først. Da kan ikke filen lenger nås gjennom /uploads, selv om
    // slettingen i lagringslaget skulle feile.
    await deleteUploadFile(storedName).catch(() => undefined);
  } catch (error) {
    console.error("Kunne ikke slette gammel signatur:", error);
  }
}
