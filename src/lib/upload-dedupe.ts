import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/uploads";

/**
 * Deduplisering av opplastingsmappen med hardlenker.
 *
 * Samme PDF lastes ofte opp flere ganger (rapporter, vedlegg, dokumenter), og
 * hver opplasting gir en egen fil med eget `storedName`. Innholdet er
 * identisk, men disken lagrer det like mange ganger. Her grupperes filene
 * etter SHA-256 og alle kopiene erstattes av hardlenker til én kanonisk fil.
 * Hver lenke beholder navnet sitt, så `Upload.storedName` og `/uploads/...` er
 * uendret; bare inoden deles.
 *
 * Hardlenker krever samme filsystem. Feiler en lenke (for eksempel på tvers av
 * monteringspunkter), telles det som en feil og filen blir liggende som før –
 * innholdet går aldri tapt.
 */

export type DedupeStats = {
  /** Antall vanlige filer som ble sett i mappen (før `minBytes`-filter). */
  scanned: number;
  /** Filer som allerede delte inode med den kanoniske filen i gruppen. */
  alreadyLinked: number;
  /** Filer som ble (eller ville blitt) erstattet av en hardlenke. */
  deduped: number;
  /** Bytes som ble (eller ville blitt) frigjort. */
  savedBytes: number;
  /** Filer som ikke kunne leses, hashes eller lenkes. */
  errors: number;
};

export type DedupeOptions = {
  /** Skriv endringene. Standard er falsk: bare skann og rapporter. */
  apply?: boolean;
  /** Hopp over filer mindre enn dette. Standard 0 (alle filer). */
  minBytes?: number;
  /** Rotmappe. Standard er `UPLOAD_DIR` via `uploadDir()`. */
  root?: string;
  /**
   * Testseam: erstatter den strømmende SHA-256-lesingen. Skal bare brukes av
   * tester som vil fremprovosere en lesefeil.
   */
  hashFile?: (absolutePath: string) => Promise<string>;
};

type FileEntry = {
  absolute: string;
  size: number;
  dev: number;
  ino: number;
  nlink: number;
  mtimeMs: number;
};

/** SHA-256 av en fil, lest i biter slik at store PDF-er ikke legges i minnet. */
export async function hashFileStream(absolutePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function inodeKey(entry: Pick<FileEntry, "dev" | "ino">): string {
  return `${entry.dev}:${entry.ino}`;
}

/**
 * Samler vanlige filer under roten. Skjulte oppføringer hoppes over: `.tmp`
 * inneholder halvferdige opplastinger, og `.transfer` er krypterte
 * overføringsfiler som ikke er opplastinger. Symlenker følges aldri.
 */
async function collectFiles(
  directory: string,
  files: string[],
  onError: () => void,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    onError();
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolute, files, onError);
      continue;
    }
    if (entry.isFile()) files.push(absolute);
  }
}

/**
 * Erstatter `target` med en hardlenke til `source` uten et vindu der filen
 * mangler: lenken lages under et midlertidig navn og renames over målet.
 * Rename er atomisk på samme filsystem. Brukes både av skanningen og av
 * opplastingsruten, slik at begge lenkene oppfører seg likt.
 */
export async function linkFileOver(
  source: string,
  target: string,
): Promise<void> {
  const temp = path.join(path.dirname(target), `.dedupe-${randomUUID()}.tmp`);
  await fs.link(source, temp);
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function dedupeUploads(
  options: DedupeOptions = {},
): Promise<DedupeStats> {
  const apply = options.apply ?? false;
  const minBytes = Math.max(0, Math.floor(options.minBytes ?? 0));
  const root = path.resolve(options.root ?? uploadDir());
  const hashFile = options.hashFile ?? hashFileStream;

  const stats: DedupeStats = {
    scanned: 0,
    alreadyLinked: 0,
    deduped: 0,
    savedBytes: 0,
    errors: 0,
  };

  const paths: string[] = [];
  await collectFiles(root, paths, () => {
    stats.errors += 1;
  });
  stats.scanned = paths.length;

  // Først samle alle filer per innholdshash. En fil som ikke kan leses telles
  // som feil og stopper ikke resten av skanningen.
  const groups = new Map<string, FileEntry[]>();
  for (const absolute of paths) {
    let info;
    try {
      info = await fs.stat(absolute);
    } catch {
      stats.errors += 1;
      continue;
    }
    if (!info.isFile() || info.size < minBytes) continue;

    let hash: string;
    try {
      hash = await hashFile(absolute);
    } catch {
      stats.errors += 1;
      continue;
    }
    if (!hash) continue;

    const entry: FileEntry = {
      absolute,
      size: info.size,
      dev: info.dev,
      ino: info.ino,
      nlink: info.nlink,
      mtimeMs: info.mtimeMs,
    };
    const existing = groups.get(hash);
    if (existing) existing.push(entry);
    else groups.set(hash, [entry]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Eldste fil er kanonisk; navnet avgjør ved lik mtime. Hardlenkede filer
    // deler mtime, så andre kjøring velger samme fil som første kjøring.
    group.sort(
      (a, b) => a.mtimeMs - b.mtimeMs || a.absolute.localeCompare(b.absolute),
    );
    const canonical = group[0];
    const canonicalInode = inodeKey(canonical);

    // Bytes regnes per inode, ikke per fil: deler to duplikater allerede
    // inode, frigjøres innholdet bare én gang når begge lenkes om.
    const countedInodes = new Set<string>();

    for (const file of group.slice(1)) {
      const inode = inodeKey(file);
      if (inode === canonicalInode) {
        stats.alreadyLinked += 1;
        continue;
      }
      const freesContent = !countedInodes.has(inode);

      if (!apply) {
        stats.deduped += 1;
        if (freesContent) {
          countedInodes.add(inode);
          stats.savedBytes += file.size;
        }
        continue;
      }

      try {
        await linkFileOver(canonical.absolute, file.absolute);
        stats.deduped += 1;
        if (freesContent) {
          countedInodes.add(inode);
          stats.savedBytes += file.size;
        }
      } catch {
        stats.errors += 1;
      }
    }
  }

  return stats;
}
