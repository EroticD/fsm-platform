#!/usr/bin/env node
/**
 * Komprimerer opplastede PDF-er i dokumentbiblioteket med Ghostscript.
 *
 *   npm run pdfs:compress                        # tørrkjøring: list kandidater
 *   npm run pdfs:compress -- --apply             # komprimer
 *   npm run pdfs:compress -- --apply --limit 5   # prøv på fem filer først
 *   npm run pdfs:compress -- --apply --quality screen --min-bytes 100000
 *
 * Originalen legges i `uploads/.pdf-originals/<dato>/` før den byttes ut, slik
 * at en fil kan hentes tilbake hvis komprimeringen ødela noe. Mappen kan
 * slettes når filene er kontrollert. Bare filer som faktisk blir minst 10 %
 * mindre byttes ut, og `Document.fileSize` oppdateres bare da.
 *
 * Rapporter genereres allerede komprimert; dette gjelder skannede dokumenter.
 * OCR-teksten ligger i `Document.pageTexts`, så søket påvirkes ikke.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { compressPdfFile, hasGhostscript } from "../src/lib/pdf-compress";
import type { CompressQuality } from "../src/lib/pdf-compress";
import prisma from "../src/lib/prisma";
import { storageKind } from "../src/lib/storage/config";
import { uploadDir } from "../src/lib/uploads";

const QUALITIES: CompressQuality[] = ["ebook", "screen", "printer"];

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

/** Datoen karantenen legges under. Lokal tid, så den følger driftsdøgnet. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Oversetter `/uploads/<navn>` til en absolutt sti under opplastingsmappen.
 * Stier som peker utenfor roten avvises, så et skript mot databasen aldri kan
 * skrive utenfor `UPLOAD_DIR`.
 */
function resolveUploadPath(root: string, filePath: string): string | null {
  if (!filePath.startsWith("/uploads/")) return null;
  const relative = filePath.slice("/uploads/".length);
  if (!relative || relative.includes("\0")) return null;
  const absolute = path.resolve(root, relative);
  const prefix = path.resolve(root) + path.sep;
  return absolute.startsWith(prefix) ? absolute : null;
}

/**
 * Legger originalen i karantene med hardlenke (samme inode, ingen ekstra disk).
 * Faller tilbake til kopi hvis filsystemet ikke tillater hardlenker.
 */
async function quarantine(
  original: string,
  quarantineDir: string,
): Promise<string> {
  await fs.mkdir(quarantineDir, { recursive: true });
  const target = path.join(quarantineDir, path.basename(original));
  // En ny kjøring samme dag skal ikke kollidere med gårsdagens lenke.
  await fs.rm(target, { force: true });
  try {
    await fs.link(original, target);
  } catch {
    await fs.copyFile(original, target);
  }
  return target;
}

const apply = process.argv.includes("--apply");
const minBytesRaw = flagValue("--min-bytes");
const minBytes =
  minBytesRaw === undefined ? 0 : Number.parseInt(minBytesRaw, 10);
const quality = (flagValue("--quality") ?? "ebook") as CompressQuality;
const limitRaw = flagValue("--limit");
const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);

if (!Number.isFinite(minBytes) || minBytes < 0) {
  console.error("Ugyldig --min-bytes. Oppgi et ikke-negativt heltall.");
  process.exit(1);
}
if (!QUALITIES.includes(quality)) {
  console.error(
    `Ugyldig --quality «${quality}». Gyldige verdier: ${QUALITIES.join(", ")}.`,
  );
  process.exit(1);
}
if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
  console.error("Ugyldig --limit. Oppgi et positivt heltall.");
  process.exit(1);
}
if (storageKind() === "s3") {
  console.error(
    "PDF-komprimering krever STORAGE_DRIVER=local. Ved S3 ligger innholdet i " +
      "objektlagringen, ikke i UPLOAD_DIR, og skriptet kan ikke bytte filene " +
      "atomisk. Last ned, komprimer og last opp på nytt i så fall.",
  );
  process.exit(1);
}

const root = uploadDir();
const quarantineDir = path.join(root, ".pdf-originals", today());

const documents = await prisma.document.findMany({
  where: {
    deletedAt: null,
    mimeType: "application/pdf",
    filePath: { startsWith: "/uploads/" },
  },
  select: { id: true, filePath: true, fileSize: true },
  // Største først: der er gevinsten størst, og `--limit` blir mest nyttig.
  orderBy: { fileSize: "desc" },
});

// Flere dokumentrader kan i teorien peke på samme fil. Da komprimeres filen
// én gang, og alle radene får ny `fileSize`.
const byPath = new Map<
  string,
  { filePath: string; ids: string[]; bytes: number }
>();
let outsideRoot = 0;
for (const document of documents) {
  const absolute = resolveUploadPath(root, document.filePath);
  if (!absolute) {
    outsideRoot += 1;
    continue;
  }
  const entry = byPath.get(absolute);
  if (entry) {
    entry.ids.push(document.id);
    entry.bytes = Math.max(entry.bytes, document.fileSize);
  } else {
    byPath.set(absolute, {
      filePath: document.filePath,
      ids: [document.id],
      bytes: document.fileSize,
    });
  }
}

const targets = [...byPath.entries()]
  .slice(0, limit ?? Number.POSITIVE_INFINITY)
  .map(([absolute, entry]) => ({ absolute, ...entry }));

const bytesBeforeTotal = documents.reduce((sum, row) => sum + row.fileSize, 0);

console.log(
  `Fant ${documents.length} PDF-dokumenter (${formatBytes(bytesBeforeTotal)}, ` +
    `${byPath.size} unike filer) i ${root}.`,
);
if (outsideRoot > 0) {
  console.log(`Hoppet over ${outsideRoot} rader med sti utenfor /uploads/.`);
}
if (targets.length < byPath.size) {
  console.log(`--limit ${limit}: behandler ${targets.length} av ${byPath.size} filer.`);
}

if (!(await hasGhostscript())) {
  console.log(
    "Ghostscript (gs) finnes ikke på PATH. Komprimering er ikke mulig her; " +
      "installer ghostscript (se Dockerfile) og kjør på nytt.",
  );
  process.exit(0);
}

if (!apply) {
  console.log("\nStørste kandidater (tørrkjøring, ingenting er skrevet):");
  for (const target of targets.slice(0, 10)) {
    console.log(`  ${target.filePath}  ${formatBytes(target.bytes)}`);
  }
  // Erfaringsintervallet for /ebook på skannede PDF-er. Faktisk gevinst
  // rapporteres først ved --apply.
  const low = Math.round(bytesBeforeTotal * 0.3);
  const high = Math.round(bytesBeforeTotal * 0.6);
  console.log(
    `\nTørrkjøring: 0 filer endret. Med --quality ${quality} gir skannede PDF-er ` +
      `typisk 30–60 % reduksjon, anslått ${formatBytes(low)}–${formatBytes(high)} ` +
      `for hele biblioteket.`,
  );
  console.log(
    `Prøv først: npm run pdfs:compress -- --apply --limit 5 (originalene havner i ` +
      `${path.relative(process.cwd(), quarantineDir)}/).`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

let compressed = 0;
let skipped = 0;
let failed = 0;
let missing = 0;
let savedBytes = 0;
let index = 0;

for (const target of targets) {
  index += 1;
  const label = `[${index}/${targets.length}] ${target.filePath}`;

  const quarantined = await quarantine(target.absolute, quarantineDir).catch(
    (error: unknown) => {
      console.error(
        `${label}: kunne ikke legge originalen i karantene (${
          error instanceof Error ? error.message : String(error)
        }), hopper over.`,
      );
      return null;
    },
  );
  if (!quarantined) {
    failed += 1;
    continue;
  }

  const result = await compressPdfFile({
    path: target.absolute,
    minBytes,
    quality,
  });

  if (result.ok) {
    // Bare radene som peker på denne filen, og bare ved faktisk bytte.
    await prisma.document.updateMany({
      where: { id: { in: target.ids } },
      data: { fileSize: result.bytesAfter },
    });
    compressed += 1;
    savedBytes += result.bytesBefore - result.bytesAfter;
    console.log(
      `${label}: ${formatBytes(result.bytesBefore)} → ${formatBytes(
        result.bytesAfter,
      )}`,
    );
    continue;
  }

  // Ingenting ble byttet: karantenekopien er en duplikat og skal bort.
  await fs.rm(quarantined, { force: true }).catch(() => {});
  if (result.reason === "too_small") {
    skipped += 1;
  } else if (result.reason === "missing") {
    missing += 1;
    console.warn(`${label}: filen mangler på disk.`);
  } else {
    failed += 1;
  }
}

console.log(
  `\nKomprimert: ${compressed} filer, spart ${formatBytes(savedBytes)}.`,
);
console.log(
  `Hoppet over: ${skipped} under --min-bytes, ${failed} feilet eller under ` +
    `10 % gevinst, ${missing} mangler på disk.`,
);
if (compressed > 0) {
  console.log(
    `Originalene ligger i ${quarantineDir}. Kontroller noen PDF-er i ` +
      `nettleseren, og slett deretter mappen for å frigjøre plassen.`,
  );
}

await prisma.$disconnect();
