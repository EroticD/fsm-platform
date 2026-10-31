#!/usr/bin/env node
/**
 * Bygger FSM-brukermanualen fra markdown til to PDF-er (norsk og engelsk).
 *
 * Kildene er bevisst delt per rolle, slik at et kapittel kan oppdateres uten å
 * redigere hele manualen. Markdown konverteres med `md2html` (Discount) og
 * printes med Chromium via Playwright. Forsiden og hoveddelen printes hver for
 * seg, slik at forsiden ikke får sidefot; deretter slås de sammen med pdfunite.
 *
 * Krav: `md2html`, `pdfunite` og Playwrights Chromium.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manualDir = path.join(root, "docs", "manual");
const manifestPath = path.join(manualDir, "manifest.json");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsm-manual-"));

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function requireCommand(command) {
  const found = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
  });
  if (found.status !== 0) {
    fail(
      `Mangler «${command}». Installer Discount (md2html) og pdfunite (poppler-utils), eller bygg i CI-imaget.`,
    );
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripInlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function slugify(value) {
  return stripInlineMarkdown(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function markdownHeadings(markdown) {
  const headings = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    headings.push({
      level: match[1].length,
      text: stripInlineMarkdown(match[2]),
    });
  }
  return headings;
}

function convertMarkdown(markdown, source) {
  const result = spawnSync("md2html", ["--gfm"], {
    input: markdown,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) fail(`Kunne ikke kjøre md2html: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`md2html feilet for ${source}: ${result.stderr || "ukjent feil"}`);
  }
  return result.stdout;
}

function addHeadingIds(html, prefix) {
  let index = 0;
  return html.replace(/<h([12])>(.*?)<\/h\1>/gs, (_match, level, inner) => {
    index += 1;
    return `<h${level} id="${prefix}-h${index}">${inner}</h${level}>`;
  });
}

function renderSection(section, locale) {
  const sourcePath = path.join(manualDir, locale, section.file);
  if (!fs.existsSync(sourcePath)) {
    fail(`Mangler kildfil: ${sourcePath}`);
  }
  const markdown = fs.readFileSync(sourcePath, "utf8");
  const headings = markdownHeadings(markdown);
  const html = addHeadingIds(
    convertMarkdown(markdown, path.relative(root, sourcePath)),
    slugify(section.label) || "del",
  );

  const toc = headings
    .filter((heading) => heading.level === 2)
    .map((heading, index) => ({
      text: heading.text,
      href: `#${slugify(section.label) || "del"}-h${index + 2}`,
    }));

  return {
    html,
    toc,
    part: section.part ?? null,
    label: section.label,
  };
}

function coverHtml(doc) {
  const labels =
    doc.locale === "en"
      ? { version: "Version", date: "Date", audience: "Audience" }
      : { version: "Versjon", date: "Dato", audience: "Målgruppe" };
  return `<!doctype html>
<html lang="${doc.locale}">
<head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 210mm; height: 297mm; overflow: hidden;
    background: #0b0e0b; color: #f2efe6;
    font-family: "Open Sans", "Segoe UI", "DejaVu Sans", sans-serif;
  }
  .cover {
    position: relative; width: 100%; height: 100%;
    padding: 30mm 24mm 24mm; display: flex; flex-direction: column;
    background:
      radial-gradient(circle at 90% 5%, rgba(216,255,62,.24), transparent 34%),
      radial-gradient(circle at 8% 95%, rgba(216,255,62,.12), transparent 30%),
      #0b0e0b;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 10pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #d8ff3e; }
  .mark { width: 24px; height: 24px; border: 2px solid #d8ff3e; border-radius: 8px; display: grid; place-items: center; font-size: 15px; color: #d8ff3e; }
  .kicker { margin-top: auto; color: #d8ff3e; font-size: 10pt; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
  h1 { margin: 8mm 0 4mm; font-size: 38pt; line-height: 1.02; letter-spacing: -.035em; max-width: 155mm; }
  .subtitle { color: #f2efe6; opacity: .8; font-size: 15pt; line-height: 1.35; max-width: 145mm; }
  .note { margin-top: 12mm; color: #f2efe6; opacity: .62; font-size: 10.5pt; line-height: 1.5; max-width: 135mm; }
  .meta { margin-top: auto; padding-top: 10mm; border-top: 1px solid rgba(242,239,230,.2); display: flex; justify-content: space-between; gap: 12mm; color: #f2efe6; opacity: .7; font-size: 9pt; }
  .meta strong { display: block; color: #d8ff3e; opacity: 1; font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 2mm; }
</style></head>
<body><main class="cover">
  <div class="brand"><span class="mark">✓</span> FSM Platform</div>
  <div class="kicker">${escapeHtml(doc.coverKicker)}</div>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="subtitle">${escapeHtml(doc.subtitle)}</p>
  <p class="note">${escapeHtml(doc.coverNote)}</p>
  <div class="meta">
    <div><strong>${labels.version}</strong>${escapeHtml(doc.version)}</div>
    <div><strong>${labels.date}</strong>${escapeHtml(doc.date)}</div>
    <div><strong>${labels.audience}</strong>${escapeHtml(doc.subtitle)}</div>
  </div>
</main></body></html>`;
}

function bodyHtml(doc, sections) {
  const toc = sections
    .map((section) => {
      const subitems = section.toc
        .map(
          (item) =>
            `<li><a href="${item.href}">${escapeHtml(item.text)}</a></li>`,
        )
        .join("");
      return `<li class="toc-part"><a href="#${slugify(section.label) || "del"}-h1">${escapeHtml(section.label)}</a>${
        subitems ? `<ul>${subitems}</ul>` : ""
      }</li>`;
    })
    .join("");

  const body = sections
    .map((section, index) => {
      const part =
        section.part === null
          ? ""
          : `<div class="part-kicker">${escapeHtml(section.part)}</div>`;
      return `<section class="chapter${index === 0 ? " first" : ""}">
        ${part}
        ${section.html}
      </section>`;
    })
    .join("\n");

  const colophon =
    doc.locale === "en"
      ? `<section class="chapter colophon">
          <h1>About this manual</h1>
          <p>This manual describes FSM Platform ${escapeHtml(doc.version)} as of ${escapeHtml(doc.date)}. It is divided into an introduction, one chapter for each role and a reference chapter.</p>
          <table>
            <tbody>
              <tr><th>Document</th><td>${escapeHtml(doc.title)}</td></tr>
              <tr><th>Version</th><td>${escapeHtml(doc.version)}</td></tr>
              <tr><th>Date</th><td>${escapeHtml(doc.date)}</td></tr>
              <tr><th>Audience</th><td>${escapeHtml(doc.subtitle)}</td></tr>
              <tr><th>Source</th><td><code>docs/manual/en/</code> (Markdown)</td></tr>
            </tbody>
          </table>
          <p>The source is split by role so a single chapter can be updated without rewriting the whole document. Build the PDF with <code>node scripts/build-manual.mjs</code>. The generated PDF is a snapshot of the product configuration described in this edition; local settings, permissions and integrations may differ.</p>
        </section>`
      : `<section class="chapter colophon">
          <h1>Om denne manualen</h1>
          <p>Denne manualen beskriver FSM-plattformen ${escapeHtml(doc.version)} per ${escapeHtml(doc.date)}. Den er delt i en introduksjon, ett kapittel per rolle og en oppslagsdel.</p>
          <table>
            <tbody>
              <tr><th>Dokument</th><td>${escapeHtml(doc.title)}</td></tr>
              <tr><th>Versjon</th><td>${escapeHtml(doc.version)}</td></tr>
              <tr><th>Dato</th><td>${escapeHtml(doc.date)}</td></tr>
              <tr><th>Målgruppe</th><td>${escapeHtml(doc.subtitle)}</td></tr>
              <tr><th>Kilde</th><td><code>docs/manual/nb/</code> (Markdown)</td></tr>
            </tbody>
          </table>
          <p>Kilden er delt per rolle, slik at ett kapittel kan oppdateres uten å skrive om hele dokumentet. Bygg PDF-en med <code>node scripts/build-manual.mjs</code>. PDF-en er et øyeblikksbilde av produktet slik det er beskrevet i denne utgaven; lokale innstillinger, rettigheter og integrasjoner kan avvike.</p>
        </section>`;

  return `<!doctype html>
<html lang="${doc.locale}">
<head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  html { font-size: 10.2pt; }
  body {
    margin: 0; color: #101310; background: #fff;
    font-family: "Open Sans", "Segoe UI", "DejaVu Sans", sans-serif;
    line-height: 1.52;
  }
  a { color: #1d5f2a; text-decoration: underline; text-underline-offset: 2px; }
  h1, h2, h3, h4 { color: #101310; line-height: 1.18; break-after: avoid; }
  h1 { font-size: 25pt; letter-spacing: -.025em; margin: 0 0 7mm; padding-bottom: 3mm; border-bottom: 3px solid #d8ff3e; }
  h2 { font-size: 15.5pt; margin: 9mm 0 3mm; }
  h3 { font-size: 12.2pt; margin: 6mm 0 2mm; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; }
  p { margin: 0 0 3.2mm; }
  ul, ol { margin: 0 0 3.5mm 5mm; padding: 0; }
  li { margin: 0 0 1.5mm; }
  li > ul, li > ol { margin-top: 1.5mm; }
  strong { font-weight: 750; }
  hr { border: 0; border-top: 1px solid #dedcd1; margin: 6mm 0; }
  blockquote {
    margin: 4mm 0; padding: 3mm 4mm; border-left: 4px solid #d8ff3e;
    background: #f7f8f3; color: #30362e; break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }
  code { font-family: "DejaVu Sans Mono", "SFMono-Regular", monospace; font-size: .86em; background: #f2efe6; padding: .1em .3em; border-radius: 3px; }
  pre { margin: 4mm 0; padding: 3.5mm; border: 1px solid #dedcd1; border-radius: 5px; background: #f7f8f3; white-space: pre; overflow: hidden; break-inside: avoid; font-size: .74em; line-height: 1.3; }
  pre code { background: transparent; padding: 0; font-size: 1em; }
  table { width: 100%; border-collapse: collapse; margin: 3.5mm 0 5mm; font-size: .88em; break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #dedcd1; padding: 2mm 2.4mm; text-align: left; vertical-align: top; }
  th { background: #f2efe6; font-weight: 750; }
  tr:nth-child(even) td { background: #fbfbf8; }
  .chapter { break-before: page; }
  .chapter.first { break-before: auto; }
  .part-kicker { display: inline-block; margin-bottom: 2mm; padding: 1mm 2.5mm; border-radius: 3px; background: #d8ff3e; color: #101310; font-size: 8pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .toc-page { break-after: page; }
  .toc-page h1 { border-bottom-color: #101310; font-size: 21pt; margin-bottom: 3mm; }
  .toc-page ul { list-style: none; margin: 0; padding: 0; }
  .toc-page > ul > li { margin: 0 0 1.5mm; }
  .toc-page .toc-part > a { font-size: 12pt; font-weight: 800; color: #101310; text-decoration: none; }
  .toc-page .toc-part ul { margin: 1.5mm 0 0 5mm; }
  .toc-page .toc-part li { margin: 0 0 .15mm; font-size: 8.2pt; line-height: 1.16; }
  .toc-page .toc-part li a { color: #4d554b; text-decoration: none; }
  .toc-page .toc-part li a:hover { text-decoration: underline; }
  .avoid-break { break-inside: avoid; }
</style></head>
<body>
  <section class="toc-page">
    <h1>${escapeHtml(doc.tocTitle)}</h1>
    <ul>${toc}</ul>
  </section>
  ${body}
  ${colophon}
</body></html>`;
}

async function pdfFromHtml(browser, html, output, options) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: true,
    ...options,
  });
  await page.close();
}

async function buildDocument(browser, doc) {
  const sections = doc.sections.map((section) =>
    renderSection(section, doc.locale),
  );

  const coverPath = path.join(workDir, `${doc.locale}-cover.pdf`);
  const bodyPath = path.join(workDir, `${doc.locale}-body.pdf`);
  const outputPath = path.join(manualDir, doc.output);

  await pdfFromHtml(browser, coverHtml(doc), coverPath, {
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    displayHeaderFooter: false,
  });

  const footer = `<div style="width:100%;font-size:7.5px;color:#62685f;padding:0 18mm;font-family:'Open Sans','Segoe UI',sans-serif;display:flex;justify-content:space-between;gap:8mm;">
    <span>${escapeHtml(doc.title)} · ${escapeHtml(doc.version)}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

  await pdfFromHtml(browser, bodyHtml(doc, sections), bodyPath, {
    margin: { top: "16mm", right: "18mm", bottom: "19mm", left: "18mm" },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: footer,
  });

  execFileSync("pdfunite", [coverPath, bodyPath, outputPath], {
    stdio: "inherit",
  });
  console.log(`✓ ${path.relative(root, outputPath)}`);
}

async function main() {
  requireCommand("md2html");
  requireCommand("pdfunite");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    for (const doc of manifest.documents) {
      doc.version = manifest.version;
      doc.date = manifest.date;
      await buildDocument(browser, doc);
    }
  } finally {
    await browser.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
