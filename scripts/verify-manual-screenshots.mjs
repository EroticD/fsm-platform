#!/usr/bin/env node
/**
 * Verifiserer bilder i den manuelle brukermanualen.
 *
 *   node scripts/verify-manual-screenshots.mjs
 *
 * Sjekker:
 *  - alle bilde-referanser i docs/manual/**\/*.md finnes og er ikke tomme
 *  - alle filer under screenshots/manual/ er brukt i Markdown eller eksplisitt
 *    merket som ubrukte i manifestet
 *  - alle filer som screenshots/manual/manifest.json peker på finnes
 *
 * Skriptet feiler med en tydelig liste dersom noe mangler. Det kan pekes mot
 * en midlertidig fixture med --root, --manual-dir og --screenshots-dir, slik at
 * det kan testes uten produksjonsbildene.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_IMAGE_EXTENSIONS,
  extractHtmlImageReferences,
  extractMarkdownImageReferences,
  imageMimeType,
  isExternalImageSource,
  resolveImagePath,
  stripMarkdownCode,
  stripSourceDecorations,
} from "./lib/manual-images.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "..");
const supported = SUPPORTED_IMAGE_EXTENSIONS.join(", ");
const unusedKeys = new Set([
  "unused",
  "unusedfiles",
  "explicitlyunused",
  "ignored",
  "ignore",
  "orphans",
]);
const pathKeys = new Set([
  "file",
  "files",
  "path",
  "paths",
  "image",
  "images",
  "src",
  "source",
  "screenshot",
  "screenshots",
  "capture",
  "captures",
  "entry",
  "entries",
  "item",
  "items",
  "desktop",
  "mobile",
  "output",
  "outputs",
]);

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    root: defaultRoot,
    manualDir: null,
    screenshotsDir: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--root") {
      options.root = path.resolve(argv[++index] ?? fail("--root mangler verdi"));
    } else if (argument === "--manual-dir") {
      options.manualDir = path.resolve(
        argv[++index] ?? fail("--manual-dir mangler verdi"),
      );
    } else if (argument === "--screenshots-dir") {
      options.screenshotsDir = path.resolve(
        argv[++index] ?? fail("--screenshots-dir mangler verdi"),
      );
    } else {
      fail(`Ukjent argument: ${argument}`);
    }
  }

  options.manualDir ??= path.join(options.root, "docs", "manual");
  options.screenshotsDir ??= path.join(options.root, "screenshots", "manual");
  return options;
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output.sort();
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isWithin(file, directory) {
  const relativePath = path.relative(directory, file);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..")
  );
}

function isReadme(file) {
  return path.basename(file).toLowerCase() === "readme.md";
}

function looksLikeImagePath(value) {
  return typeof value === "string" && Boolean(imageMimeType(value));
}

function isUnusedEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const status = String(entry.status ?? entry.state ?? "").toLowerCase();
  return (
    entry.unused === true ||
    entry.used === false ||
    entry.inUse === false ||
    entry.referenced === false ||
    status === "unused" ||
    status === "ignored" ||
    status === "orphan"
  );
}

/**
 * Manifestet kan være en liste eller et objekt, og bruker felter som
 * file/path/image/src eller nøkler som er selve filstien. Vi leser det derfor
 * rekursivt og godtar flere varianter, slik at skriptet ikke låser formatet
 * før skjermbildeagenten har landet sin manifeststruktur.
 */
function collectManifestFiles(value) {
  const files = new Set();
  const unused = new Set();

  function visit(node, { insideUnused = false, forcePath = false } = {}) {
    if (typeof node === "string") {
      if ((forcePath || insideUnused) && looksLikeImagePath(node)) {
        files.add(node);
        if (insideUnused) unused.add(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, { insideUnused, forcePath });
      return;
    }
    if (!node || typeof node !== "object") return;

    const entryUnused = insideUnused || isUnusedEntry(node);
    for (const [key, child] of Object.entries(node)) {
      const lowerKey = key.toLowerCase();
      const childForcePath = pathKeys.has(lowerKey);

      if (looksLikeImagePath(key)) {
        files.add(key);
        if (
          entryUnused ||
          (child && typeof child === "object" && isUnusedEntry(child))
        ) {
          unused.add(key);
        }
      }

      if (unusedKeys.has(lowerKey)) {
        if (typeof child === "string") {
          if (looksLikeImagePath(child)) {
            files.add(child);
            unused.add(child);
          }
        } else {
          visit(child, { insideUnused: true, forcePath: true });
        }
        continue;
      }

      if (typeof child === "string") {
        if (childForcePath && looksLikeImagePath(child)) {
          files.add(child);
          if (entryUnused) unused.add(child);
        }
        continue;
      }

      if (child && typeof child === "object") {
        visit(child, {
          insideUnused: entryUnused,
          forcePath: childForcePath,
        });
      }
    }
  }

  visit(value);
  return { files: [...files], unused: [...unused] };
}

function resolveManifestPath(reference, { root, screenshotsDir }) {
  const clean = stripSourceDecorations(reference);
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Behold stien uendret dersom prosentdekodingen feiler.
  }
  if (decoded.startsWith("/")) return path.join(root, decoded.slice(1));
  if (path.isAbsolute(decoded)) return decoded;

  const candidates = [
    path.resolve(root, decoded),
    path.resolve(screenshotsDir, decoded),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function inspectFile(file) {
  try {
    const stats = fs.statSync(file);
    return {
      exists: true,
      isFile: stats.isFile(),
      empty: stats.isFile() && stats.size === 0,
      bytes: stats.size,
    };
  } catch {
    return { exists: false, isFile: false, empty: false, bytes: 0 };
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Bruk: node scripts/verify-manual-screenshots.mjs [valg]

Valg:
  --root <sti>             Repo-rot (standard: ${defaultRoot})
  --manual-dir <sti>       Markdown-mappe (standard: <root>/docs/manual)
  --screenshots-dir <sti>  Skjermbildemappe (standard: <root>/screenshots/manual)
  -h, --help               Vis denne hjelpen

Støttede bildeformater: ${supported}`);
    return;
  }

  const { root, manualDir, screenshotsDir } = options;
  const errors = [];
  const warnings = [];
  const markdownFiles = walkFiles(manualDir).filter(
    (file) => file.endsWith(".md") && !isReadme(file),
  );

  const references = [];
  for (const markdownFile of markdownFiles) {
    const markdown = fs.readFileSync(markdownFile, "utf8");
    const text = stripMarkdownCode(markdown);
    const imageReferences = [
      ...extractMarkdownImageReferences(text),
      ...extractHtmlImageReferences(text),
    ].sort((left, right) => left.index - right.index);
    for (const reference of imageReferences) {
      if (isExternalImageSource(reference.source)) continue;
      references.push({
        ...reference,
        markdownFile,
        resolved: resolveImagePath(reference.source, markdownFile, { root }),
      });
    }
  }

  const missingReferences = [];
  const unsupportedReferences = [];
  const referencedManualFiles = new Set();
  for (const reference of references) {
    if (!imageMimeType(reference.source)) {
      unsupportedReferences.push(reference);
      continue;
    }

    const location = `${relative(root, reference.markdownFile)}:${reference.line}`;
    const status = inspectFile(reference.resolved);
    if (!status.exists || !status.isFile) {
      missingReferences.push({ reference, location, reason: "finnes ikke" });
      continue;
    }
    if (status.empty) {
      missingReferences.push({ reference, location, reason: "er tom" });
      continue;
    }
    if (isWithin(reference.resolved, screenshotsDir)) {
      referencedManualFiles.add(reference.resolved);
    }
  }

  const manualFiles = walkFiles(screenshotsDir).filter(
    (file) => looksLikeImagePath(file) && path.basename(file) !== "manifest.json",
  );
  const manifestPath = path.join(screenshotsDir, "manifest.json");
  const manifestExists = fs.existsSync(manifestPath);
  const manifestFiles = new Set();
  const explicitlyUnused = new Set();

  if (manifestExists) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      fail(
        `Kan ikke lese ${relative(root, manifestPath)}: ${error.message}`,
      );
    }

    const collected = collectManifestFiles(manifest);
    for (const file of collected.files) {
      const resolved = resolveManifestPath(file, { root, screenshotsDir });
      manifestFiles.add(resolved);
      const status = inspectFile(resolved);
      if (!status.exists || !status.isFile) {
        errors.push(
          `Manifestet peker på en fil som ikke finnes: ${file} (${relative(root, resolved)})`,
        );
      } else if (status.empty) {
        errors.push(
          `Manifestet peker på en tom fil: ${file} (${relative(root, resolved)})`,
        );
      }
    }
    for (const file of collected.unused) {
      explicitlyUnused.add(
        resolveManifestPath(file, { root, screenshotsDir }),
      );
    }
  } else if (manualFiles.length > 0 || referencedManualFiles.size > 0) {
    errors.push(
      `Mangler ${relative(root, manifestPath)}. Alle manuelle skjermbilder skal være oppført der, med «unused: true» og en begrunnelse for filer som ikke er i bruk.`,
    );
  }

  const orphans = manualFiles.filter(
    (file) => !referencedManualFiles.has(file) && !explicitlyUnused.has(file),
  );
  const notInManifest = [...referencedManualFiles].filter(
    (file) => !manifestFiles.has(file),
  );

  console.log("Manuell skjermbildeverifisering");
  console.log(
    `  Markdown: ${markdownFiles.length} filer, ${references.length} bildereferanser`,
  );
  console.log(`  Manuelle skjermbilder: ${manualFiles.length} filer`);
  console.log(
    `  Manifest: ${manifestExists ? `${manifestFiles.size} bildefiler, ${explicitlyUnused.size} merket ubrukt` : "mangler"}`,
  );

  if (missingReferences.length > 0) {
    console.error(`\n✖ Manglende eller tomme bildefiler (${missingReferences.length}):`);
    for (const { reference, location, reason } of missingReferences) {
      console.error(
        `  - ${location} → ${reference.source} (${reason}); forventet ${relative(root, reference.resolved)}`,
      );
    }
  }

  if (unsupportedReferences.length > 0) {
    console.error(
      `\n✖ Bildeformater som ikke støttes (${unsupportedReferences.length}):`,
    );
    for (const reference of unsupportedReferences) {
      console.error(
        `  - ${relative(root, reference.markdownFile)}:${reference.line} → ${reference.source}`,
      );
    }
    console.error(`  Støttede formater: ${supported}`);
  }

  if (errors.length > 0) {
    console.error(`\n✖ Feil i skjermbildemanifestet (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
  }

  if (orphans.length > 0) {
    console.error(
      `\n✖ Manuelle skjermbilder som verken er brukt eller merket ubrukt (${orphans.length}):`,
    );
    for (const orphan of orphans) console.error(`  - ${relative(root, orphan)}`);
    console.error(
      "  Legg bildet inn i en Markdown-fil, eller sett «unused: true» med en begrunnelse i manifestet.",
    );
  }

  if (notInManifest.length > 0) {
    warnings.push(
      `${notInManifest.length} brukte skjermbilde(r) mangler oppføring i manifestet: ${notInManifest
        .map((file) => relative(root, file))
        .join(", ")}`,
    );
  }

  if (warnings.length > 0) {
    for (const warning of warnings) console.warn(`! ${warning}`);
  }

  const failures =
    missingReferences.length +
    unsupportedReferences.length +
    errors.length +
    orphans.length;
  if (failures > 0) {
    console.error(`\n✖ ${failures} problem(er) må rettes før manualen kan bygges.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    "✓ Alle bildereferanser finnes, og alle manuelle skjermbilder er brukt eller merket ubrukt.",
  );
}

try {
  main();
} catch (error) {
  console.error(`✖ ${error.message ?? error}`);
  process.exitCode = 1;
}
