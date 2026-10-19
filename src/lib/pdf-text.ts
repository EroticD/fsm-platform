import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { uploadDir } from "@/lib/uploads";

/**
 * Ekstraherer tekst fra en PDF-fil. Returnerer full tekst og per-side tekst.
 * Bruker pdftotext (poppler) hvis tilgjengelig, ellers pdf-parse.
 * For skannede PDF-er (lite tekst) forsøkes OCR via pdftoppm + tesseract.
 */
export async function extractPdfText(filePath: string): Promise<{ text: string; pages: { page: number; text: string }[] }> {
  const fullPath = filePath.startsWith("/uploads/")
    ? path.join(uploadDir(), path.basename(filePath))
    : filePath;

  if (!fs.existsSync(fullPath)) {
    return { text: "", pages: [] };
  }

  // 1. Prøv pdftotext (poppler) - mest pålitelig
  let text = "";
  let pages: { page: number; text: string }[] = [];
  try {
    const raw = execFileSync("pdftotext", ["-layout", fullPath, "-"], { encoding: "utf8", timeout: 30000 });
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
    // Render sider til PNG
    execFileSync("pdftoppm", ["-png", "-r", "200", fullPath, path.join(tmpDir, "page")], {
      timeout: 120000,
    });

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