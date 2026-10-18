import path from "path";

/**
 * Mappen opplastede filer lagres i.
 *
 * Filene ligger bevisst utenfor `public/`: Next.js leser listen over filer i
 * `public/` én gang ved oppstart, så filer som lastes opp mens appen kjører
 * ville ikke blitt servert før neste restart. I stedet leses de gjennom
 * ruten `/uploads/[...sti]`, som alltid går til disk.
 *
 * Mappen kan flyttes med miljøvariabelen UPLOAD_DIR – i Docker peker den på et
 * montert volum, slik at bildene overlever en ny container.
 */
export function uploadDir(): string {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "uploads");
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
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
