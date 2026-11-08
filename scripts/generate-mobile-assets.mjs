/**
 * Genererer Android- og iOS-ikoner/splash fra public/favicon.svg.
 *
 * Kjøres manuelt etter endringer i merkevaren:
 *   npm run native:assets
 *
 * Skriptet krever at android/ og ios/ finnes (npx cap add ...). Det er bevisst
 * ikke en del av CI-bygget, fordi de genererte filene sjekkes inn.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const svg = await fs.readFile(path.join(root, "public/favicon.svg"));
const ink = "#101310";

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function icon(size) {
  return sharp(svg).resize(size, size).png().toBuffer();
}

async function writeIcon(target, size) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, await icon(size));
}

async function writeSplash(target) {
  const meta = await sharp(target).metadata();
  const width = meta.width ?? 1920;
  const height = meta.height ?? 1280;
  const iconSize = Math.round(Math.min(width, height) * 0.28);
  const mark = await icon(iconSize);
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: ink,
    },
  })
    .composite([
      {
        input: mark,
        left: Math.round((width - iconSize) / 2),
        top: Math.round((height - iconSize) / 2),
      },
    ])
    .png()
    .toFile(target);
}

const android = path.join(root, "android/app/src/main/res");
if (await exists(android)) {
  const launcher = {
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192,
  };
  const foreground = {
    mdpi: 108,
    hdpi: 162,
    xhdpi: 216,
    xxhdpi: 324,
    xxxhdpi: 432,
  };
  for (const [density, size] of Object.entries(launcher)) {
    const dir = path.join(android, `mipmap-${density}`);
    await writeIcon(path.join(dir, "ic_launcher.png"), size);
    await writeIcon(path.join(dir, "ic_launcher_round.png"), size);
  }
  for (const [density, size] of Object.entries(foreground)) {
    await writeIcon(
      path.join(android, `mipmap-${density}/ic_launcher_foreground.png`),
      size,
    );
  }

  const backgroundFile = path.join(
    android,
    "values/ic_launcher_background.xml",
  );
  await fs.writeFile(
    backgroundFile,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ink}</color>
</resources>
`,
  );

  for (const file of [
    "drawable/splash.png",
    "drawable-port-mdpi/splash.png",
    "drawable-port-hdpi/splash.png",
    "drawable-port-xhdpi/splash.png",
    "drawable-port-xxhdpi/splash.png",
    "drawable-port-xxxhdpi/splash.png",
    "drawable-land-mdpi/splash.png",
    "drawable-land-hdpi/splash.png",
    "drawable-land-xhdpi/splash.png",
    "drawable-land-xxhdpi/splash.png",
    "drawable-land-xxxhdpi/splash.png",
  ]) {
    const target = path.join(android, file);
    if (await exists(target)) await writeSplash(target);
  }
}

const iosIcon = path.join(
  root,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
);
if (await exists(iosIcon)) {
  await writeIcon(iosIcon, 1024);
}

for (const file of [
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png",
]) {
  const target = path.join(root, file);
  if (await exists(target)) await writeSplash(target);
}

console.log("✓ Native ikoner og splash generert");
