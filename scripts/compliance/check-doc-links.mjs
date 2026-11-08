#!/usr/bin/env node
/**
 * Validate local Markdown links and paths in docs/compliance.
 *
 *   node scripts/compliance/check-doc-links.mjs
 *   node scripts/compliance/check-doc-links.mjs --path docs/compliance
 *
 * External URLs are not fetched. Local files, directories and Markdown anchors
 * are checked. Anchors are reported as warnings when the heading cannot be
 * matched, because GitHub's slug rules differ for punctuation.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const pathIndex = args.indexOf("--path");
const scanRoot = pathIndex >= 0 ? path.resolve(root, args[pathIndex + 1]) : path.join(root, "docs/compliance");

const files = walk(scanRoot).filter((file) => file.endsWith(".md"));
const errors = [];
const warnings = [];
let linkCount = 0;

if (!fs.existsSync(scanRoot)) {
  console.error(`Scan path does not exist: ${scanRoot}`);
  process.exit(1);
}

for (const file of files) {
  checkFile(file);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} broken Markdown link(s):`);
  for (const error of errors) console.error(`  ${error}`);
  if (warnings.length > 0) {
    console.error(`\n${warnings.length} anchor warning(s):`);
    for (const warning of warnings) console.error(`  ${warning}`);
  }
  process.exit(1);
}

console.log(`Checked ${files.length} Markdown file(s) and ${linkCount} local link(s).`);
if (warnings.length > 0) {
  console.log(`${warnings.length} anchor warning(s):`);
  for (const warning of warnings) console.log(`  ${warning}`);
}
console.log("No broken local Markdown paths.");

function checkFile(file) {
  const content = stripCode(fs.readFileSync(file, "utf8"));
  const relativeFile = path.relative(root, file);
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    const target = rawTarget.split(/\s+/)[0];
    if (!target || target.startsWith("#")) {
      if (target.startsWith("#")) {
        checkAnchor(file, target.slice(1), relativeFile);
      }
      continue;
    }
    if (/^(https?:|mailto:|tel:|data:|ftp:)/i.test(target)) continue;
    if (target.startsWith("/")) continue;
    linkCount += 1;

    const [pathPart, anchor] = target.split("#");
    let decodedPath = pathPart;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      // Keep the original if it is not valid percent-encoding.
    }
    if (!decodedPath) {
      if (anchor) checkAnchor(file, anchor, relativeFile);
      continue;
    }

    const resolved = path.resolve(path.dirname(file), decodedPath);
    if (!fs.existsSync(resolved)) {
      errors.push(`${relativeFile} -> ${target} (missing ${path.relative(root, resolved)})`);
      continue;
    }
    if (anchor && fs.statSync(resolved).isFile() && resolved.endsWith(".md")) {
      checkAnchor(resolved, anchor, relativeFile);
    }
  }
}

function checkAnchor(file, anchor, source) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const headings = extractHeadings(fs.readFileSync(file, "utf8"));
  const wanted = normalizeAnchor(anchor);
  if (!headings.some((heading) => normalizeAnchor(heading) === wanted)) {
    warnings.push(`${source} -> #${anchor} (heading not matched in ${path.relative(root, file)})`);
  }
}

function extractHeadings(content) {
  return stripCode(content)
    .split("\n")
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim());
}

function normalizeAnchor(value) {
  return String(value)
    .toLowerCase()
    .replace(/`|\*|_|~|\[|\]|\(|\)/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripCode(content) {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function walk(directory) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}
