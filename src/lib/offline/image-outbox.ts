/**
 * Kø for bilder som er tatt eller valgt uten nett.
 *
 * Samme mønster som `visit-status-outbox`: postene ligger i IndexedDB og
 * tømmes når appen er online igjen. Køen er det som gjør at et bilde overlever
 * refresh, at OS-et dreper PWA-en, eller at nettleseren krasjer – uten den lå
 * bildet bare i React-state og måtte tas på nytt ute hos kunden.
 *
 * To bevisste forskjeller fra kladdene:
 *
 *  - Selve bildet lagres som en Blob og krypteres ikke. Det er binært innhold,
 *    og en kryptert Blob ville krevd den PIN-opplåste nøkkelen før bildet kunne
 *    legges i køen. Da ville et bilde tatt før opplåsing aldri blitt sikret.
 *    Metadataene (navn, type, størrelse, eier) er den samme informasjonen
 *    kamerarullen viser, og bildet forlater aldri enheten før opplasting.
 *  - Køen er knyttet til rapporten (`oppdrag:mal`) og feltet, slik at bildene
 *    kan vises igjen i riktig bildefelt etter remount, og ryddes når rapporten
 *    er sendt inn.
 *
 * Køen er ikke en erstatning for opplastings-API-et: den bruker nøyaktig samme
 * `/api/upload`-kall som før, bare utsatt til nettet er tilbake.
 */
import {
  clearOfflineImages,
  listStoredOfflineImages,
  putOfflineImage,
  removeOfflineImage as removeStoredOfflineImage,
  type OfflineImage,
} from "./db";
import { currentOfflineUserId } from "./draft-outbox";

export type { OfflineImage };

/** Resultat av å legge et bilde i køen. */
export type QueueOfflineImageResult = "queued" | "unavailable";

export type QueueOfflineImageInput = {
  reportId: string;
  unitKey: string;
  fieldId: string;
  file: Blob;
  /** Overstyrer filnavnet (f.eks. når bildet er komprimert om til JPEG). */
  name?: string;
  /** Eieren av køen. Standard er brukeren som er husket i denne nettleseren. */
  userId?: string | null;
  /** Kalleren kan angi id, slik at feltet kan oppdatere riktig rad etterpå. */
  id?: string;
};

export type ListOfflineImagesOptions = {
  /**
   * Filtrer på eier. Poster uten kjent eier tas med, på samme måte som for
   * visittstatusene: de er lagt inn før innloggingen rakk å huske brukeren.
   * Utelates feltet, returneres alle bilder for rapporten.
   */
  userId?: string | null;
  /**
   * Filtrer på felt. Et skjema kan ha flere bildefelter, og hvert felt skal
   * bare laste opp og vise sine egne bilder – ellers ville to felt som tømmer
   * køen samtidig kunnet ta hverandres bilder.
   */
  unitKey?: string;
  fieldId?: string;
};

/** Stabil id for en rapport i bildekøen. Eieren lagres på hver post. */
export function offlineReportId(
  workOrderId: string,
  templateId: string,
): string {
  return `${workOrderId}:${templateId}`;
}

function imageName(file: Blob, name?: string): string {
  if (name) return name;
  const fromFile = (file as File).name;
  if (typeof fromFile === "string" && fromFile.length > 0) return fromFile;
  return "image";
}

/**
 * Legger et bilde i køen med eierskap fra `currentOfflineUserId`, som for
 * kladdene. Bildet skrives i én transaksjon; feiler IndexedDB (privat modus,
 * full kvote), kastes feilen videre slik at feltet kan vise den vanlige
 * opplastingsfeilen i stedet for å late som bildet er sikret.
 */
export async function queueOfflineImage(
  input: QueueOfflineImageInput,
): Promise<QueueOfflineImageResult> {
  const userId =
    input.userId === undefined ? currentOfflineUserId() : input.userId;
  const image: OfflineImage = {
    id: input.id ?? crypto.randomUUID(),
    reportId: input.reportId,
    unitKey: input.unitKey,
    fieldId: input.fieldId,
    userId: userId ?? null,
    name: imageName(input.file, input.name),
    type: input.file.type || "application/octet-stream",
    size: input.file.size,
    blob: input.file,
    createdAt: Date.now(),
  };
  const stored = await putOfflineImage(image);
  return stored ? "queued" : "unavailable";
}

/**
 * Ventende bilder for rapporten, eldste først. Rekkefølgen gjør at bildene
 * vises i samme orden som de ble tatt, også etter en remount.
 */
export async function listOfflineImages(
  reportId: string,
  options: ListOfflineImagesOptions = {},
): Promise<OfflineImage[]> {
  const { userId, unitKey, fieldId } = options;
  return (await listStoredOfflineImages())
    .filter((image) => image.reportId === reportId)
    .filter(
      (image) => !userId || image.userId === null || image.userId === userId,
    )
    .filter((image) => unitKey === undefined || image.unitKey === unitKey)
    .filter((image) => fieldId === undefined || image.fieldId === fieldId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Fjerner ett bilde fra køen, f.eks. når montøren angrer valget. */
export async function removeOfflineImage(id: string): Promise<void> {
  await removeStoredOfflineImage(id);
}

/**
 * Tømmer køen for rapporten. Kalles når skjemaet er sendt inn uten feil, slik
 * at ventende bilder ikke senere lastes opp til en rapport som er låst.
 */
export async function clearOfflineImagesForReport(
  reportId: string,
  options: ListOfflineImagesOptions = {},
): Promise<number> {
  return clearOfflineImages({ reportId, userId: options.userId });
}

/** Laster opp ett køet bilde og gir tilbake URL-en serveren svarte med. */
export type OfflineImageUploader = (image: OfflineImage) => Promise<string>;

export type FlushedOfflineImage = {
  id: string;
  url: string;
  unitKey: string;
  fieldId: string;
  name: string;
};

export type OfflineImageFlushResult = {
  /** Bilder serveren kvitterte for, med URL-en feltet skal vise. */
  uploaded: FlushedOfflineImage[];
  /** Bilder som fortsatt ligger i køen. */
  pending: number;
  /** Bilder som feilet i dette forsøket og blir liggende. */
  failed: number;
};

/** Hindrer at to samtidige tømminger (mount og «online») laster opp samme bilde. */
const flushing = new Set<string>();

/** Nøkkel per køutsnitt, slik at to bildefelter kan tømme hver sin del. */
function flushKey(
  reportId: string,
  options: ListOfflineImagesOptions,
): string {
  return [
    reportId,
    options.userId ?? "",
    options.unitKey ?? "",
    options.fieldId ?? "",
  ].join("|");
}

/**
 * Laster opp køen for én rapport (og eventuelt ett felt) sekvensielt.
 *
 * `upload` injiseres av feltet, slik at kømodulen bruker nøyaktig samme
 * opplastingsvei som den vanlige, nettbaserte flyten og ikke avhenger av
 * React eller `fetch`. Et bilde som feiler blir liggende i køen – også når
 * feilen gjelder bare den ene filen – slik at de andre ikke blokkeres.
 * Posten fjernes først når serveren har svart med en URL.
 */
export async function flushOfflineImages(
  reportId: string,
  upload: OfflineImageUploader,
  options: ListOfflineImagesOptions = {},
): Promise<OfflineImageFlushResult> {
  const pendingNow = async () =>
    (await listOfflineImages(reportId, options)).length;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { uploaded: [], pending: await pendingNow(), failed: 0 };
  }
  const key = flushKey(reportId, options);
  if (flushing.has(key)) {
    return { uploaded: [], pending: await pendingNow(), failed: 0 };
  }

  flushing.add(key);
  const uploaded: FlushedOfflineImage[] = [];
  let failed = 0;

  try {
    for (const image of await listOfflineImages(reportId, options)) {
      let url: string;
      try {
        url = await upload(image);
      } catch {
        failed += 1;
        continue;
      }
      await removeOfflineImage(image.id);
      uploaded.push({
        id: image.id,
        url,
        unitKey: image.unitKey,
        fieldId: image.fieldId,
        name: image.name,
      });
    }
  } finally {
    flushing.delete(key);
  }

  return { uploaded, pending: await pendingNow(), failed };
}
