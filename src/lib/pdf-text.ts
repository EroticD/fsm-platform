import fs from "fs";
import os from "os";
import path from "path";
import { execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import { uploadDir } from "@/lib/uploads";

const execFile = promisify(execFileCallback);

/** Store PDF-er kan gi mye tekst; standardgrensen på 1 MB er for lav. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Bare filer i opplastingsmappen skal leses. Dokumentrader kan i prinsippet
 * inneholde en hvilken som helst sti (eldre data eller en kompromittert rad),
 * så tekstuttrekket validerer på nytt før det åpner filen. Alle interne
 * kallere henter filer fra opplastingsruten, så den lokale sti-varianten er
 * ikke nødvendig.
 */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Ekstraherer tekst fra en PDF-fil. Returnerer full tekst og per-side tekst.
 * Bruker pdftotext (poppler) hvis tilgjengelig, ellers pdf-parse.
 * For skannede PDF-er (lite tekst) forsøkes OCR via pdftoppm + tesseract.
 *
 * Eksterne programmer kjøres asynkront. En stor PDF kan ta flere minutter, og
 * med `execFileSync` ville hele Node-prosessen – og dermed alle brukere –
 * stått stille mens den jobbet.
 */
export async function extractPdfText(filePath: string): Promise<{ text: string; pages: { page: number; text: string }[] }> {
  if (!UPLOAD_URL.test(filePath)) {
    console.error(
      `Avviste PDF-sti utenfor opplastingsmappen: ${JSON.stringify(filePath)}`,
    );
    return { text: "", pages: [] };
  }

  const fullPath = path.join(uploadDir(), path.basename(filePath));

  if (!fs.existsSync(fullPath)) {
    return { text: "", pages: [] };
  }

  // 1. Prøv pdftotext (poppler) - mest pålitelig
  let text = "";
  let pages: { page: number; text: string }[] = [];
  try {
    const { stdout: raw } = await execFile("pdftotext", ["-layout", fullPath, "-"], {
      encoding: "utf8",
      timeout: 30000,
      killSignal: "SIGKILL",
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    // pdftotext bruker form feed mellom sider
    const split = raw.split(/\f/);
    pages = split
      .map((t, i) => ({ page: i + 1, text: t.trim() }))
      .filter((p) => p.text.length > 0);
    text = pages.map((p) => p.text).join("\n\n");
  } catch (err) {
    console.error("pdftotext feilet, faller tilbake til pdf-parse:", err);
    // Fallback til pdf-parse
    try {
      const { PDFParse } = await import("pdf-parse");
      const buffer = fs.readFileSync(fullPath);
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      await parser.destroy();
      pages = (textResult.pages || []).map((p: any) => ({
        page: p.num,
        text: (p.text || "").trim(),
      })).filter((p: any) => p.text.length > 0);
      text = textResult.text || pages.map((p: any) => p.text).join("\n\n");
    } catch (e2) {
      console.error("pdf-parse feilet også:", e2);
    }
  }

  // 2. OCR-fallback for skannede PDF-er (lite tekst ekstrahert)
  if (text.trim().length < 50) {
    try {
      const ocrPages = await ocrPdf(fullPath);
      if (ocrPages.length > 0) {
        pages = ocrPages;
        text = ocrPages.map((p) => p.text).join("\n\n");
      }
    } catch (err) {
      console.error("OCR feilet:", err);
    }
  }

  return { text: text.trim(), pages };
}

/**
 * OCR av en PDF ved å rendre sidene til bilder med pdftoppm og kjøre
 * tesseract.js på hver side.
 */
async function ocrPdf(fullPath: string): Promise<{ page: number; text: string }[]> {
  // mkdtemp gir en unik, privat mappe under systemets temp-område.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsm-ocr-"));

  try {
    // Render sider til PNG. Dette er asynkront, slik at resten av appen kan
    // svare på forespørsler mens OCR-jobben står på.
    await execFile(
      "pdftoppm",
      ["-png", "-r", "200", fullPath, path.join(tmpDir, "page")],
      { timeout: 120000, killSignal: "SIGKILL" },
    );

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".png")).sort();
    const { createWorker } = await import("tesseract.js");

    // I Docker ligger språkdata ferdig i TESSDATA_DIR (uten nettverkstilgang).
    // Uten den henter tesseract.js dem fra nett og cacher i temp-mappen.
    const tessdataDir = process.env.TESSDATA_DIR;
    const worker = await createWorker(
      "nor+eng",
      undefined,
      tessdataDir
        ? { langPath: tessdataDir, gzip: false, cachePath: os.tmpdir(), cacheMethod: "none" }
        : { cachePath: os.tmpdir() },
    );

    const results: { page: number; text: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const imgPath = path.join(tmpDir, files[i]);
      const { data } = await worker.recognize(imgPath);
      const text = (data.text || "").trim();
      if (text.length > 0) {
        results.push({ page: i + 1, text });
      }
    }
    await worker.terminate();
    return results;
  } finally {
    // Rydd opp temp-filer
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Finn første side som inneholder søkeordet (case-insensitive).
 */
export function findPageForTerm(pages: { page: number; text: string }[], term: string): number | null {
  const lower = term.toLowerCase();
  for (const p of pages) {
    if (p.text.toLowerCase().includes(lower)) return p.page;
  }
  return null;
}
