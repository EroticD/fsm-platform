import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parseImageUrls, parseJsonObject } from "@/lib/report-answers";
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

type ReportLike = {
  dataJson?: string | null;
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

/**
 * Gjør bildene klare for PDF-en.
 *
 * PDF-motoren legger inn bildet slik det er, og et telefonbilde på flere
 * megabyte blir derfor både tungt å sende og umulig å vise som miniatyrbilde.
 * Her skaleres de ned én gang, og resultatet brukes både som lite bilde i
 * rapporten og på vedleggssiden – uten at bildet lagres to ganger i PDF-en.
 *
 * Nøkkelen er den opprinnelige URL-en, slik at PDF-komponenten kan slå opp
 * bildet den vil vise. Bilder vi ikke får skalert (eksterne, eller filer som er
 * borte) mangler i kartet, og da brukes den opprinnelige URL-en.
 */
export async function buildPdfImages(urls: string[]): Promise<Record<string, PdfImage>> {
  const scaled = await Promise.all(
    urls.map(async (url) => {
      const image = await shrinkToPdfImage(url);
      return image ? ([url, image] as const) : null;
    }),
  );

  return Object.fromEntries(scaled.filter((entry): entry is readonly [string, PdfImage] => !!entry));
}
