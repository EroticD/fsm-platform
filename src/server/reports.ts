import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyWorkOrderEvent } from "./notifications";
import { hasPermission } from "@/lib/permissions";
import { isOffice } from "@/lib/session";
import { canAccessWorkOrder, workOrderScope, type AccessUser } from "@/lib/access";
import { lineCommentKey, parseImageUrls } from "@/lib/report-answers";
import { LIMITS, cleanDataImage, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { reportDraftSchema, reportSubmitSchema, reportUnlockSchema } from "@/lib/schemas/report";
import { deleteUploadIfOwned, storeDataImage } from "@/lib/upload-store";

/**
 * Tjenestelaget for rapporter.
 *
 * Rapporten er et juridisk dokument: den låses når den signeres, malen fryses
 * som øyeblikksbilde, og endringer logges. Derfor ligger all denne logikken her
 * og ikke i sidekomponentene – den skal kunne testes uten en nettleser, og
 * reglene skal gjelde uansett hvilken vei rapporten sendes inn.
 *
 * Tjenesten tar en eksplisitt aktør og returnerer et resultat. Det er
 * action-wrapperen som oversetter resultatet til redirect/revalidate.
 */

type Actor = AccessUser | null;

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;
const SIGNATURE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;

/** Kladden skal ikke kunne gjøre listespørringer og backups vilkårlig tunge. */
const MAX_DRAFT_JSON_LENGTH = 1_000_000;

/**
 * Leser en signatur fra skjemaet. Nye signaturer kommer som data-URL fra
 * tegneflaten, mens en opplåst rapport kan sende tilbake en allerede lagret
 * `/uploads/...`-adresse. Alt annet ignoreres.
 */
function acceptedSignature(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (UPLOAD_URL.test(raw)) return raw;
  // Samme formater som storeDataImage kan skrive; GIF og andre typer avvises
  // her i stedet for å gi en feil lenger ned.
  if (!SIGNATURE_DATA_URL.test(raw)) return "";
  return cleanDataImage(raw, 7_000_000);
}

/**
 * Lagrer en ny data-URL som fil, eller beholder en eksisterende opplastings-
 * adresse. Tomt felt betyr «behold signaturen som ligger der».
 */
async function resolveSignature(
  value: unknown,
  fallback: string | null | undefined,
  ctx: {
    ownerType: "WORK_ORDER";
    ownerId: string;
    departmentId: string;
    customerId: string | null;
    uploadedById: string;
  },
): Promise<string | null> {
  const accepted = acceptedSignature(value);
  if (!accepted) return fallback ?? null;
  if (accepted.startsWith("data:")) return storeDataImage(accepted, ctx);

  // En allerede lagret URL må tilhøre dette oppdraget, eller være en privat
  // opplasting fra samme bruker. Ellers kunne en klient aliaset inn en fil fra
  // et annet oppdrag/kunde i en signert rapport.
  const storedName = accepted.slice("/uploads/".length);
  const upload = await prisma.upload.findUnique({
    where: { storedName },
    select: { ownerType: true, ownerId: true, uploadedById: true },
  });
  if (!upload) return fallback ?? null;

  if (upload.ownerType === "WORK_ORDER" && upload.ownerId === ctx.ownerId) {
    return accepted;
  }
  if (upload.ownerType === "USER" && upload.uploadedById === ctx.uploadedById) {
    await prisma.upload.update({
      where: { storedName },
      data: {
        ownerType: "WORK_ORDER",
        ownerId: ctx.ownerId,
        departmentId: ctx.departmentId,
        customerId: ctx.customerId,
      },
    });
    return accepted;
  }

  return fallback ?? null;
}

/**
 * Signaturer i en kladd skal ikke ligge som base64 i `dataJson`. De skrives som
 * vanlige filer eid av brukeren (`USER`), og kladden inneholder bare
 * `/uploads/...`. Når rapporten signeres tar `resolveSignature` over eierskapet.
 */
async function resolveDraftSignature(
  value: unknown,
  user: AccessUser,
  created: string[],
): Promise<string | null> {
  const accepted = acceptedSignature(value);
  if (!accepted) return null;
  if (!accepted.startsWith("data:")) {
    const storedName = accepted.slice(accepted.lastIndexOf("/") + 1);
    const upload = await prisma.upload.findUnique({
      where: { storedName },
      select: { ownerType: true, ownerId: true, uploadedById: true },
    });
    // En kladd kan bare referere til brukerens egen, ennå ikke tilknyttede fil.
    if (
      !upload ||
      upload.ownerType !== "USER" ||
      upload.ownerId !== user.id ||
      upload.uploadedById !== user.id
    ) {
      return null;
    }
    return accepted;
  }

  const url = await storeDataImage(accepted, {
    ownerType: "USER",
    ownerId: user.id,
    departmentId: user.departmentId ?? null,
    customerId: null,
    uploadedById: user.id,
  });
  created.push(url);
  return url;
}

/** Leser signatur-URL-ene fra en tidligere kladd, uten å stole på formen. */
function draftSignatureUrls(dataJson: string | null | undefined): {
  technician: string | null;
  customer: string | null;
} {
  if (!dataJson) return { technician: null, customer: null };
  try {
    const parsed = JSON.parse(dataJson) as Record<string, unknown>;
    const read = (key: string) => {
      const value = parsed[key];
      return typeof value === "string" && UPLOAD_URL.test(value) ? value : null;
    };
    return {
      technician: read("technicianSignatureUrl"),
      customer: read("customerSignatureUrl"),
    };
  } catch {
    return { technician: null, customer: null };
  }
}

/**
 * Feltene som trengs for å fryse en rapport til revisjonshistorikken.
 * Enhetene tas med i sin helhet, slik at en tidligere revisjon kan leses selv
 * om rapporten senere endres.
 */
const REVISION_SOURCE_SELECT = {
  id: true,
  revision: true,
  isLocked: true,
  dataJson: true,
  templateSnapshotJson: true,
  technicianSignatureUrl: true,
  technicianName: true,
  customerSignatureUrl: true,
  customerName: true,
  units: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      label: true,
      serialNumber: true,
      location: true,
      status: true,
      answersJson: true,
      comment: true,
      productId: true,
      sortOrder: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ReportSelect;

type RevisionSource = Prisma.ReportGetPayload<{ select: typeof REVISION_SOURCE_SELECT }>;

/**
 * Bygger en revisjonsrad av rapportens nåværende tilstand.
 *
 * Revisjonsnummeret er rapportens nummer *før* endringen. Selve
 * `Report.revision` økes i samme transaksjon, så en revisjon alltid kan knyttes
 * til den tilstanden den ble laget fra.
 */
function revisionSnapshot(
  current: RevisionSource,
  reason: string,
  createdById: string,
) {
  return {
    reportId: current.id,
    revision: current.revision,
    dataJson: current.dataJson,
    unitsJson: JSON.stringify(current.units ?? []),
    templateSnapshotJson: current.templateSnapshotJson,
    technicianSignatureUrl: current.technicianSignatureUrl,
    technicianName: current.technicianName,
    customerSignatureUrl: current.customerSignatureUrl,
    customerName: current.customerName,
    reason,
    createdById,
  };
}

type TemplateField = {
  id: string;
  type: string;
  label?: string;
  required?: boolean;
  options?: string[];
  /** For tilstandsfelt: valgene som krever kommentar. */
  commentOptions?: string[];
};

type UnitPayload = {
  key: string;
  productId?: string;
  label?: string;
  serialNumber?: string;
  location?: string;
};

/** Sikkerhetsnett: en rapport skal ikke kunne inneholde uendelig mange enheter. */
const MAX_UNITS = 50;

function parseUnits(raw: unknown): UnitPayload[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (unit): unit is UnitPayload =>
          !!unit && typeof unit === "object" && typeof (unit as UnitPayload).key === "string",
      )
      .slice(0, MAX_UNITS);
  } catch {
    return [];
  }
}

function parseFields(fieldsJson: string | null | undefined): TemplateField[] {
  try {
    const parsed = JSON.parse(fieldsJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Leser sjekkpunktene for én enhet ut fra feltnavnene i skjemaet. */
function readAnswers(formData: FormData, fields: TemplateField[], key: string) {
  const answers: Record<string, string | boolean> = {};

  for (const field of fields) {
    const raw = formData.get(`answer__${key}__${field.id}`);

    if (field.type === "CHECKBOX") {
      answers[field.id] = raw !== null;
    } else if (field.type === "IMAGE") {
      // Bare bilder som er lastet opp i denne appen godtas, uansett hva det
      // skjulte feltet måtte inneholde.
      const urls = parseImageUrls(typeof raw === "string" ? raw : "").filter((url) =>
        url.startsWith("/uploads/"),
      );
      answers[field.id] = JSON.stringify(urls);
    } else if (field.type === "TEXTAREA") {
      answers[field.id] = cleanMarkdown(typeof raw === "string" ? raw : "");
    } else if (typeof raw === "string") {
      answers[field.id] = cleanText(raw, { maxLength: LIMITS.text });
    } else {
      answers[field.id] = "";
    }

    // Tilstandsfelt: kommentaren til linjen lagres sammen med svaret, slik at
    // rapporten viser "Utbedres – kommentar" på samme linje.
    const lineComment = formData.get(`linecomment__${key}__${field.id}`);
    answers[lineCommentKey(field.id)] =
      typeof lineComment === "string" ? cleanMarkdown(lineComment) : "";
  }

  return answers;
}

/**
 * Fjerner bilde-URL-er som ikke tilhører dette oppdraget (eller er en privat
 * opplasting fra samme bruker). Uten dette kan en klient legge inn en
 * `/uploads/...`-adresse fra en annen kunde i et bildefelt, og få filen vist i
 * rapporten og PDF-en.
 */
async function filterOwnedImageAnswers(
  unitRows: Array<{ answersJson: string }>,
  ctx: {
    ownerId: string;
    departmentId: string;
    customerId: string | null;
    uploadedById: string;
  },
): Promise<void> {
  const names = new Set<string>();
  for (const row of unitRows) {
    try {
      const answers = JSON.parse(row.answersJson) as Record<string, unknown>;
      for (const value of Object.values(answers)) {
        if (typeof value !== "string") continue;
        for (const url of parseImageUrls(value)) {
          if (url.startsWith("/uploads/")) {
            names.add(url.slice("/uploads/".length));
          }
        }
      }
    } catch {}
  }
  if (names.size === 0) return;

  const uploads = await prisma.upload.findMany({
    where: { storedName: { in: [...names] } },
    select: { storedName: true, ownerType: true, ownerId: true, uploadedById: true },
  });
  const byName = new Map(uploads.map((upload) => [upload.storedName, upload]));

  const allowed = new Set<string>();
  for (const name of names) {
    const upload = byName.get(name);
    if (!upload) continue;

    if (upload.ownerType === "WORK_ORDER" && upload.ownerId === ctx.ownerId) {
      allowed.add(`/uploads/${name}`);
      continue;
    }
    if (upload.ownerType === "USER" && upload.uploadedById === ctx.uploadedById) {
      await prisma.upload.update({
        where: { storedName: name },
        data: {
          ownerType: "WORK_ORDER",
          ownerId: ctx.ownerId,
          departmentId: ctx.departmentId,
          customerId: ctx.customerId,
        },
      });
      allowed.add(`/uploads/${name}`);
    }
  }

  for (const row of unitRows) {
    try {
      const answers = JSON.parse(row.answersJson) as Record<string, unknown>;
      let changed = false;
      for (const [key, value] of Object.entries(answers)) {
        if (typeof value !== "string") continue;
        const urls = parseImageUrls(value);
        if (urls.length === 0) continue;
        const filtered = urls.filter((url) => allowed.has(url));
        if (filtered.length !== urls.length) {
          answers[key] = JSON.stringify(filtered);
          changed = true;
        }
      }
      if (changed) row.answersJson = JSON.stringify(answers);
    } catch {}
  }
}

/**
 * Finner enheten rapporten skal lenkes til. Er den ikke registrert på kunden
 * fra før, opprettes den – da dukker den opp på kundekortet og kan gjenbrukes
 * på neste service.
 */
async function resolveProductId(
  customerId: string | null,
  unit: { productId: string; label: string; serialNumber: string; location: string },
): Promise<string | null> {
  if (!customerId) return null;

  if (unit.productId) {
    const chosen = await prisma.product.findUnique({ where: { id: unit.productId } });
    if (chosen && chosen.customerId === customerId) return chosen.id;
  }

  const label = unit.label.trim();
  if (!label) return null;

  const serialNumber = unit.serialNumber.trim() || null;

  // Gjenbruk hvis enheten allerede står på kunden, så vi ikke får duplikater.
  const match = await prisma.product.findFirst({
    where: serialNumber
      ? { customerId, serialNumber }
      : { customerId, model: label, serialNumber: null },
  });
  if (match) return match.id;

  const created = await prisma.product.create({
    data: {
      customerId,
      model: label,
      serialNumber,
      location: unit.location.trim() || null,
    },
  });
  return created.id;
}

/**
 * Hvor skal brukeren sendes etter at rapporten er lagret? Skjemaet kan åpnes fra
 * feltportalen eller fra kontorets oppdragsside, og bare de to godtas – da kan
 * ikke feltet misbrukes til å viderekoble til noe annet.
 */
function returnPathFrom(formData: FormData, workOrderId: string): string {
  const raw = typeof formData.get("returnTo") === "string"
    ? (formData.get("returnTo") as string)
    : "";
  return [`/oppdrag/${workOrderId}`, `/mine-oppdrag/${workOrderId}`].includes(raw)
    ? raw
    : `/mine-oppdrag/${workOrderId}`;
}

export type DraftResult =
  | { ok: true; savedAt: string }
  | { ok: false };

/**
 * Lagrer en kladd av sjekklisten. Kalles automatisk fra skjemaet mens det
 * fylles ut, slik at ingenting går tapt hvis nettet eller appen faller ut.
 * Kladden er per bruker, oppdrag og mal.
 */
export async function saveDraft(
  user: Actor,
  formData: FormData,
): Promise<DraftResult> {
  if (!user) return { ok: false };
  if (!hasPermission(user, "reports.write")) return { ok: false };

  // Valider form og lengder før vi slår opp i databasen. Grensene er de samme
  // som for innsending, slik at en kladd ikke kan bli større enn en rapport.
  const parsedInput = reportDraftSchema.safeParse({
    workOrderId: cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
    templateId: cleanText(formData.get("templateId"), { maxLength: LIMITS.line }),
    unitsJson:
      typeof formData.get("unitsJson") === "string"
        ? (formData.get("unitsJson") as string)
        : undefined,
    notes: cleanMarkdown(formData.get("notes")),
    technicianName:
      cleanText(formData.get("technicianName"), { maxLength: LIMITS.title }) || undefined,
    customerName:
      cleanText(formData.get("customerName"), { maxLength: LIMITS.title }) || undefined,
    technicianSignature: acceptedSignature(formData.get("technicianSignature")) || undefined,
    customerSignature: acceptedSignature(formData.get("customerSignature")) || undefined,
  });
  if (!parsedInput.success) return { ok: false };
  const { workOrderId, templateId } = parsedInput.data;

  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      ...workOrderScope(user),
      templates: { some: { id: templateId } },
    },
    include: { templates: { where: { id: templateId } } },
  });
  if (!workOrder) return { ok: false };
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return { ok: false };
  }

  const template = workOrder.templates[0];
  if (!template) return { ok: false };

  // Ikke lagre kladd over en rapport som allerede er låst. Hent samtidig den
  // forrige kladden, slik at signaturfiler som erstattes kan ryddes bort.
  const [existingReport, previousDraft] = await Promise.all([
    prisma.report.findUnique({
      where: { workOrderId_templateId: { workOrderId, templateId } },
      select: { isLocked: true },
    }),
    prisma.reportDraft.findUnique({
      where: {
        workOrderId_templateId_userId: { workOrderId, templateId, userId: user.id },
      },
      select: { dataJson: true },
    }),
  ]);
  if (existingReport?.isLocked) return { ok: false };

  const fields = parseFields(template.fieldsJson);

  const units = parseUnits(parsedInput.data.unitsJson).map((unit) => ({
    productId: unit.productId || "",
    label: cleanText(unit.label, { maxLength: LIMITS.title }),
    serialNumber: cleanText(unit.serialNumber, { maxLength: LIMITS.line }),
    location: cleanText(unit.location, { maxLength: LIMITS.line }),
    status: formData.get(`status__${unit.key}`) === "AVVIK" ? "AVVIK" : "GODKJENT",
    comment: cleanMarkdown(formData.get(`comment__${unit.key}`)),
    answers: readAnswers(formData, fields, unit.key),
  }));

  // Signaturer skrives som filer, ikke base64 i kladden. `created` holder rede
  // på nye filer slik at de kan slettes hvis kladden likevel blir for stor.
  const createdSignatures: string[] = [];
  let technicianSignatureUrl: string | null;
  let customerSignatureUrl: string | null;
  try {
    technicianSignatureUrl = await resolveDraftSignature(
      parsedInput.data.technicianSignature,
      user,
      createdSignatures,
    );
    customerSignatureUrl = await resolveDraftSignature(
      parsedInput.data.customerSignature,
      user,
      createdSignatures,
    );
  } catch (error) {
    console.error("Kunne ikke lagre kladdesignatur:", error);
    await releaseDraftSignatures(createdSignatures, user);
    return { ok: false };
  }

  const payload = {
    notes: parsedInput.data.notes ?? "",
    technicianSignatureUrl,
    technicianName: parsedInput.data.technicianName ?? null,
    customerSignatureUrl,
    customerName: parsedInput.data.customerName ?? null,
    units,
  };

  // Kladden lagres som JSON i databasen. Over én million tegn ville gjort
  // listespørringer og sikkerhetskopier unødvendig tunge.
  const dataJson = JSON.stringify(payload);
  if (Buffer.byteLength(dataJson, "utf8") > MAX_DRAFT_JSON_LENGTH) {
    await releaseDraftSignatures(createdSignatures, user);
    return { ok: false };
  }

  try {
    await prisma.reportDraft.upsert({
      where: {
        workOrderId_templateId_userId: {
          workOrderId,
          templateId,
          userId: user.id,
        },
      },
      create: {
        workOrderId,
        templateId,
        userId: user.id,
        dataJson,
        updatedByName: user.name || user.email || null,
      },
      update: {
        dataJson,
        updatedByName: user.name || user.email || null,
      },
    });
  } catch (error) {
    // Kladden ble ikke lagret – da skal de nye signaturfilene ikke bli liggende.
    await releaseDraftSignatures(createdSignatures, user);
    throw error;
  }

  // Nye filer som ikke endte i den lagrede kladden (for eksempel ved en
  // samtidig lagring) skal ikke bli liggende som søppel.
  const referenced = new Set([technicianSignatureUrl, customerSignatureUrl]);
  for (const url of createdSignatures) {
    if (!referenced.has(url)) await releaseDraftSignatures([url], user);
  }

  // Erstattede signaturfiler ryddes først når den nye kladden er lagret. Er
  // filen allerede tatt over av en signert rapport, lar hjelperen den være.
  const previousSignatures = draftSignatureUrls(previousDraft?.dataJson);
  for (const [previous, current] of [
    [previousSignatures.technician, technicianSignatureUrl],
    [previousSignatures.customer, customerSignatureUrl],
  ] as const) {
    if (previous && previous !== current) {
      await releaseDraftSignatures([previous], user);
    }
  }

  return { ok: true, savedAt: new Date().toISOString() };
}

/** Sletter signaturfiler som fortsatt bare eies av brukeren (kladdesignaturer). */
async function releaseDraftSignatures(
  urls: string[],
  user: AccessUser,
): Promise<void> {
  for (const url of urls) {
    await deleteUploadIfOwned(url, { ownerType: "USER", ownerId: user.id });
  }
}

export type SubmitReportError =
  | "ikke-autentisert"
  | "ikke-tilgang"
  | "ugyldig-data"
  | "ikke-funnet"
  | "kansellert"
  | "locked"
  | "signatur";

export type SubmitReportResult =
  | { ok: true; returnTo: string }
  | { ok: false; error: SubmitReportError; returnTo?: string };

/**
 * Signerer og låser rapporten. En eksisterende, låst rapport kan ikke endres
 * før en administrator har låst den opp. Skriving, sletting av kladd og
 * revisjonslogg skjer i samme transaksjon.
 */
export async function submitReport(
  user: Actor,
  formData: FormData,
): Promise<SubmitReportResult> {
  if (!user) return { ok: false, error: "ikke-autentisert" };
  // Rapportinnsending krever reports.write og tilgang til oppdragets avdeling.
  if (!hasPermission(user, "reports.write")) {
    return { ok: false, error: "ikke-tilgang" };
  }

  const parsedInput = reportSubmitSchema.safeParse({
    workOrderId: cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
    templateId: cleanText(formData.get("templateId"), { maxLength: LIMITS.line }),
    unitsJson:
      typeof formData.get("unitsJson") === "string"
        ? (formData.get("unitsJson") as string)
        : undefined,
    notes: cleanMarkdown(formData.get("notes")),
    returnTo:
      typeof formData.get("returnTo") === "string"
        ? (formData.get("returnTo") as string)
        : undefined,
  });
  if (!parsedInput.success) return { ok: false, error: "ugyldig-data" };
  const { workOrderId, templateId } = parsedInput.data;

  // Malen må faktisk være knyttet til oppdraget, og oppdraget må være innenfor
  // brukerens avdeling. Da kan ikke en fremmed mal brukes på et oppdrag.
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      ...workOrderScope(user),
      templates: { some: { id: templateId } },
    },
    include: { templates: { where: { id: templateId } } },
  });
  if (!workOrder) return { ok: false, error: "ikke-funnet" };
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return { ok: false, error: "kansellert" };
  }

  const template = workOrder.templates[0];
  if (!template) return { ok: false, error: "ikke-funnet" };
  const fields = parseFields(template.fieldsJson);

  // Én rapport per sjekkliste per oppdrag. Er den allerede fylt ut og låst, kan
  // den ikke endres før en administrator har låst den opp.
  const existing = await prisma.report.findUnique({
    where: { workOrderId_templateId: { workOrderId, templateId } },
    select: {
      id: true,
      isLocked: true,
      technicianSignatureUrl: true,
      technicianName: true,
      customerSignatureUrl: true,
      customerName: true,
    },
  });

  if (existing?.isLocked) {
    return {
      ok: false,
      error: "locked",
      returnTo: returnPathFrom(formData, workOrderId),
    };
  }

  const unitStatus: string[] = [];
  const unitRows: Array<{
    productId: string | null;
    label: string;
    serialNumber: string | null;
    location: string | null;
    status: string;
    answersJson: string;
    comment: string | null;
    sortOrder: number;
  }> = [];

  for (const [index, unit] of parseUnits(formData.get("unitsJson")).entries()) {
    const label = cleanText(unit.label, { maxLength: LIMITS.title });
    if (!label) continue; // hopper over tomme rader

    const status = formData.get(`status__${unit.key}`) === "AVVIK" ? "AVVIK" : "GODKJENT";
    unitStatus.push(status);

    const serialNumber = cleanText(unit.serialNumber, { maxLength: LIMITS.line }) || null;
    const location = cleanText(unit.location, { maxLength: LIMITS.line }) || null;

    unitRows.push({
      productId: await resolveProductId(workOrder.customerId, {
        productId: unit.productId || "",
        label,
        serialNumber: serialNumber ?? "",
        location: location ?? "",
      }),
      label,
      serialNumber,
      location,
      status,
      answersJson: JSON.stringify(readAnswers(formData, fields, unit.key)),
      comment: cleanMarkdown(formData.get(`comment__${unit.key}`)) || null,
      sortOrder: index,
    });
  }

  // Bildefeltene kan inneholde URL-er fra andre oppdrag/kunder. Fjern dem før
  // rapporten lagres, slik at PDF-en ikke lekker filer brukeren ikke eier.
  await filterOwnedImageAnswers(unitRows, {
    ownerId: workOrderId,
    departmentId: workOrder.departmentId,
    customerId: workOrder.customerId,
    uploadedById: user.id,
  });

  // En signert rapport er et juridisk dokument. HTML `required` i skjemaet er
  // bare en hjelp for nettleseren; serveren må avvise manglende påkrevde
  // sjekkpunkter og rapporter uten enheter. Ellers kunne en klient sende inn
  // en «godkjent» rapport med hull i dokumentasjonen.
  if (unitRows.length === 0) {
    return { ok: false, error: "ugyldig-data", returnTo: returnPathFrom(formData, workOrderId) };
  }

  const hasMissingRequired = unitRows.some((row) => {
    let answers: Record<string, unknown>;
    try {
      answers = JSON.parse(row.answersJson) as Record<string, unknown>;
    } catch {
      return true;
    }

    return fields.some((field) => {
      if (!field.required) return false;
      const value = answers[field.id];

      if (field.type === "CHECKBOX") return value !== true;
      if (field.type === "IMAGE") {
        return parseImageUrls(typeof value === "string" ? value : "").length === 0;
      }
      return typeof value !== "string" || value.trim().length === 0;
    });
  });

  if (hasMissingRequired) {
    return { ok: false, error: "ugyldig-data", returnTo: returnPathFrom(formData, workOrderId) };
  }

  const text = (name: string) =>
    cleanText(formData.get(name), { maxLength: LIMITS.title }) || null;

  // Rapporten er "godkjent" bare når ingen av enhetene har avvik.
  const overallStatus = unitStatus.includes("AVVIK") ? "AVVIK" : "GODKJENT";

  const now = new Date();

  const signatureContext = {
    ownerType: "WORK_ORDER" as const,
    ownerId: workOrderId,
    departmentId: workOrder.departmentId,
    customerId: workOrder.customerId,
    uploadedById: user.id,
  };

  const previousTechnicianSignature = existing?.technicianSignatureUrl ?? null;
  const previousCustomerSignature = existing?.customerSignatureUrl ?? null;

  // Rapporten låses automatisk når den lagres. Nye bilder fra tidligere
  // signaturer beholdes hvis man ikke signerer på nytt ved en gjenopplåst
  // redigering.
  let technicianSignatureUrl: string | null;
  let customerSignatureUrl: string | null;
  try {
    technicianSignatureUrl = await resolveSignature(
      formData.get("technicianSignature"),
      previousTechnicianSignature,
      signatureContext,
    );
    customerSignatureUrl = await resolveSignature(
      formData.get("customerSignature"),
      previousCustomerSignature,
      signatureContext,
    );
  } catch (error) {
    console.error("Kunne ikke lagre signatur:", error);
    return {
      ok: false,
      error: "signatur",
      returnTo: returnPathFrom(formData, workOrderId),
    };
  }

  const data = {
    comments: cleanMarkdown(formData.get("notes")),
    dataJson: JSON.stringify({
      status: overallStatus,
      answers: {},
      unitCount: unitRows.length,
    }),
    technicianSignatureUrl,
    technicianName: text("technicianName") ?? existing?.technicianName ?? null,
    customerSignatureUrl,
    customerName: text("customerName") ?? existing?.customerName ?? null,
    // Frys malen slik den var da rapporten ble signert.
    templateTitle: template.title,
    templateSnapshotJson: template.fieldsJson,
    isLocked: true,
    lockedAt: now,
    lockedByName: user.name || user.email,
  };

  const actionText =
    `${existing ? "Rapport oppdatert" : `${isOffice(user.role) ? "Kontoret" : "Montør"} fylte ut skjema`}: ${template.title}` +
    ` (${unitRows.length} ${unitRows.length === 1 ? "enhet" : "enheter"}, ${overallStatus === "AVVIK" ? "avvik" : "godkjent"})` +
    " – rapporten låses automatisk";

  const signatureOwner = { ownerType: "WORK_ORDER" as const, ownerId: workOrderId };
  const returnTo = returnPathFrom(formData, workOrderId);

  // Signaturbildene skrives før transaksjonen. Blir rapporten avvist (låst
  // eller duplikat), skal de nye filene ikke bli liggende som søppel.
  const cleanupNewSignatures = async () => {
    if (technicianSignatureUrl !== previousTechnicianSignature) {
      await deleteUploadIfOwned(technicianSignatureUrl, signatureOwner);
    }
    if (customerSignatureUrl !== previousCustomerSignature) {
      await deleteUploadIfOwned(customerSignatureUrl, signatureOwner);
    }
  };

  // Skrivingen gjøres i én transaksjon med en ny låsesjekk, slik at to
  // samtidige innsendinger ikke kan overskrive en signert rapport.
  let locked = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.report.findUnique({
        where: { workOrderId_templateId: { workOrderId, templateId } },
        select: REVISION_SOURCE_SELECT,
      });
      if (current?.isLocked) return { locked: true } as const;

      let reportId: string;
      if (current) {
        // Krev at rapporten fortsatt er ulåst i selve UPDATE-en. To samtidige
        // innsendinger kan ellers begge lese isLocked=false og overskrive
        // hverandre; den som taper, får count=0 og behandles som låst.
        const claimed = await tx.report.updateMany({
          where: { id: current.id, isLocked: false },
          data: {
            isLocked: true,
            lockedAt: now,
            lockedByName: user.name || user.email,
          },
        });
        if (claimed.count === 0) return { locked: true } as const;

        // Før vi overskriver rapporten, fryses den forrige tilstanden som en
        // revisjon. Revisjonsnummeret er nummeret rapporten hadde før denne
        // innsendingen; `Report.revision` økes i samme update under.
        await tx.reportRevision.create({
          data: revisionSnapshot(current, "Ny innsending", user.id),
        });

        await tx.report.update({
          where: { id: current.id },
          data: {
            ...data,
            revision: { increment: 1 },
            // Enhetene erstattes helt, slik at rapporten speiler det som ble sendt inn.
            units: { deleteMany: {}, create: unitRows },
          },
        });
        reportId = current.id;
      } else {
        const created = await tx.report.create({
          data: {
            workOrderId,
            templateId,
            ...data,
            units: { create: unitRows },
          },
          select: { id: true },
        });
        reportId = created.id;
      }

      // Kladden er ikke lenger nødvendig når rapporten er lagret.
      await tx.reportDraft.deleteMany({
        where: { workOrderId, templateId, userId: user.id },
      });

      // Rapporten hører til oppdraget, så hendelsen følger oppdragets id.
      // Selve rapport-id-en ligger i metadata og er alltid en ekte rad-id.
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: actionText,
        actor: { id: user.id, name: user.name, email: user.email },
        metadata: { reportId, templateId },
      });

      return { locked: false } as const;
    });
    locked = result.locked;
  } catch (error) {
    await cleanupNewSignatures();
    // Samtidig innsending: den unike indeksen avviser duplikatet.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "locked", returnTo };
    }
    throw error;
  }

  if (locked) {
    await cleanupNewSignatures();
    return { ok: false, error: "locked", returnTo };
  }

  // Nye signaturer erstatter de gamle i rapporten, men de forrige filene
  // slettes bevisst ikke. Revisjonshistorikken peker fortsatt på dem, og en
  // opplåst rapport skal kunne vises slik den ble signert den gangen.

  try {
    await notifyWorkOrderEvent(
      workOrderId,
      "REPORT_READY",
      "Rapport klar",
      "En signert rapport er klar.",
      `/mine-oppdrag/${workOrderId}`,
      `report-ready:${workOrderId}:${templateId}`,
    );
  } catch {
    // Varsling er best effort; rapporten er allerede lagret.
  }

  return { ok: true, returnTo };
}

export type ReportLockResult =
  | { ok: true }
  | { ok: false; error: "ikke-tilgang" | "ugyldig-data" | "ikke-funnet" };

/**
 * Låser eller låser opp en signert rapport. Bare administrator kan låse opp
 * igjen; opplåsingen krever en årsak og logges med en revisjon, slik at
 * rettinger er sporbare.
 */
export async function setReportLock(
  user: Actor,
  workOrderId: string,
  rawReportId: unknown,
  rawLock: unknown,
  rawReason?: unknown,
): Promise<ReportLockResult> {
  // Bare administratorer kan låse opp en signert rapport igjen.
  if (!user?.isActive || user.role !== "ADMIN") {
    return { ok: false, error: "ikke-tilgang" };
  }

  const reason = cleanText(rawReason, { maxLength: 1000 });

  const parsed = reportUnlockSchema.safeParse({
    reportId: cleanText(rawReportId, { maxLength: LIMITS.line }),
    lock: rawLock,
    reason: reason || undefined,
  });
  if (!parsed.success) return { ok: false, error: "ugyldig-data" };
  const { reportId, lock: shouldLock } = parsed.data;

  // Opplåsing er en bevisst handling som skal kunne forklares i ettertid.
  if (!shouldLock && !reason) return { ok: false, error: "ugyldig-data" };

  const lockedUntil = new Date();
  let found = false;

  await prisma.$transaction(async (tx) => {
    const current = await tx.report.findFirst({
      where: { id: reportId, workOrderId, deletedAt: null },
      select: REVISION_SOURCE_SELECT,
    });
    if (!current) return;
    found = true;

    if (shouldLock) {
      await tx.report.update({
        where: { id: reportId },
        data: { isLocked: true, lockedAt: lockedUntil, lockedByName: user.name || user.email },
      });
    } else {
      // Fryse tilstanden før den låses opp, slik at den signerte versjonen
      // fortsatt kan dokumenteres etter rettingen.
      await tx.reportRevision.create({
        data: revisionSnapshot(current, reason, user.id),
      });
      await tx.report.update({
        where: { id: reportId },
        data: {
          isLocked: false,
          lockedAt: null,
          lockedByName: null,
          revision: { increment: 1 },
        },
      });
    }

    // Rapporten hører til oppdraget, så hendelsen følger oppdragets id.
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: shouldLock
        ? "Låste rapporten igjen"
        : "Låste opp rapporten slik at den kan rettes (sporbarhet: endringer logges)",
      actor: { id: user.id, name: user.name, email: user.email },
      metadata: shouldLock ? { reportId } : { reportId, reason },
    });
  });

  return found ? { ok: true } : { ok: false, error: "ikke-funnet" };
}

export type ReportPdfResult =
  | { ok: true; buffer: Buffer; fileName: string }
  | { ok: false; status: 403 | 404; message: string };

/**
 * Slår opp og eventuelt rendrer PDF-en for et oppdrag.
 *
 * Tilgangskontrollen ligger her, ikke bare i ruten: kundeportalbrukere ser
 * bare egne oppdrag, montører ser ikke kansellerte oppdrag, og andre må ha
 * `reports.view`. Meldingene er de samme som ruten har brukt.
 */
export async function getReportPdfForViewer(
  viewer: Actor,
  workOrderId: string,
): Promise<ReportPdfResult> {
  if (!viewer?.isActive) {
    return { ok: false, status: 403, message: "Ingen tilgang" };
  }

  if (viewer.role !== "CUSTOMER" && !hasPermission(viewer, "reports.view")) {
    return { ok: false, status: 403, message: "Ingen tilgang" };
  }

  // Mykt slettede oppdrag og rapporter er ikke lenger lesbare. Kunde ser egen
  // kunde, ansatte ser egen avdeling (canAccessWorkOrder under).
  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, deletedAt: null },
    select: {
      customerId: true,
      departmentId: true,
      status: true,
      reports: { where: { deletedAt: null }, select: { id: true } },
    },
  });

  if (!workOrder) {
    return { ok: false, status: 404, message: "Fant ikke oppdraget" };
  }

  // Kundeportalbrukere ser bare egen kunde, og ansatte bare egen avdeling.
  // En kunde uten kundetilknytning må aldri matche et oppdrag uten kunde.
  if (!canAccessWorkOrder(viewer, workOrder)) {
    return { ok: false, status: 403, message: "Ingen tilgang" };
  }
  if (viewer.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return { ok: false, status: 403, message: "Ingen tilgang" };
  }

  if (workOrder.reports.length === 0) {
    return { ok: false, status: 404, message: "Oppdraget har ingen rapport ennå" };
  }

  // Bilder ligger som /uploads/... og må gjøres absolutte for PDF-motoren.
  // Bare konfigurert adresse brukes – aldri Host/X-Forwarded-Host, som en
  // klient kan sette for å styre PDF-motoren mot en annen origin.
  const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL;

  const pdf = await (
    await import("@/lib/report-pdf-store")
  ).getOrRenderReportPdf(workOrderId, baseUrl);
  if (!pdf) {
    return { ok: false, status: 404, message: "Oppdraget har ingen rapport ennå" };
  }

  return { ok: true, buffer: pdf.buffer, fileName: pdf.fileName };
}
