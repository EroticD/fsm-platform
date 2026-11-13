import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * Komprimering av opplastede PDF-er med Ghostscript.
 *
 * Rapport-PDF-er er allerede komprimert når de genereres, så dette gjelder
 * dokumentbiblioteket: skannede arkiv-PDF-er ligger ofte på 5–20 MB med
 * 300–600 dpi-bilder. `/ebook` (150 dpi, JPEG) gir typisk 30–60 % reduksjon
 * uten at dokumentet blir uleselig.
 *
 * OCR-teksten ligger separat i `Document.pageTexts`, så fulltekstsøket er
 * uavhengig av om bildeoppløsningen senkes.
 *
 * Skrivingen er alltid trygg: Ghostscript skriver til en temp-fil i samme
 * mappe, resultatet valideres, og originalen byttes bare ut med `rename` når
 * innholdet faktisk er minst 10 % mindre. Feiler noe som helst, blir
 * originalen liggende urørt.
 */

export type CompressResult = {
  compressed: number;
  skipped: number;
  failed: number;
  savedBytes: number;
};

export type CompressQuality = "ebook" | "screen" | "printer";

export type CompressOutcome =
  | { ok: true; bytesBefore: number; bytesAfter: number }
  | {
      ok: false;
      /**
       * `failed` dekker både ekte feil (Ghostscript feilet, ugyldig PDF,
       * tidsavbrudd) og PDF-er der gevinsten var under 10 %. Originalen er i
       * begge tilfeller uendret.
       */
      reason: "missing" | "too_small" | "no_ghostscript" | "failed";
    };

/** Ghostscript kan bruke lang tid på store skannede PDF-er. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Under dette er ikke byttet verdt risikoen; da beholdes originalen. */
const MIN_SAVING_RATIO = 0.1;
const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
const PDF_TRAILER = "%%EOF";
const PROBE_TIMEOUT_MS = 10_000;

type RunResult = { code: number | null; enoent: boolean; timedOut: boolean };

/**
 * Kjører et program uten shell. Argumentene sendes som array, så filnavn med
 * mellomrom, anførselstegn eller `;` aldri kan tolkes som kommandoer.
 */
function run(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    let settled = false;

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, { stdio: "ignore" });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ code: null, enoent: code === "ENOENT", timedOut: false });
      return;
    }

    const timer = setTimeout(() => {
      // SIGKILL: en hengt Ghostscript skal ikke kunne holde igjen filen.
      child.kill("SIGKILL");
      finish({ code: null, enoent: false, timedOut: true });
    }, timeoutMs);

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: null, enoent: error.code === "ENOENT", timedOut: false });
    });
    child.on("close", (code: number | null) => {
      finish({ code, enoent: false, timedOut: false });
    });
  });
}

/** Finnes Ghostscript på PATH? Sjekkes med en ekte kjøring, ikke `which`. */
export async function hasGhostscript(): Promise<boolean> {
  const result = await run("gs", ["--version"], PROBE_TIMEOUT_MS);
  return !result.enoent && !result.timedOut && result.code === 0;
}

/** Leser starten og slutten av filen og avgjør om den ser ut som en PDF. */
async function looksLikePdf(filePath: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const { size } = await handle.stat();
    if (size < PDF_MAGIC.length + PDF_TRAILER.length) return false;

    const head = Buffer.alloc(PDF_MAGIC.length);
    await handle.read(head, 0, head.length, 0);
    if (!head.equals(PDF_MAGIC)) return false;

    // Kuttet output fra en avbrutt Ghostscript-kjøring mangler %%EOF.
    const tailLength = Math.min(2048, size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    return tail.toString("latin1").includes(PDF_TRAILER);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function unlinkQuietly(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Temp-filen kan allerede være borte (rename eller avbrutt kjøring).
  }
}

/**
 * Komprimerer én PDF på stedet.
 *
 * Returnerer `ok: false` med en grunn i stedet for å kaste: et skript som
 * går gjennom hundrevis av filer skal ikke stoppe på én ødelagt PDF.
 */
export async function compressPdfFile(input: {
  path: string;
  minBytes?: number;
  quality?: CompressQuality;
  /** Tidsavbrudd per fil i millisekunder. */
  timeoutMs?: number;
}): Promise<CompressOutcome> {
  const filePath = input.path;
  const minBytes = input.minBytes ?? 0;
  const quality = input.quality ?? "ebook";
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let before;
  try {
    before = await fs.stat(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === "ENOENT" ? "missing" : "failed" };
  }
  if (!before.isFile()) return { ok: false, reason: "missing" };
  if (before.size < minBytes) return { ok: false, reason: "too_small" };

  if (!(await hasGhostscript())) return { ok: false, reason: "no_ghostscript" };

  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.compressing.pdf`,
  );

  try {
    const result = await run(
      "gs",
      [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.7",
        `-dPDFSETTINGS=/${quality}`,
        "-dNOPAUSE",
        "-dBATCH",
        // SAFER begrenser filtilgang til filene som er oppgitt på kommandolinjen.
        "-dSAFER",
        "-dQUIET",
        // Behold sideskannens orientering; rotering kan gjøre skannede sider
        // feilvendt i forhåndsvisningen.
        "-dAutoRotatePages=/None",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        `-sOutputFile=${tempPath}`,
        filePath,
      ],
      timeoutMs,
    );

    if (result.enoent) {
      await unlinkQuietly(tempPath);
      return { ok: false, reason: "no_ghostscript" };
    }
    if (result.code !== 0) {
      await unlinkQuietly(tempPath);
      return { ok: false, reason: "failed" };
    }

    const after = await fs.stat(tempPath).catch(() => null);
    if (!after || !after.isFile() || after.size === 0) {
      await unlinkQuietly(tempPath);
      return { ok: false, reason: "failed" };
    }
    if (!(await looksLikePdf(tempPath))) {
      await unlinkQuietly(tempPath);
      return { ok: false, reason: "failed" };
    }

    const threshold = Math.floor(before.size * (1 - MIN_SAVING_RATIO));
    if (after.size > threshold) {
      // Ikke verdt byttet: like stor eller bare marginalt mindre.
      await unlinkQuietly(tempPath);
      return { ok: false, reason: "failed" };
    }

    // Behold filrettighetene til originalen, ellers kan f.eks. 0640 bli 0644.
    await fs.chmod(tempPath, before.mode & 0o777).catch(() => {});
    // Samme katalog, så rename er atomisk: leseren ser enten gammel eller ny fil.
    await fs.rename(tempPath, filePath);

    return { ok: true, bytesBefore: before.size, bytesAfter: after.size };
  } catch {
    await unlinkQuietly(tempPath);
    return { ok: false, reason: "failed" };
  }
}
