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

/** Er dette en data-URL som PDF-motoren kan lese direkte? */
export function isEmbeddedImageUrl(url: string | null | undefined): boolean {
  return EMBEDDED_IMAGE.test((url ?? "").trim());
}

/** Er dette en fil i appens egen opplastingsmappe? */
export function isLocalUploadUrl(url: string | null | undefined): boolean {
  return LOCAL_UPLOAD.test((url ?? "").trim());
}

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
  /**
   * Rapporteringsbilder må tilhøre rapportens oppdrag. Når feltet er satt,
   * kontrolleres eier-id, avdeling og kunde i tillegg til eiertypen. Merkede
   * logoer har ingen oppdragstilknytning og utelater feltet.
   */
  workOrder?: {
    id: string;
    departmentId?: string | null;
    customerId?: string | null;
  };
};

type ReportLike = {
  dataJson?: string | null;
  technicianSignatureUrl?: string | null;
  customerSignatureUrl?: string | null;
  units?: Array<{ answersJson?: string | null }> | null;
};

/** Ser verdien ut som en bilde-URL? Data-URL-er har ikke filendelse. */
function looksLikeImage(url: string): boolean {
  const trimmed = url.trim();
  return EMBEDDED_IMAGE.test(trimmed) || /\.(jpe?g|png|webp|gif)$/i.test(trimmed);
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

/** Skalerer og orienterer et bilde som allerede er lest inn. */
async function toPdfImage(file: Buffer): Promise<PdfImage | null> {
  try {
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
  } catch {
    return null;
  }
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
    return await toPdfImage(file);
  } catch {
    // Stabile koder uten filnavn eller annen metadata i loggen.
    console.error("report_pdf_image_scale_failed", { code: "local_upload" });
    return null;
  }
}

/** Skalerer ned et bilde som allerede ligger som data-URL i rapporten. */
async function shrinkDataUrlToPdfImage(url: string): Promise<PdfImage | null> {
  const comma = url.indexOf(",");
  if (comma === -1) return null;
  try {
    const file = Buffer.from(url.slice(comma + 1), "base64");
    if (file.length === 0) return null;
    return await toPdfImage(file);
  } catch {
    console.error("report_pdf_image_scale_failed", { code: "data_url" });
    return null;
  }
}

/** Hvor mange bilder som skaleres samtidig før PDF-en settes sammen. */
const IMAGE_SCALE_CONCURRENCY = 4;

export type PdfImageBuildResult = {
  images: Record<string, PdfImage>;
  /**
   * Lokale opplastinger som var forventet i PDF-en, men som ikke kunne bygges
   * inn (mangler `Upload`-rad, feil eier eller filen er borte). Brukes til en
   * synlig advarsel i PDF-en i stedet for at bildet bare forsvinner.
   */
  missing: string[];
};

/**
 * Gjør bildene klare for PDF-en.
 *
 * PDF-motoren legger inn bildet slik det er, og et telefonbilde på flere
 * megabyte blir derfor både tungt å sende og umulig å vise som miniatyrbilde.
 * Her skaleres de ned én gang, og resultatet brukes både som lite bilde i
 * rapporten og på vedleggssiden – uten at bildet lagres to ganger i PDF-en.
 *
 * Nøkkelen er den opprinnelige URL-en, slik at PDF-komponenten kan slå opp
 * bildet den vil vise. Data-URL-er er selvstendige og krever ingen
 * opplastingsrad, men skaleres på samme måte.
 *
 * Sharp bruker mye minne per bilde. Derfor skaleres bildene i små bolker i
 * stedet for alle på en gang – en rapport kan ha mange vedlegg.
 */
export async function buildPdfImagesDetailed(
  requests: readonly PdfImageRequest[],
): Promise<PdfImageBuildResult> {
  // Slå opp eierskapet til alle filene før noe leses fra disk. En fil uten
  // `Upload`-rad, eller med en eiertype som ikke er lov for bruken, hoppes
  // over – eldre filer uten metadata feiler dermed lukket.
  const unique = new Map<string, PdfImageRequest>();
  for (const request of requests) {
    if (!unique.has(request.url)) unique.set(request.url, request);
  }

  const localOwnerships = await loadUploadOwnerships(
    [...unique.keys()].filter((url) => !isEmbeddedImageUrl(url)),
  );
  const localUrls: string[] = [];
  const dataUrls: string[] = [];
  const missing: string[] = [];

  for (const [url, request] of unique) {
    // En data-URL er selve bildet og kan ikke peke på en fil utenfor PDF-en.
    if (isEmbeddedImageUrl(url)) {
      dataUrls.push(url);
      continue;
    }

    const storedName = uploadStoredName(url);
    const upload = storedName ? localOwnerships.get(storedName) : undefined;
    if (!hasAllowedOwner(upload, request.ownerTypes)) {
      missing.push(url);
      continue;
    }

    // Rapporteringsbilder må eies av nøyaktig rapportens oppdrag. En fil med
    // riktig eiertype, men fra et annet oppdrag/kunde/avdeling, skal ikke
    // kunne leses inn i PDF-en. Uten oppdragskontekst feiler vi lukket.
    if (request.ownerTypes.includes("WORK_ORDER")) {
      const scope = request.workOrder;
      if (
        !scope ||
        upload.ownerType !== "WORK_ORDER" ||
        upload.ownerId !== scope.id
      ) {
        missing.push(url);
        continue;
      }
      if (
        scope.departmentId !== undefined &&
        upload.departmentId !== scope.departmentId
      ) {
        missing.push(url);
        continue;
      }
      if (scope.customerId !== undefined && upload.customerId !== scope.customerId) {
        missing.push(url);
        continue;
      }
    }

    localUrls.push(url);
  }

  const scaled: (readonly [string, PdfImage])[] = [];

  const scale = async (
    url: string,
    shrink: (url: string) => Promise<PdfImage | null>,
  ) => {
    const image = await shrink(url);
    return image ? ([url, image] as const) : null;
  };

  for (let start = 0; start < localUrls.length; start += IMAGE_SCALE_CONCURRENCY) {
    const batch = localUrls.slice(start, start + IMAGE_SCALE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((url) => scale(url, shrinkToPdfImage)),
    );

    for (const [index, entry] of results.entries()) {
      if (entry) scaled.push(entry);
      // En lokal fil som ikke kunne leses/skaleres er også en manglende bilde.
      else missing.push(batch[index]);
    }
  }

  for (let start = 0; start < dataUrls.length; start += IMAGE_SCALE_CONCURRENCY) {
    const batch = dataUrls.slice(start, start + IMAGE_SCALE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((url) => scale(url, shrinkDataUrlToPdfImage)),
    );

    for (const entry of results) {
      // Data-URL-en kan uansett tegnes direkte av PDF-motoren, så en feilet
      // nedskalering er ikke en manglende bilde.
      if (entry) scaled.push(entry);
    }
  }

  return { images: Object.fromEntries(scaled), missing };
}

/** Som `buildPdfImagesDetailed`, men returnerer bare bildekartet. */
export async function buildPdfImages(
  requests: readonly PdfImageRequest[],
): Promise<Record<string, PdfImage>> {
  const { images } = await buildPdfImagesDetailed(requests);
  return images;
}
