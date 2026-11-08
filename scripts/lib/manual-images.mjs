/**
 * Felles hjelp for manuelle skjermbilder: tolkning av Markdown/HTML-bilder,
 * oppslag av relative filstier og innlining som data-URI.
 *
 * Bygget (`build-manual.mjs`) og verifiseringen
 * (`verify-manual-screenshots.mjs`) bruker samme regler, slik at det som
 * godkjennes av verifiseringen også kan rendres av Chromium.
 */
import fs from "node:fs";
import path from "node:path";

export const IMAGE_MIME_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

export const SUPPORTED_IMAGE_EXTENSIONS = [...IMAGE_MIME_BY_EXTENSION.keys()];

const EXTERNAL_SOURCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const MARKDOWN_IMAGE =
  /!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?\s*\)/g;
const HTML_IMAGE = /<img\b([^>]*?)\ssrc=(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>/gi;

/** Fjerner kodeblokker og inline-kode før bildereferanser tolkes. */
export function stripMarkdownCode(markdown) {
  const output = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && marker) {
      fence = marker[1][0];
      output.push("");
      continue;
    }
    if (fence !== null) {
      if (marker && marker[1][0] === fence) fence = null;
      output.push("");
      continue;
    }
    output.push(
      line.replace(/`[^`\n]*`/g, (code) => " ".repeat(code.length)),
    );
  }
  return output.join("\n");
}

export function isExternalImageSource(source) {
  return EXTERNAL_SOURCE.test(String(source).trim());
}

export function stripSourceDecorations(source) {
  return String(source)
    .trim()
    .replace(/[?#].*$/, "")
    .replaceAll("&amp;", "&");
}

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function imageExtension(filePath) {
  return path.extname(stripSourceDecorations(filePath)).toLowerCase();
}

export function imageMimeType(filePath) {
  return IMAGE_MIME_BY_EXTENSION.get(imageExtension(filePath)) ?? null;
}

/**
 * Løser en bildekilde til en absolutt filsti.
 *
 * Relative kilder løses fra Markdown-filen. Kilder som starter med `/` løses
 * fra repo-roten, slik at `/screenshots/manual/...` virker uavhengig av hvor
 * Markdown-filen ligger.
 */
export function resolveImagePath(source, markdownPath, { root }) {
  const clean = decodePath(stripSourceDecorations(source));
  if (path.isAbsolute(clean) && clean.startsWith(root)) return clean;
  if (clean.startsWith("/")) return path.join(root, clean.slice(1));
  return path.resolve(path.dirname(markdownPath), clean);
}

function unsupportedFormat(source) {
  const extension = imageExtension(source) || "(uten endelse)";
  return new Error(
    `Bildeformatet «${extension}» støttes ikke for «${source}». ` +
      `Støttede formater: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}.`,
  );
}

/** Leser et lokalt bilde og returnerer det som data-URI (base64). */
export function readImageAsDataUri(source, markdownPath, { root }) {
  if (isExternalImageSource(source)) return source;
  const mimeType = imageMimeType(source);
  if (!mimeType) throw unsupportedFormat(source);

  const absolutePath = resolveImagePath(source, markdownPath, { root });
  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    throw new Error(
      `Mangler bildefil «${source}» referert fra ${path.relative(root, markdownPath)}. ` +
        `Forventet fil: ${absolutePath}`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(
      `Bildestien «${source}» i ${path.relative(root, markdownPath)} er ikke en fil: ${absolutePath}`,
    );
  }
  if (stats.size === 0) {
    throw new Error(
      `Bildefilen «${source}» i ${path.relative(root, markdownPath)} er tom: ${absolutePath}`,
    );
  }

  const data = fs.readFileSync(absolutePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

/**
 * Inliner Markdown-bilder (`![alt](fil)` / `![alt](<fil med mellomrom>)`).
 * Eksterne kilder og data-URI-er beholdes uendret.
 */
export function inlineMarkdownImages(markdown, markdownPath, { root }) {
  return markdown.replace(
    MARKDOWN_IMAGE,
    (match, alt, angleSource, plainSource, doubleTitle, singleTitle, parenTitle) => {
      const source = angleSource ?? plainSource;
      if (!source || isExternalImageSource(source)) return match;
      const dataUri = readImageAsDataUri(source, markdownPath, { root });
      const title = doubleTitle ?? singleTitle ?? parenTitle;
      const titlePart = title
        ? ` "${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : "";
      return `![${alt}](${dataUri}${titlePart})`;
    },
  );
}

/**
 * Inliner rå `<img src="...">` som Discount slipper gjennom. Dette dekker
 * både HTML-bilder og eventuelle Markdown-bilder som ikke ble fanget over.
 */
export function inlineHtmlImages(html, markdownPath, { root }) {
  return html.replace(
    HTML_IMAGE,
    (match, before, doubleSource, singleSource, bareSource, after) => {
      const source = (doubleSource ?? singleSource ?? bareSource ?? "").trim();
      if (!source || isExternalImageSource(source)) return match;
      const dataUri = readImageAsDataUri(source, markdownPath, { root });
      return `<img${before} src="${dataUri}"${after}>`;
    },
  );
}

/** Alle bildereferanser i Markdown, med linjenummer (1-basert). */
export function extractMarkdownImageReferences(markdown) {
  const references = [];
  MARKDOWN_IMAGE.lastIndex = 0;
  let match;
  while ((match = MARKDOWN_IMAGE.exec(markdown)) !== null) {
    const source = match[2] ?? match[3];
    if (!source) continue;
    references.push({
      alt: match[1],
      source,
      title: match[4] ?? match[5] ?? match[6] ?? null,
      index: match.index,
      line: markdown.slice(0, match.index).split("\n").length,
    });
  }
  return references;
}

/** Alle rå `<img src="...">`-referanser, med linjenummer (1-basert). */
export function extractHtmlImageReferences(html) {
  const references = [];
  HTML_IMAGE.lastIndex = 0;
  let match;
  while ((match = HTML_IMAGE.exec(html)) !== null) {
    const source = match[2] ?? match[3] ?? match[4];
    if (!source) continue;
    references.push({
      alt: null,
      source,
      title: null,
      index: match.index,
      line: html.slice(0, match.index).split("\n").length,
    });
  }
  return references;
}
