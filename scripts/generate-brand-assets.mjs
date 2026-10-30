#!/usr/bin/env node
/**
 * Bygger favicon og appikoner fra den felles merkevaregeometrien.
 *
 *   node scripts/generate-brand-assets.mjs
 *   npm run brand:assets
 *
 * Geometri og farger leses fra src/lib/brand.ts, slik at favicon, PWA-ikoner
 * og <BrandMark> ikke kan komme i utakt. sharp rasterer hver størrelse direkte
 * fra SVG-en (skarp hake også i 16 px). ICO-en pakkes med PNG-rammer i Node,
 * og ImageMagick brukes til å kontrollere at alle rammene er gyldige.
 */
import { execFileSync } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const appDir = path.join(root, "src/app");

const brandSource = await readFile(
  path.join(root, "src/lib/brand.ts"),
  "utf8",
);

function readString(name) {
  const match = brandSource.match(
    new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*"([^"]+)"`),
  );
  if (!match) throw new Error(`Fant ikke ${name} i src/lib/brand.ts`);
  return match[1];
}

function readNumber(name) {
  const match = brandSource.match(
    new RegExp(`export const ${name}\\s*=\\s*(\\d+)`),
  );
  if (!match) throw new Error(`Fant ikke ${name} i src/lib/brand.ts`);
  return Number(match[1]);
}

const pinPath = readString("BRAND_PIN_PATH");
const checkPath = readString("BRAND_CHECK_PATH");
const tileRadius = readNumber("BRAND_TILE_RADIUS");

const colors = {};
for (const [, name, value] of brandSource.matchAll(
  /^\s*(ink|signal|paper|risk):\s*"(#[0-9a-fA-F]{6})",?$/gm,
)) {
  colors[name] = value;
}
for (const name of ["ink", "signal", "paper", "risk"]) {
  if (!colors[name]) throw new Error(`Fant ikke fargen ${name} i BRAND_COLORS`);
}

const tileInset = 0.75;

function pinAndCheck() {
  return [
    `<path d="${pinPath}" fill="${colors.ink}"/>`,
    `<path d="${checkPath}" fill="none" stroke="${colors.signal}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join("");
}

/** Faviconflaten: avrundet limen flate med blekknål og lime hake. */
function tileSvg({ width, height } = {}) {
  const dimensions =
    width && height ? ` width="${width}" height="${height}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="0 0 64 64">`,
    `<rect x="${tileInset}" y="${tileInset}" width="${64 - tileInset * 2}" height="${64 - tileInset * 2}" rx="${tileRadius - tileInset}" fill="${colors.signal}" stroke="${colors.ink}" stroke-opacity="0.18" stroke-width="1.5"/>`,
    pinAndCheck(),
    "</svg>",
  ].join("");
}

/**
 * Fullflate-ikoner. Bakgrunnen er signalflaten, og nålen sentreres etter sin
 * egen boks (y 7,5–59) slik at den står midt i ruten. Maskable-varianter bruker
 * en mindre skala, godt innenfor sikkerhetssonen på 80 %.
 */
function fullBleedSvg(size, scale) {
  const pinCenterY = (7.5 + 59) / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" fill="${colors.signal}"/>`,
    `<g transform="translate(32 32) scale(${scale}) translate(-32 -${pinCenterY})">`,
    pinAndCheck(),
    "</g>",
    "</svg>",
  ].join("");
}

async function assertPng(file, expectedSize) {
  const metadata = await sharp(file).metadata();
  if (metadata.format !== "png") {
    throw new Error(`${file} er ${metadata.format}, forventet png`);
  }
  if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
    throw new Error(
      `${file} er ${metadata.width}×${metadata.height}, forventet ${expectedSize}×${expectedSize}`,
    );
  }
  return metadata;
}

async function renderPng(svg, file, expectedSize) {
  await sharp(Buffer.from(svg), { density: 72 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(file);
  await assertPng(file, expectedSize);
}

const generated = [];
const pngAssets = [
  {
    file: "favicon-16x16.png",
    size: 16,
    svg: () => tileSvg({ width: 16, height: 16 }),
  },
  {
    file: "favicon-32x32.png",
    size: 32,
    svg: () => tileSvg({ width: 32, height: 32 }),
  },
  {
    file: "favicon-48x48.png",
    size: 48,
    svg: () => tileSvg({ width: 48, height: 48 }),
  },
  {
    file: "favicon-96x96.png",
    size: 96,
    svg: () => tileSvg({ width: 96, height: 96 }),
  },
  {
    file: "apple-touch-icon.png",
    size: 180,
    svg: () => fullBleedSvg(180, 0.9),
  },
  {
    file: "android-chrome-192x192.png",
    size: 192,
    svg: () => fullBleedSvg(192, 0.9),
  },
  {
    file: "android-chrome-512x512.png",
    size: 512,
    svg: () => fullBleedSvg(512, 0.9),
  },
  {
    file: "maskable-512x512.png",
    size: 512,
    svg: () => fullBleedSvg(512, 0.86),
  },
];

for (const asset of pngAssets) {
  await renderPng(asset.svg(), path.join(publicDir, asset.file), asset.size);
  generated.push(`${asset.file.padEnd(28)} ${asset.size}×${asset.size} PNG`);
}

await writeFile(path.join(publicDir, "favicon.svg"), `${tileSvg()}\n`, "utf8");
generated.push("favicon.svg                  64×64 vektor (viewBox)");

/**
 * Pakker PNG-rammene i en ICO. ICO-en bruker PNG-data også for små størrelser
 * (støttet av Windows Vista+ og alle nettlesere vi targeter), slik at filen
 * holder seg liten i stedet for å lagre 256-rammen ukomprimert.
 */
function buildIco(pngs, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = Buffer.alloc(16 * pngs.length);
  let offset = header.length + entries.length;
  pngs.forEach((png, index) => {
    const size = sizes[index];
    const entry = entries.subarray(index * 16, (index + 1) * 16);
    // 0 betyr 256 i ICO-formatet.
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
  });

  return Buffer.concat([header, entries, ...pngs]);
}

// ICO-en trenger 256 px i tillegg til faviconstørrelsene. sharp rasterer
// 256-rammen, og ImageMagick brukes til å kontrollere at alle rammene kom med.
const icoSizes = [16, 32, 48, 256];
const icoPngs = [];
for (const size of icoSizes) {
  if (size === 256) {
    icoPngs.push(
      await sharp(
        Buffer.from(tileSvg({ width: 256, height: 256 })),
        { density: 72 },
      )
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    );
  } else {
    icoPngs.push(
      await readFile(path.join(publicDir, `favicon-${size}x${size}.png`)),
    );
  }
}

const icoFile = path.join(publicDir, "favicon.ico");
await writeFile(icoFile, buildIco(icoPngs, icoSizes));

const frames = execFileSync(
  "magick",
  ["identify", "-format", "%wx%h\n", icoFile],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
const expected = icoSizes.map((size) => `${size}x${size}`);
if (
  frames.length !== expected.length ||
  frames.some((frame) => !expected.includes(frame))
) {
  throw new Error(
    `favicon.ico har rammene ${frames.join(", ")}, forventet ${expected.join(", ")}`,
  );
}

await copyFile(icoFile, path.join(appDir, "favicon.ico"));
generated.push(`favicon.ico                  ${expected.join(", ")}`);
generated.push("src/app/favicon.ico          samme ICO som public/favicon.ico");

console.log("Merkevareikoner generert fra src/lib/brand.ts:\n");
for (const line of generated) console.log(`  ${line}`);
