#!/usr/bin/env node
/**
 * Dedupliserer opplastingsmappen med hardlenker.
 *
 *   npm run uploads:dedupe              # tørrkjøring: skann og rapporter
 *   npm run uploads:dedupe -- --apply   # skriv hardlenker
 *
 * Identiske filer (samme SHA-256) deler inode etter kjøringen. Hvert filnavn
 * beholdes, så `Upload.storedName` og `/uploads/...` er uendret. Kjøringen er
 * idempotent og kan trygt gjentas; allerede lenkede filer telles som
 * «allerede lenket» og røres ikke.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { dedupeUploads } from "../src/lib/upload-dedupe";
import { storageKind } from "../src/lib/storage/config";
import { uploadDir } from "../src/lib/uploads";
import prisma from "../src/lib/prisma";

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Fyller `Upload.contentHash` for rader som ble lastet opp før hashing ble
 * innført. Uten dette kan en ny opplasting av en gammel duplikatfil ikke
 * gjenkjennes, og skriver en fersk kopi helt til neste skanning.
 */
async function backfillHashes(root: string) {
  const rows = await prisma.upload.findMany({
    where: { contentHash: null },
    select: { id: true, storedName: true },
  });

  let updated = 0;
  let missing = 0;
  for (const row of rows) {
    const path = join(root, row.storedName);
    try {
      await access(path);
    } catch {
      missing += 1;
      continue;
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    await prisma.upload.update({
      where: { id: row.id },
      data: { contentHash: hash.digest("hex") },
    });
    updated += 1;
  }
  return { total: rows.length, updated, missing };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

const apply = process.argv.includes("--apply");
const minBytesRaw = flagValue("--min-bytes");
const minBytes =
  minBytesRaw === undefined ? 0 : Number.parseInt(minBytesRaw, 10);

if (!Number.isFinite(minBytes) || minBytes < 0) {
  console.error("Ugyldig --min-bytes. Oppgi et ikke-negativt heltall.");
  process.exit(1);
}

if (storageKind() === "s3") {
  console.error(
    "Deduping med hardlenker krever STORAGE_DRIVER=local. " +
      "Ved S3 ligger innholdet i objektlagringen, ikke i UPLOAD_DIR.",
  );
  process.exit(1);
}

const root = uploadDir();
console.log(`Skanner ${root}${apply ? "" : " (tørrkjøring)"} …`);

const started = Date.now();
const stats = await dedupeUploads({ apply, minBytes });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log("");
console.log(`Skannet:          ${stats.scanned} filer`);
console.log(`Lenket:           ${stats.deduped} filer`);
console.log(`Allerede lenket:  ${stats.alreadyLinked} filer`);
console.log(`Spart:            ${formatBytes(stats.savedBytes)}`);
console.log(`Feil:             ${stats.errors}`);
console.log(`Brukte:           ${seconds} s`);
console.log("");
if (!apply) {
  console.log(
    `Tørrkjøring: ingenting er skrevet. Kjør med --apply for å spare ${formatBytes(
      stats.savedBytes,
    )}.`,
  );
} else if (stats.deduped > 0) {
  console.log(`Ferdig: ${formatBytes(stats.savedBytes)} frigjort på disken.`);
} else {
  console.log("Ferdig: ingenting å dedupe.");
}

if (stats.errors > 0) process.exitCode = 1;

if (apply && !process.argv.includes("--skip-hash-backfill")) {
  console.log("");
  console.log("Fyller contentHash for eldre opplastinger …");
  const hashes = await backfillHashes(root);
  console.log(
    `Hashet:           ${hashes.updated} av ${hashes.total} rader` +
      (hashes.missing > 0 ? ` (${hashes.missing} uten fil på disk)` : ""),
  );
  await prisma.$disconnect();
}
