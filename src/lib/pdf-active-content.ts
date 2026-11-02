// i18n-ignore-file: driftslogger er ikke UI-tekst.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Aktivt innhold vi aldri vil sende videre i en PDF.
 *
 * PDF-spesifikasjonen lar en fil starte JavaScript, åpne eksterne programmer
 * (`/Launch`) og bygge inn vedlegg (`/EmbeddedFile`). Rapporter og
 * avtale-PDF-er skal bare være dokumenter, så slike navn fjernes før filen
 * forlater serveren. `/JS` er den korte formen for `/JavaScript`, og
 * `/RichMedia` kan brukes til samme type aktivt innhold.
 */
const ACTIVE_CONTENT_MARKERS = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
] as const;

/** qpdf kan overstyres i miljøer der binæren ligger et annet sted. */
function qpdfPath(): string {
  return process.env.QPDF_PATH?.trim() || "qpdf";
}
const QPDF_TIMEOUT_MS = 20_000;

export type PdfSanitizeResult =
  | { ok: true; buffer: Buffer; stripped: boolean }
  | { ok: false; reason: "active_content" | "sanitizer_unavailable" | "sanitizer_failed" };

/** Returnerer hvilke aktive konstruksjoner filen inneholder. */
export function detectPdfActiveContent(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  return ACTIVE_CONTENT_MARKERS.filter((marker) => text.includes(marker));
}

/**
 * Fjerner aktivt innhold med qpdf.
 *
 * qpdf bygger en ny dokumentkatalog og kopierer bare sidene fra originalen.
 * Dokumentnivå-handlinger, JavaScript, `/Launch` og innebygde filer blir
 * dermed ikke med. Vi skanner resultatet på nytt og nekter å levere filen
 * dersom noe aktivt innhold fortsatt finnes, eller dersom qpdf mangler.
 *
 * PDF-er uten aktive konstruksjoner returneres byte-for-byte uendret, slik at
 * vanlige rapport-PDF-er ikke koster en ekstra prosess.
 */
export async function sanitizePdfActiveContent(
  buffer: Buffer,
): Promise<PdfSanitizeResult> {
  if (detectPdfActiveContent(buffer).length === 0) {
    return { ok: true, buffer, stripped: false };
  }

  let tempDir: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-pdf-"));
    const input = path.join(tempDir, "input.pdf");
    const output = path.join(tempDir, "output.pdf");
    await fs.writeFile(input, buffer);

    try {
      await execFileAsync(
        qpdfPath(),
        ["--empty", "--pages", input, "1-z", "--", output],
        {
          timeout: QPDF_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
    } catch (error) {
      // qpdf bruker exit-kode 3 når den fullførte med advarsler (for eksempel
      // en reparert, men lesbar PDF). Filen er da fortsatt skrevet, og vi
      // kontrollerer resultatet selv under.
      const exitCode =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : null;
      if (exitCode !== 3) throw error;
    }

    const cleaned = await fs.readFile(output);
    if (
      cleaned.length < 8 ||
      cleaned.subarray(0, 5).toString("latin1") !== "%PDF-"
    ) {
      return { ok: false, reason: "sanitizer_failed" };
    }
    if (detectPdfActiveContent(cleaned).length > 0) {
      return { ok: false, reason: "active_content" };
    }

    console.warn("PDF med aktivt innhold ble sanert", {
      markers: detectPdfActiveContent(buffer),
      bytesBefore: buffer.length,
      bytesAfter: cleaned.length,
    });
    return { ok: true, buffer: cleaned, stripped: true };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null;
    if (code === "ENOENT") {
      console.error(
        "PDF inneholder aktivt innhold, men qpdf er ikke tilgjengelig",
      );
      return { ok: false, reason: "sanitizer_unavailable" };
    }
    console.error("Kunne ikke sanere PDF med aktivt innhold", {
      reason: code === "ETIMEDOUT" ? "timeout" : "qpdf_failed",
    });
    return { ok: false, reason: "sanitizer_failed" };
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
