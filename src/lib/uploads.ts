import path from "path";
import {
  contentTypeForKey,
  getStorageDriver,
  resolveUploadRoot,
  uploadTempDir as resolveUploadTempDir,
} from "@/lib/storage";

/**
 * Mappen opplastede filer lagres i når `STORAGE_DRIVER=local`.
 *
 * Filene ligger bevisst utenfor `public/`: Next.js leser listen over filer i
 * `public/` én gang ved oppstart, så filer som lastes opp mens appen kjører
 * ville ikke blitt servert før neste restart. I stedet leses de gjennom ruten
 * `/uploads/[...sti]`, som alltid går til lagringslaget.
 *
 * Ved `STORAGE_DRIVER=s3` er denne mappen bare en lokal arbeidsmappe for
 * midlertidige filer; selve innholdet ligger i objektlagringen. URL-ene er
 * fortsatt `/uploads/<filnavn>`.
 */
export function uploadDir(): string {
  return resolveUploadRoot();
}

/**
 * Basismappe for midlertidige filer. Multipart-parseren og oppryddingen
 * legger selv `.tmp` under denne. Lokal driver beholder den gamle plasseringen
 * i opplastingsmappen; S3 har ingen lokal rot og bruker `UPLOAD_TEMP_DIR`
 * (standard OS-temp, typisk `/tmp`).
 */
export function uploadTempDir(): string {
  if (process.env.UPLOAD_TEMP_DIR?.trim()) {
    return resolveUploadTempDir();
  }
  if ((process.env.STORAGE_DRIVER ?? "local").trim().toLowerCase() === "s3") {
    return resolveUploadTempDir();
  }
  return uploadDir();
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

/** Filtypen vi svarer med, ut fra filendelsen. */
export function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[extension] ?? contentTypeForKey(filePath);
}

/** Lagringslaget for opplastinger. */
export function uploadStorage() {
  return getStorageDriver();
}

export async function readUploadFile(storedName: string): Promise<Buffer> {
  return uploadStorage().read(storedName);
}

export async function statUploadFile(storedName: string) {
  return uploadStorage().stat(storedName);
}

export async function writeUploadFile(
  storedName: string,
  data: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<void> {
  await uploadStorage().write(storedName, data, {
    ...(contentType ? { contentType } : {}),
    cacheControl: "private, no-store",
  });
}

export async function deleteUploadFile(storedName: string): Promise<void> {
  await uploadStorage().delete(storedName);
}
