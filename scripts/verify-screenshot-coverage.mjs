#!/usr/bin/env node
/**
 * Verifiserer at skjermbildemanifestet dekker alle page.tsx-ruter.
 *
 *   node scripts/verify-screenshot-coverage.mjs
 *
 * Sjekker:
 *  - hver src/app/**\/page.tsx er enten fanget eller eksplisitt hoppet over
 *  - alle JPEG-filer finnes, er JPEG og har riktig viewportbredde
 *  - fullsidehøyden er minst viewporthøyden
 *  - bildene ikke er tomme (entropi, tekstlengde og H1 fra manifestet)
 *  - de 15 README-PNG-ene finnes med riktig dimensjon
 *  - stikkprøver for innlogging, 404, 2FA-redirect og /brukere-redirect
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const APP_DIR = resolve(ROOT, "src/app");
const PAGES_DIR = resolve(ROOT, "screenshots/pages");
const MANIFEST_PATH = resolve(PAGES_DIR, "manifest.json");

const EXPECTED_LEGACY = [
  "01-dashbord.png",
  "02-oppdrag.png",
  "03-oppdrag-detalj.png",
  "04-kalender.png",
  "05-kunder.png",
  "06-kunde-detalj.png",
  "07-dokumenter.png",
  "08-dokumenter-mappe.png",
  "09-rapporter.png",
  "10-innstillinger-sikkerhet.png",
  "11-innstillinger-merkevare.png",
  "12-mobil-dashbord.png",
  "13-mobil-oppdrag.png",
  "14-kundeportal.png",
  "15-kundeportal-mobil.png",
];

const ERROR_PHRASES = [
  "application error",
  "unhandled runtime error",
  "internal server error",
  "this page could not be found",
  "a client-side exception has occurred",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeRoute(route) {
  return String(route ?? "").split("?")[0].replace(/\/+$/, "") || "/";
}

function routePattern(route) {
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) return /^\/$/;
  const parts = segments.map((segment) => {
    if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.+)?";
    if (/^\[\.\.\..+\]$/.test(segment)) return ".+";
    if (/^\[.+\]$/.test(segment)) return "[^/]+";
    return escapeRegExp(segment);
  });
  return new RegExp(`^/${parts.join("/")}/?$`);
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}

function pageFileToRoute(file) {
  const relativePath = relative(APP_DIR, file).split(sep).join("/");
  const withoutPage = relativePath.replace(/(^|\/)page\.tsx$/, "");
  const segments = withoutPage
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.+\)$/.test(segment));
  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `Fant ikke gyldig manifest på ${relative(ROOT, MANIFEST_PATH)}. ` +
        "Kjør capture-all-screenshots.mjs først.",
      { cause: error },
    );
  }

  const captures = Array.isArray(manifest.captures) ? manifest.captures : [];
  const skipped = Array.isArray(manifest.skipped) ? manifest.skipped : [];
  const pageFiles = (await walk(APP_DIR)).filter((file) =>
    file.endsWith(`${sep}page.tsx`),
  );
  const pageRoutes = pageFiles.map(pageFileToRoute).sort();
  const staticRoutes = new Set(
    pageRoutes.filter((route) => !route.includes("[")),
  );
  const pagePatterns = new Map(
    pageRoutes.map((route) => [route, routePattern(route)]),
  );

  const failures = [];
  const warnings = [];
  const coverage = [];

  // 1. Hver page.tsx-rute skal ha en konkret fangst eller en dokumentert skip.
  for (const route of pageRoutes) {
    const pattern = pagePatterns.get(route);
    const isDynamic = route.includes("[");
    const matchingCaptures = captures.filter((capture) => {
      const captureRoute = normalizeRoute(capture.route);
      if (!pattern.test(captureRoute)) return false;
      if (isDynamic && staticRoutes.has(captureRoute)) return false;
      return true;
    });
    const skip = skipped.find((entry) => normalizeRoute(entry.route) === route);

    if (matchingCaptures.length > 0) {
      coverage.push({
        route,
        status: "captured",
        captures: matchingCaptures.map((capture) => capture.slug),
        reason: null,
      });
    } else if (skip?.reason?.trim()) {
      coverage.push({
        route,
        status: "skipped",
        captures: [],
        reason: skip.reason,
      });
    } else {
      coverage.push({
        route,
        status: "missing",
        captures: [],
        reason: null,
      });
      failures.push(`Mangler fangst eller begrunnelse for ${route}`);
    }
  }

  // 2. Manifestets fangster skal peke på en faktisk side-rute (eller 404).
  for (const capture of captures) {
    const route = normalizeRoute(capture.route);
    if (capture.special) continue;
    const exists = pageRoutes.some((pageRoute) =>
      pagePatterns.get(pageRoute).test(route),
    );
    if (!exists) {
      failures.push(
        `Manifestet inneholder ukjent rute ${capture.route} (${capture.slug})`,
      );
    }
  }

  // 3. Bildene: eksistens, format, dimensjoner, innhold og entropi.
  const viewports = manifest.viewports ?? {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  };
  const imageFiles = [];
  let imageBytes = 0;
  const entropyBySlug = [];

  for (const capture of captures) {
    for (const key of ["desktop", "mobile"]) {
      const record = capture[key];
      if (!record) {
        failures.push(`Mangler ${key}-fangst for ${capture.slug}`);
        continue;
      }
      if (record.error) {
        failures.push(
          `${capture.slug} (${key}) feilet: ${record.error}`,
        );
        continue;
      }

      const absolutePath = resolve(ROOT, record.file);
      let fileStat;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        failures.push(`Bildefilen finnes ikke: ${record.file}`);
        continue;
      }
      imageFiles.push(absolutePath);
      imageBytes += fileStat.size;

      let metadata;
      try {
        metadata = await sharp(absolutePath).metadata();
      } catch (error) {
        failures.push(
          `Kan ikke lese ${record.file}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }

      const expected = viewports[key];
      if (metadata.format !== "jpeg") {
        failures.push(`${record.file} er ${metadata.format}, ikke JPEG`);
      }
      if (metadata.width !== expected.width) {
        failures.push(
          `${record.file} er ${metadata.width}px bred, forventet ${expected.width}px`,
        );
      }
      if (!metadata.height || metadata.height < expected.height) {
        failures.push(
          `${record.file} er ${metadata.height ?? 0}px høy, forventet minst ${expected.height}px`,
        );
      }
      if (
        metadata.width !== record.width ||
        metadata.height !== record.height
      ) {
        failures.push(
          `${record.file} har dimensjonene ${metadata.width}×${metadata.height} ` +
            `i filen, men ${record.width}×${record.height} i manifestet`,
        );
      }
      if (fileStat.size === 0) {
        failures.push(`${record.file} er tom`);
      }

      if (!Array.isArray(record.h1) || record.h1.length === 0) {
        failures.push(`${record.file} mangler H1 i manifestet`);
      }
      if (!record.bodyTextLength || record.bodyTextLength < 60) {
        failures.push(
          `${record.file} har bare ${record.bodyTextLength ?? 0} tegn tekst`,
        );
      }
      for (const heading of record.h1 ?? []) {
        for (const phrase of ERROR_PHRASES) {
          if (String(heading).toLowerCase().includes(phrase)) {
            failures.push(
              `${record.file} viser feilsiden «${phrase}» i H1`,
            );
          }
        }
      }

      const stats = await sharp(absolutePath).stats();
      if (!Number.isFinite(stats.entropy) || stats.entropy < 0.9) {
        failures.push(
          `${record.file} ser tomt ut (entropi ${stats.entropy.toFixed(2)})`,
        );
      }
      entropyBySlug.push({
        slug: capture.slug,
        viewport: key,
        entropy: Number(stats.entropy.toFixed(2)),
      });
    }
  }

  // 4. De 15 README-bildene.
  const legacyCaptures = Array.isArray(manifest.legacyScreenshots)
    ? manifest.legacyScreenshots
    : [];
  const legacyNames = new Set();
  for (const record of legacyCaptures) {
    const name = record.file?.replace(/^screenshots\//, "");
    if (!name) continue;
    legacyNames.add(name);
    const absolutePath = resolve(ROOT, record.file);
    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      failures.push(`README-bildet finnes ikke: ${record.file}`);
      continue;
    }
    imageFiles.push(absolutePath);
    imageBytes += fileStat.size;

    const metadata = await sharp(absolutePath).metadata();
    if (metadata.format !== "png") {
      failures.push(`${record.file} er ${metadata.format}, ikke PNG`);
    }
    if (metadata.width !== record.width || metadata.height !== record.height) {
      failures.push(
        `${record.file} har dimensjonene ${metadata.width}×${metadata.height}, ` +
          `men manifestet sier ${record.width}×${record.height}`,
      );
    }
    if (![1440, 390].includes(metadata.width ?? 0)) {
      failures.push(
        `${record.file} har uventet bredde ${metadata.width ?? 0}px`,
      );
    }
    if ((metadata.height ?? 0) < 844) {
      failures.push(
        `${record.file} har uventet høyde ${metadata.height ?? 0}px`,
      );
    }
  }

  for (const name of EXPECTED_LEGACY) {
    if (!legacyNames.has(name)) {
      failures.push(`Mangler README-bildet screenshots/${name}`);
    }
  }
  for (const name of legacyNames) {
    if (!EXPECTED_LEGACY.includes(name)) {
      warnings.push(`Uventet README-bilde i manifestet: ${name}`);
    }
  }

  // 5. Stikkprøver for redirecter og offentlige sider.
  const login = manifest.checks?.login;
  if (
    !login ||
    login.finalPath !== "/logg-inn" ||
    login.httpStatus !== 200 ||
    !(login.h1 ?? []).some((heading) => /logg inn/i.test(heading))
  ) {
    failures.push("Stikkprøve feilet: /logg-inn viste ikke innloggingssiden");
  }

  const notFound = manifest.checks?.notFound;
  if (
    !notFound ||
    notFound.finalPath !== "/finnes-ikke" ||
    notFound.httpStatus !== 404 ||
    !(notFound.h1 ?? []).some((heading) => /finnes ikke/i.test(heading))
  ) {
    failures.push("Stikkprøve feilet: /finnes-ikke ga ikke 404-siden");
  }

  const usersRedirect = manifest.checks?.usersRedirect;
  if (
    !usersRedirect ||
    usersRedirect.finalPath !== "/innstillinger" ||
    !usersRedirect.finalUrl?.includes("tab=ansatte")
  ) {
    failures.push(
      "Stikkprøve feilet: /brukere redirectet ikke til /innstillinger?tab=ansatte",
    );
  }

  const twoFactor = manifest.checks?.twoFactorRedirect;
  if (
    !twoFactor ||
    !twoFactor.pass ||
    twoFactor.finalPath !== "/logg-inn"
  ) {
    failures.push(
      "Stikkprøve feilet: /logg-inn/2fa redirectet ikke til /logg-inn uten ventende cookie",
    );
  }

  const failedRedirects = (manifest.redirectChecks ?? []).filter(
    (check) => !check.pass,
  );
  for (const check of failedRedirects) {
    failures.push(
      `Redirect-sjekk feilet: ${check.from} endte på ${check.finalPath}${check.finalSearch}`,
    );
  }

  for (const capture of captures) {
    if (capture.desktop?.imageFailures?.length > 0) {
      warnings.push(
        `${capture.slug} (desktop) hadde ${capture.desktop.imageFailures.length} bilde(r) som ikke lastet`,
      );
    }
    if (capture.mobile?.imageFailures?.length > 0) {
      warnings.push(
        `${capture.slug} (mobile) hadde ${capture.mobile.imageFailures.length} bilde(r) som ikke lastet`,
      );
    }
  }

  // 6. Oppsummering.
  const capturedRoutes = coverage.filter(
    (entry) => entry.status === "captured",
  ).length;
  const skippedRoutes = coverage.filter(
    (entry) => entry.status === "skipped",
  ).length;
  const missingRoutes = coverage.filter(
    (entry) => entry.status === "missing",
  ).length;
  const failuresFromManifest = Array.isArray(manifest.failures)
    ? manifest.failures
    : [];
  const totalFiles = imageFiles.length;
  const minEntropy = entropyBySlug.reduce(
    (lowest, entry) => (entry.entropy < lowest.entropy ? entry : lowest),
    entropyBySlug[0] ?? { slug: "-", viewport: "-", entropy: 0 },
  );

  console.log("=== Skjermbildedekning ===");
  console.log(`page.tsx-ruter: ${pageRoutes.length}`);
  console.log(`  fanget:      ${capturedRoutes}`);
  console.log(`  hoppet over: ${skippedRoutes}`);
  console.log(`  mangler:     ${missingRoutes}`);
  console.log(`Fangster i manifestet: ${captures.length} ruter`);
  console.log(
    `Bildefiler: ${totalFiles} (${imageFiles.filter((file) => file.endsWith(".jpg")).length} JPEG, ` +
      `${imageFiles.filter((file) => file.endsWith(".png")).length} PNG)`,
  );
  console.log(`Total bildestørrelse: ${formatBytes(imageBytes)}`);
  console.log(
    `Laveste bildeentropi: ${minEntropy.entropy} (${minEntropy.slug}/${minEntropy.viewport})`,
  );
  console.log(`Manifest-feil: ${failuresFromManifest.length}`);
  console.log(`Verifiseringsfeil: ${failures.length}`);
  console.log(`Advarsler: ${warnings.length}`);

  if (skippedRoutes > 0) {
    console.log("\nEksplisitt hoppet over:");
    for (const entry of coverage.filter((item) => item.status === "skipped")) {
      console.log(`  - ${entry.route}: ${entry.reason}`);
    }
  }

  if (warnings.length > 0) {
    console.log("\nAdvarsler:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (failures.length > 0) {
    console.error("\n✖ Verifiseringen feilet:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("\n✔ Alle page.tsx-ruter er dekket og alle bildene er gyldige.");
  }
}

main().catch((error) => {
  console.error("\n✖ Verifiseringen kunne ikke kjøre:");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
