import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inlineHtmlImages,
  inlineMarkdownImages,
  readImageAsDataUri,
} from "../lib/manual-images.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIER = path.resolve(HERE, "..", "verify-manual-screenshots.mjs");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "manual-tools-"));
  const manualDir = path.join(root, "docs", "manual", "nb");
  const screenshotsDir = path.join(root, "screenshots", "manual", "nb");
  mkdirSync(manualDir, { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });
  return { root, manualDir, screenshotsDir };
}

function writeImage(file) {
  writeFileSync(file, PNG);
}

function runVerifier(root) {
  const result = spawnSync(
    process.execPath,
    [VERIFIER, "--root", root],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

test("inliner Markdown-bilder som data-URI og bevarer tittel", () => {
  const { root, manualDir, screenshotsDir } = fixture();
  try {
    writeImage(path.join(screenshotsDir, "dash bord.png"));
    writeImage(path.join(screenshotsDir, "dash.png"));
    const markdownFile = path.join(manualDir, "kapittel.md");
    const markdown = [
      "# Test",
      "",
      '![Dashbord](<../../../screenshots/manual/nb/dash bord.png> "Forsiden")',
      "![Rot](/screenshots/manual/nb/dash.png)",
    ].join("\n");

    const inlined = inlineMarkdownImages(markdown, markdownFile, { root });
    assert.match(inlined, /!\[Dashbord\]\(data:image\/png;base64,/);
    assert.match(inlined, /"Forsiden"\)/);
    assert.equal((inlined.match(/data:image\/png;base64,/g) ?? []).length, 2);
    assert.doesNotMatch(inlined, /screenshots\/manual/);

    const html = inlineHtmlImages(
      '<figure><img src="../../../screenshots/manual/nb/dash.png" alt="Figur" /></figure>',
      markdownFile,
      { root },
    );
    assert.match(html, /src="data:image\/png;base64,/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inliner rapporterer manglende og ikke-støttet bilde tydelig", () => {
  const { root, manualDir, screenshotsDir } = fixture();
  try {
    const markdownFile = path.join(manualDir, "kapittel.md");
    assert.throws(
      () =>
        readImageAsDataUri(
          "../../../screenshots/manual/nb/finnes-ikke.png",
          markdownFile,
          { root },
        ),
      (error) =>
        error.message.includes("Mangler bildefil") &&
        error.message.includes("finnes-ikke.png"),
    );

    writeFileSync(path.join(screenshotsDir, "gammel.gif"), PNG);
    assert.throws(
      () =>
        readImageAsDataUri(
          "../../../screenshots/manual/nb/gammel.gif",
          markdownFile,
          { root },
        ),
      /Bildeformatet «\.gif» støttes ikke/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifiseringen feiler med manglende, foreldreløse og manifestfiler", () => {
  const { root, manualDir, screenshotsDir } = fixture();
  try {
    writeImage(path.join(screenshotsDir, "used.png"));
    writeImage(path.join(screenshotsDir, "orphan.png"));
    writeFileSync(
      path.join(manualDir, "kapittel.md"),
      [
        "# Test",
        "",
        "![Brukt](../../../screenshots/manual/nb/used.png)",
        "![Mangler](../../../screenshots/manual/nb/missing.png)",
      ].join("\n"),
    );
    writeFileSync(
      path.join(root, "screenshots", "manual", "manifest.json"),
      JSON.stringify(
        {
          screenshots: [
            { file: "screenshots/manual/nb/used.png" },
            { file: "screenshots/manual/nb/ghost.png" },
          ],
        },
        null,
        2,
      ),
    );

    const { status, output } = runVerifier(root);
    assert.equal(status, 1);
    assert.match(output, /missing\.png/);
    assert.match(output, /ghost\.png/);
    assert.match(output, /orphan\.png/);
    assert.match(output, /Manglende eller tomme bildefiler/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifiseringen godtar brukte og eksplisitt ubrukte skjermbilder", () => {
  const { root, manualDir, screenshotsDir } = fixture();
  try {
    writeImage(path.join(screenshotsDir, "used.png"));
    writeImage(path.join(screenshotsDir, "orphan.png"));
    writeFileSync(
      path.join(manualDir, "kapittel.md"),
      "# Test\n\n![Brukt](../../../screenshots/manual/nb/used.png)\n",
    );
    writeFileSync(
      path.join(root, "screenshots", "manual", "manifest.json"),
      JSON.stringify(
        {
          screenshots: [
            { file: "screenshots/manual/nb/used.png" },
            {
              file: "screenshots/manual/nb/orphan.png",
              unused: true,
              reason: "Erstattet av used.png",
            },
          ],
        },
        null,
        2,
      ),
    );

    const { status, output } = runVerifier(root);
    assert.equal(status, 0, output);
    assert.match(output, /✓ Alle bildereferanser finnes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
