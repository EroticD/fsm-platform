import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parseImageUrls, parseJsonObject } from "@/lib/report-answers";
import type { UploadOwnerType } from "@/lib/upload-access";
import {
  hasAllowedOwner,
  loadUploadOwnerships,
  uploadStoredName,
} from "@/lib/upload-ownership";
import { uploadDir } from "@/lib/uploads";

/** Lastes opp hit, og kan skaleres ned lokalt. Eksterne bilder brukes som de er. */
const LOCAL_PREFIX = "/uploads/";

/** Lengste side i bildet slik det legges inn i PDF-en. */
const MAX_EDGE = 1600;

/** Hvor stort et bilde kan tegnes på en vedleggsside (A4 med 40 pt marg). */
export const PDF_IMAGE_MAX_WIDTH = 515;
export const PDF_IMAGE_MAX_HEIGHT = 560;

/** Et bilde klart for PDF-en: nedskalert, med ferdig utregnet størrelse i punkter. */
export type PdfImage = {
  src: string;
  /** Utregnet bredde/høyde i punkter, slik at bildet får plass på siden. */
  width?: number;
  height?: number;
};

/** En data-URL med et bildeformat PDF-motoren kan lese. */
const EMBEDDED_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
/** Kun filer i appens egen opplastingsmappe. */
const LOCAL_UPLOAD = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Velger hvilken kilde PDF-motoren får lov å hente bildet fra.
 *
 * PDF-generering skal aldri hente vilkårlige http(s)-adresser: det ville både
 * være en SSRF-vei og kunne vise innhold fra andre tjenere i en signert
 * rapport. Bare ferdig innbakte data-URL-er og filer under `/uploads` godtas.
 * En ukjent eller ekstern URL gir `null`, og da tegnes ikke bildet.
 */
export function resolvePdfImageSource(
  url: string | null | undefined,
  pdfImages: Record<string, PdfImage> | undefined,
  baseUrl?: string | null,
): PdfImage | null {
  const source = (url ?? "").trim();
  if (!source) return null;

  const embedded = pdfImages?.[source];
  if (embedded && EMBEDDED_IMAGE.test(embedded.src)) return embedded;
  if (EMBEDDED_IMAGE.test(source)) return { src: source };

  if (!LOCAL_UPLOAD.test(source)) return null;
  const origin = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/i.test(origin)) return null;

  return { src: `${origin}${source}` };
}

/**
 * Et bilde som skal gjøres klart for PDF-en, med hvilke opplastingseiere som
 * er lov for akkurat dette bildet. Rapporter bruker `WORK_ORDER`, logoen
 * bruker `BRANDING` – en fil uten metadata eller med feil eier leses ikke.
 */
export type PdfImageRequest = {
  url: string;
  ownerTypes: readonly UploadOwnerType[];
};

type ReportLike = {
  dataJson?: string | null;
  technicianSignatureUrl?: string | null;
  customerSignatureUrl?: string | null;
  units?: Array<{ answersJson?: string | null }> | null;
};

/** Ser verdien ut som en bilde-URL? */
function looksLikeImage(url: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(url.trim());
}

/**
 * Finner alle vedlagte bilder i rapportene, i den rekkefølgen de ble lagt inn.
 *
 * Vi leter etter alt som ser ut som et bilde i svarene, i stedet for å gå via
 * malens felttyper: da fanger vi også bilder i eldre rapporter, der feltene
 * ikke lenger finnes i malen.
 */
export function collectReportImageUrls(reports: ReportLike[] | null | undefined): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addAnswers = (answers: Record<string, unknown>) => {
    for (const value of Object.values(answers)) {
      if (typeof value !== "string") continue;
      for (const url of parseImageUrls(value)) {
        if (!looksLikeImage(url) || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
  };

  for (const report of reports ?? []) {
    // Signaturbilder ligger ikke i svarfeltene, men må også gjøres om til
    // data-URL før PDF-renderingen. /uploads krever innlogging, og PDF-motoren
    // henter bilder uten nettleserens sesjonscookie.
    for (const url of [
      report.technicianSignatureUrl,
      report.customerSignatureUrl,
    ]) {
      if (typeof url !== "string") continue;
      const trimmed = url.trim();
      if (!looksLikeImage(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      urls.push(trimmed);
    }

    const legacy = parseJsonObject(report.dataJson).answers;
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      addAnswers(legacy as Record<string, unknown>);
    }
    for (const unit of report.units ?? []) addAnswers(parseJsonObject(unit.answersJson));
  }

  return urls;
}

/** Skalerer ned ett opplastet bilde og gir det tilbake som data-URL. */
async function shrinkToPdfImage(url: string): Promise<PdfImage | null> {
  if (!url.startsWith(LOCAL_PREFIX)) return null;

  const root = uploadDir();
  const decoded = decodeURIComponent(url.slice(LOCAL_PREFIX.length));
  const filePath = path.join(root, ...decoded.split("/"));

  // Aldri les filer utenfor opplastingsmappen.
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;

  try {
    const file = await fs.readFile(filePath);
    const { data, info } = await sharp(file)
      // Telefonbilder har ofte orienteringen i EXIF – snu bildet før det skaleres.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      // JPEG har ingen gjennomsiktighet; legg bildet på hvit bakgrunn.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 78, progressive: true })
      .toBuffer({ resolveWithObject: true });

    // Regn ut hvor stort bildet kan tegnes på en A4-side uten å forvrenge det.
    const scale = Math.min(
      PDF_IMAGE_MAX_WIDTH / info.width,
      PDF_IMAGE_MAX_HEIGHT / info.height,
    );

    return {
      src: `data:image/jpeg;base64,${data.toString("base64")}`,
      width: Math.round(info.width * scale),
      height: Math.round(info.height * scale),
    };
  } catch (error) {
    console.error("Kunne ikke skalere bilde til PDF:", url, error);
    return null;
  }
}

/** Hvor mange bilder som skaleres samtidig før PDF-en settes sammen. */
const IMAGE_SCALE_CONCURRENCY = 4;

/**
 * Gjør bildene klare for PDF-en.
 *
 * PDF-motoren legger inn bildet slik det er, og et telefonbilde på flere
 * megabyte blir derfor både tungt å sende og umulig å vise som miniatyrbilde.
 * Her skaleres de ned én gang, og resultatet brukes både som lite bilde i
 * rapporten og på vedleggssiden – uten at bildet lagres to ganger i PDF-en.
 *
 * Nøkkelen er den opprinnelige URL-en, slik at PDF-komponenten kan slå opp
 * bildet den vil vise. Bilder vi ikke får skalert (eksterne, filer som er
 * borte, eller filer uten gyldig eier) mangler i kartet, og da brukes den
 * opprinnelige URL-en.
 *
 * Sharp bruker mye minne per bilde. Derfor skaleres bildene i små bolker i
 * stedet for alle på en gang – en rapport kan ha mange vedlegg.
 */
export async function buildPdfImages(
  requests: readonly PdfImageRequest[],
): Promise<Record<string, PdfImage>> {
  // Slå opp eierskapet til alle filene før noe leses fra disk. En fil uten
  // `Upload`-rad, eller med en eiertype som ikke er lov for bruken, hoppes
  // over – eldre filer uten metadata feiler dermed lukket.
  const unique = new Map<string, PdfImageRequest>();
  for (const request of requests) {
    if (!unique.has(request.url)) unique.set(request.url, request);
  }

  const ownerships = await loadUploadOwnerships([...unique.keys()]);
  const urls: string[] = [];
  for (const [url, request] of unique) {
    const storedName = uploadStoredName(url);
    const upload = storedName ? ownerships.get(storedName) : undefined;
    if (hasAllowedOwner(upload, request.ownerTypes)) urls.push(url);
  }

  const scaled: (readonly [string, PdfImage])[] = [];

  for (let start = 0; start < urls.length; start += IMAGE_SCALE_CONCURRENCY) {
    const batch = urls.slice(start, start + IMAGE_SCALE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (url) => {
        const image = await shrinkToPdfImage(url);
        return image ? ([url, image] as const) : null;
      }),
    );

    for (const entry of results) {
      if (entry) scaled.push(entry);
    }
  }

  return Object.fromEntries(scaled);
}
