// i18n-ignore-file: revisjonsloggen lagrer stabile, ferdig formaterte norske
// handlingsstrenger. De oversettes ved visning i `src/lib/audit-actions.ts`.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyWorkOrderEvent } from "./notifications";
import { hasPermission } from "@/lib/permissions";
import { isOffice } from "@/lib/session";
import { workOrderScope, type AccessUser } from "@/lib/access";
import {
  REPORT_STATUS_APPROVED,
  REPORT_STATUS_DEVIATION,
  REPORT_STATUS_WITHOUT_UNITS,
  isLineCommentKey,
  lineCommentKey,
  parseImageUrls,
} from "@/lib/report-answers";
import { LIMITS, cleanDataImage, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { reportDraftSchema, reportSubmitSchema, reportUnlockSchema } from "@/lib/schemas/report";
import { deleteUploadIfOwned, storeDataImage } from "@/lib/upload-store";
import { generateReportNumber } from "@/lib/report-number";
import { isTemplateFieldVisible } from "@/lib/template-visibility";

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
  lockedAt: true,
  lockedByName: true,
  templateId: true,
  pdfHash: true,
  legalHold: true,
  dataJson: true,
  comments: true,
  templateTitle: true,
  name: true,
  reportNumber: true,
  requiresUnits: true,
  templateCategory: true,
  hmsType: true,
  completedAt: true,
  templateSnapshotJson: true,
  technicianSignatureUrl: true,
  technicianName: true,
  customerSignatureUrl: true,
  customerName: true,
  customerAcknowledgedAt: true,
  customerAcknowledgedBy: true,
  customerAcknowledgedComment: true,
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
 *
 * Skjemaet har egne kolonner for navn, enhetskrav og kvittering. Mal-id,
 * låsemetadata og PDF-hash har ingen egne kolonner; de legges derfor i
 * `dataJson` under `_revisionMeta`. Da bevares de uten en migrering, og
 * eksisterende lesere som bare ser etter `status`/`answers` er upåvirket.
 */
/**
 * Finner et ledig rapportnummer. Unik indeks er den endelige garantien; denne
 * kontrollen gjør kollisjoner praktisk talt fraværende og lar oss prøve på nytt
 * uten å avbryte hele rapporttransaksjonen.
 */
async function allocateReportNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = generateReportNumber();
    const used = await tx.report.count({
      where: { reportNumber: candidate },
    });
    if (!used) return candidate;
  }
  throw new Error("Kunne ikke generere et unikt rapportnummer");
}

function revisionDataJson(current: RevisionSource): string {
  let base: Record<string, unknown>;
  try {
    const parsed = JSON.parse(current.dataJson) as unknown;
    base =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { raw: current.dataJson };
  } catch {
    base = { raw: current.dataJson };
  }

  return JSON.stringify({
    ...base,
    _revisionMeta: {
      templateId: current.templateId,
      isLocked: current.isLocked,
      lockedAt: current.lockedAt?.toISOString() ?? null,
      lockedByName: current.lockedByName,
      pdfHash: current.pdfHash,
    },
  });
}

function revisionSnapshot(
  current: RevisionSource,
  reason: string,
  createdById: string,
) {
  return {
    reportId: current.id,
    revision: current.revision,
    dataJson: revisionDataJson(current),
    unitsJson: JSON.stringify(current.units ?? []),
    comments: current.comments,
    templateTitle: current.templateTitle,
    name: current.name,
    reportNumber: current.reportNumber ?? null,
    requiresUnits: current.requiresUnits,
    // Kategorien og HMS-typen fryses sammen med resten av rapporten. Eldre
    // rader uten verdi behandles som en vanlig servicesjekkliste.
    templateCategory: current.templateCategory ?? "SERVICE",
    hmsType: current.hmsType ?? null,
    completedAt: current.completedAt,
    templateSnapshotJson: current.templateSnapshotJson,
    technicianSignatureUrl: current.technicianSignatureUrl,
    technicianName: current.technicianName,
    customerSignatureUrl: current.customerSignatureUrl,
    customerName: current.customerName,
    customerAcknowledgedAt: current.customerAcknowledgedAt,
    customerAcknowledgedBy: current.customerAcknowledgedBy,
    customerAcknowledgedComment: current.customerAcknowledgedComment,
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
  /** Betinget visning, samme regel som i skjemaet. */
  conditionalFieldId?: string;
  conditionalValue?: string;
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

type RemediationUnit = {
  label: string;
  serialNumber: string | null;
  location: string | null;
  status: string;
  answersJson: string;
  comment: string | null;
};

/** Lesbart svar for ett sjekkpunkt, brukt i utbedringsoppdragets beskrivelse. */
function readableAnswer(field: TemplateField, value: unknown): string {
  if (value === true) return "Ja";
  if (value === false) return "Nei";
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (field.type === "IMAGE") {
    try {
      const urls = JSON.parse(trimmed) as unknown;
      if (Array.isArray(urls) && urls.length > 0) {
        return `${urls.length} bilde${urls.length === 1 ? "" : "r"}`;
      }
    } catch {}
    return trimmed.startsWith("[") ? "Bilde" : "Bilde vedlagt";
  }

  return trimmed;
}

/**
 * Lager tittel og beskrivelse til det automatiske utbedringsoppdraget.
 *
 * Teksten skal være lesbar for montøren som skal rette avvikene: hvilke
 * enheter som har avvik, hva som er registrert på hvert sjekkpunkt, og hvilke
 * kommentarer som hører til. Alle avvik fra rapporten tas med, ikke bare det
 * første.
 */
function remediationOrderSummary(input: {
  reportId: string;
  reportName: string;
  workOrderTitle: string;
  notes: string;
  units: RemediationUnit[];
  fields: TemplateField[];
}): { title: string; description: string } {
  const title = cleanText(`Utbedring av avvik – ${input.reportName}`, {
    maxLength: LIMITS.title,
  });

  const lines: string[] = [
    `Automatisk opprettet utbedringsoppdrag for rapporten «${input.reportName}» (rapport-ID: ${input.reportId}).`,
    `Kildeoppdrag: ${input.workOrderTitle}.`,
    "",
    `Avvik som må utbedres (${input.units.length}):`,
  ];

  input.units.forEach((unit, index) => {
    const name = unit.label || "Rapporten (uten enhet)";
    const details = [
      unit.serialNumber ? `serienr. ${unit.serialNumber}` : "",
      unit.location ? `sted: ${unit.location}` : "",
    ].filter(Boolean);

    lines.push(
      `${index + 1}. ${name}${details.length > 0 ? ` (${details.join(", ")})` : ""}`,
    );

    if (unit.comment) lines.push(`   Kommentar: ${unit.comment}`);

    let answers: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(unit.answersJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        answers = parsed as Record<string, unknown>;
      }
    } catch {}

    const fieldIds = new Set(input.fields.map((field) => field.id));
    for (const field of input.fields) {
      const value = readableAnswer(field, answers[field.id]);
      const lineComment = answers[lineCommentKey(field.id)];
      const comment = typeof lineComment === "string" ? lineComment.trim() : "";
      if (!value && !comment) continue;

      const label = field.label || field.id;
      lines.push(
        `   – ${label}: ${value || "(ingen verdi)"}${comment ? ` — ${comment}` : ""}`,
      );
    }

    // Svar som ikke finnes i malen lenger skal likevel ikke forsvinne fra
    // oppsummeringen, så lenge de ikke er selve linjekommentaren.
    for (const [key, value] of Object.entries(answers)) {
      if (fieldIds.has(key) || isLineCommentKey(key)) continue;
      const text =
        typeof value === "string"
          ? value.trim()
          : value === true
            ? "Ja"
            : value === false
              ? "Nei"
              : "";
      if (text) lines.push(`   – ${key}: ${text}`);
    }
  });

  if (input.notes) {
    lines.push("", `Rapportnotat: ${input.notes}`);
  }

  return {
    title,
    description: cleanMarkdown(lines.join("\n")),
  };
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
  fields: TemplateField[],
  ctx: {
    ownerId: string;
    departmentId: string;
    customerId: string | null;
    uploadedById: string;
  },
): Promise<void> {
  // Bare faktiske bildefelt skal gjennom bilde-ACL. Tall, datoer, tekst og
  // andre svar er vanlige strenger og må aldri tolkes som URL-er – det var
  // årsaken til at gamle rapporter fikk «[]» i stedet for verdien.
  const imageFieldIds = new Set(
    fields.filter((field) => field.type === "IMAGE").map((field) => field.id),
  );
  if (imageFieldIds.size === 0) return;

  const names = new Set<string>();
  for (const row of unitRows) {
    try {
      const answers = JSON.parse(row.answersJson) as Record<string, unknown>;
      for (const [key, value] of Object.entries(answers)) {
        if (!imageFieldIds.has(key) || typeof value !== "string") continue;
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
        if (!imageFieldIds.has(key) || typeof value !== "string") continue;
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
  if (workOrder.legalHold) return { ok: false };
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
      select: { isLocked: true, legalHold: true },
    }),
    prisma.reportDraft.findUnique({
      where: {
        workOrderId_templateId_userId: { workOrderId, templateId, userId: user.id },
      },
      select: { dataJson: true },
    }),
  ]);
  if (existingReport?.isLocked || existingReport?.legalHold) return { ok: false };

  const fields = parseFields(template.fieldsJson);
  // Eldre maler (og testdata) kan mangle feltet; standarden er at enheter
  // kreves, som i databasen.
  const draftRequiresUnits = template.requiresUnits !== false;

  const units = parseUnits(parsedInput.data.unitsJson).map((unit) => ({
    productId: unit.productId || "",
    label: cleanText(unit.label, { maxLength: LIMITS.title }),
    serialNumber: cleanText(unit.serialNumber, { maxLength: LIMITS.line }),
    location: cleanText(unit.location, { maxLength: LIMITS.line }),
    status: draftRequiresUnits
      ? formData.get(`status__${unit.key}`) === REPORT_STATUS_DEVIATION
        ? REPORT_STATUS_DEVIATION
        : REPORT_STATUS_APPROVED
      : REPORT_STATUS_WITHOUT_UNITS,
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
  | "mangler-enhet"
  | "ikke-funnet"
  | "kansellert"
  | "locked"
  | "legal-hold"
  | "signatur";

export type SubmitReportResult =
  | { ok: true; returnTo: string; remediationWorkOrderId?: string }
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
  if (workOrder.legalHold) {
    return {
      ok: false,
      error: "legal-hold",
      returnTo: returnPathFrom(formData, workOrderId),
    };
  }
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return { ok: false, error: "kansellert" };
  }

  const template = workOrder.templates[0];
  if (!template) return { ok: false, error: "ikke-funnet" };
  const fields = parseFields(template.fieldsJson);
  // Eldre maler (og testdata) kan mangle feltet; standarden er at enheter
  // kreves, som i databasen.
  const templateRequiresUnits = template.requiresUnits !== false;

  // Én rapport per sjekkliste per oppdrag. Er den allerede fylt ut og låst, kan
  // den ikke endres før en administrator har låst den opp.
  const existing = await prisma.report.findUnique({
    where: { workOrderId_templateId: { workOrderId, templateId } },
    select: {
      id: true,
      isLocked: true,
      legalHold: true,
      technicianSignatureUrl: true,
      technicianName: true,
      customerSignatureUrl: true,
      customerName: true,
    },
  });

  if (existing?.legalHold || (existing && workOrder.legalHold)) {
    return {
      ok: false,
      error: "legal-hold",
      returnTo: returnPathFrom(formData, workOrderId),
    };
  }

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

  if (templateRequiresUnits) {
    for (const [index, unit] of parseUnits(formData.get("unitsJson")).entries()) {
      const label = cleanText(unit.label, { maxLength: LIMITS.title });
      if (!label) continue; // hopper over tomme rader

      const status =
        formData.get(`status__${unit.key}`) === REPORT_STATUS_DEVIATION
          ? REPORT_STATUS_DEVIATION
          : REPORT_STATUS_APPROVED;
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
  } else {
    // Malen bruker ikke enheter. Da godtas nøyaktig én anonym oppføring, og
    // eventuell produkt-/enhetsmetadata fra klienten ignoreres. Nøkkelen
    // brukes bare for å lese svarfeltene i skjemaet. Den anonyme raden får
    // en nøytral status: det finnes ingen enhet å godkjenne eller melde avvik på.
    const [anonymous] = parseUnits(formData.get("unitsJson"));
    const key = anonymous?.key || "report";
    unitRows.push({
      productId: null,
      label: "",
      serialNumber: null,
      location: null,
      status: REPORT_STATUS_WITHOUT_UNITS,
      answersJson: JSON.stringify(readAnswers(formData, fields, key)),
      comment: cleanMarkdown(formData.get(`comment__${key}`)) || null,
      sortOrder: 0,
    });
  }

  // Bildefeltene kan inneholde URL-er fra andre oppdrag/kunder. Fjern dem før
  // rapporten lagres, slik at PDF-en ikke lekker filer brukeren ikke eier.
  await filterOwnedImageAnswers(unitRows, fields, {
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
    return { ok: false, error: "mangler-enhet", returnTo: returnPathFrom(formData, workOrderId) };
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
      // Skjulte betingede felt er ikke en del av det montøren ser eller kan
      // fylle ut. Serveren bruker samme synlighetsregel som skjemaet.
      if (!isTemplateFieldVisible(field, answers)) return false;
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

  // Rapporten er "godkjent" bare når ingen av enhetene har avvik. Uten enheter
  // finnes det ingen godkjenning eller avvik å utlede – da lagres en nøytral
  // status som visningen kjenner igjen.
  const overallStatus = templateRequiresUnits
    ? unitStatus.includes(REPORT_STATUS_DEVIATION)
      ? REPORT_STATUS_DEVIATION
      : REPORT_STATUS_APPROVED
    : REPORT_STATUS_WITHOUT_UNITS;
  const notes = cleanMarkdown(formData.get("notes"));

  // Bare enheter kan ha avvik. En rapport uten enheter skal aldri gi
  // utbedringsoppdrag, selv om klienten sender status=AVVIK.
  const deviatingUnits = templateRequiresUnits
    ? unitRows.filter((unit) => unit.status === REPORT_STATUS_DEVIATION)
    : [];

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
    comments: notes,
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
    // Rapportnavnet og enhetsvalget fryses også, slik at PDF og lister viser
    // samme navn selv om malen endres senere.
    name: template.reportName || template.title,
    requiresUnits: templateRequiresUnits,
    // Kategori og HMS-type fryses ved signering. Da viser PDF og lister samme
    // klassifisering selv om malen senere endres eller flyttes.
    templateCategory: template.category ?? "SERVICE",
    hmsType: template.hmsType ?? null,
    templateSnapshotJson: template.fieldsJson,
    // En rapport på et oppdrag med bevaringsplikt arver flagget, slik at den
    // ikke kan slettes eller endres selv om oppdraget senere skulle bli
    // behandlet isolert.
    legalHold: workOrder.legalHold,
    isLocked: true,
    lockedAt: now,
    lockedByName: user.name || user.email,
  };

  const unitSummary = templateRequiresUnits
    ? `${unitRows.length} ${unitRows.length === 1 ? "enhet" : "enheter"}`
    : "uten enheter";
  // Uten enheter finnes ingen godkjenning/avvik å melde i loggen.
  const statusSummary = templateRequiresUnits
    ? `, ${overallStatus === REPORT_STATUS_DEVIATION ? "avvik" : "godkjent"}`
    : "";
  const actionText =
    `${existing ? "Rapport oppdatert" : `${isOffice(user.role) ? "Kontoret" : "Montør"} fylte ut skjema`}: ${template.title}` +
    ` (${unitSummary}${statusSummary})` +
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
  let legalHold = false;
  let remediationWorkOrderId: string | null = null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      let generatedReportNumber: string | null = null;
      const current = await tx.report.findUnique({
        where: { workOrderId_templateId: { workOrderId, templateId } },
        select: REVISION_SOURCE_SELECT,
      });
      // Bevaringsplikten kan ha blitt slått på etter at kallet startet.
      if (workOrder.legalHold || (current && current.legalHold)) {
        return { legalHold: true } as const;
      }
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

        const reportNumber =
          current.reportNumber ??
          (template.category === "HMS" ? await allocateReportNumber(tx) : null);
        if (!current.reportNumber && reportNumber) {
          generatedReportNumber = reportNumber;
        }

        await tx.report.update({
          where: { id: current.id },
          data: {
            ...data,
            reportNumber,
            revision: { increment: 1 },
            // Ny innsending er en ny versjon av rapporten. Kunden må kvittere
            // for den nye versjonen, så en tidligere kvittering nullstilles.
            customerAcknowledgedAt: null,
            customerAcknowledgedBy: null,
            customerAcknowledgedComment: null,
            // Enhetene erstattes helt, slik at rapporten speiler det som ble sendt inn.
            units: { deleteMany: {}, create: unitRows },
          },
        });

        if (current.customerAcknowledgedAt) {
          await audit(tx, {
            entityType: "Report",
            entityId: current.id,
            action: "Kundens kvittering ble trukket tilbake ved ny innsending",
            actor: { id: user.id, name: user.name, email: user.email },
            metadata: {
              workOrderId,
              acknowledgedAt: current.customerAcknowledgedAt.toISOString(),
              acknowledgedBy: current.customerAcknowledgedBy,
            },
          });
        }
        reportId = current.id;
      } else {
        const reportNumber =
          template.category === "HMS" ? await allocateReportNumber(tx) : null;
        generatedReportNumber = reportNumber;
        const created = await tx.report.create({
          data: {
            workOrderId,
            templateId,
            ...data,
            reportNumber,
            units: { create: unitRows },
          },
          select: { id: true },
        });
        reportId = created.id;
      }

      if (generatedReportNumber) {
        await audit(tx, {
          entityType: "WorkOrder",
          entityId: workOrderId,
          action: `Tildelte rapportnummer ${generatedReportNumber}`,
          actor: { id: user.id, name: user.name, email: user.email },
          metadata: {
            reportId,
            templateId,
            reportNumber: generatedReportNumber,
          },
        });
      }

      // Automatisk utbedringsoppdrag: nøyaktig ett per rapport. Den unike
      // `deviationSourceKey` gjør en ny innsending idempotent, også når to
      // samtidige innsendinger kommer gjennom hver sin transaksjon.
      if (deviatingUnits.length > 0) {
        const deviationSourceKey = `report:${reportId}`;
        const existingRemediation = await tx.workOrder.findUnique({
          where: { deviationSourceKey },
          select: { id: true },
        });

        if (!existingRemediation) {
          const summary = remediationOrderSummary({
            reportId,
            reportName: template.reportName || template.title,
            workOrderTitle: workOrder.title,
            notes,
            units: deviatingUnits,
            fields,
          });

          const remediation = await tx.workOrder.create({
            data: {
              title: summary.title,
              description: summary.description,
              // Utbedringsoppdraget er udatert; kontoret planlegger det selv.
              scheduledFor: null,
              scheduledTo: null,
              status: "OPEN",
              departmentId: workOrder.departmentId,
              customerId: workOrder.customerId,
              contactId: workOrder.contactId,
              creatorName: user.name || user.email || "System",
              deviationSourceKey,
              // Den som oppdaget avviket, er naturlig ansvarlig for utbedringen.
              technicians: { connect: [{ id: user.id }] },
            },
            select: { id: true },
          });
          remediationWorkOrderId = remediation.id;

          await audit(tx, {
            entityType: "WorkOrder",
            entityId: remediation.id,
            action: `Opprettet automatisk utbedringsoppdrag for ${deviatingUnits.length} avvik fra rapporten «${template.reportName || template.title}»`,
            actor: { id: user.id, name: user.name, email: user.email },
            metadata: {
              reportId,
              sourceWorkOrderId: workOrderId,
              deviationSourceKey,
              deviationCount: deviatingUnits.length,
              assignedTechnicianId: user.id,
              scheduledFor: null,
            },
          });
        } else {
          remediationWorkOrderId = existingRemediation.id;
        }
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
        metadata: { reportId, templateId, remediationWorkOrderId },
      });

      return { locked: false, legalHold: false } as const;
    });
    locked = Boolean("locked" in result && result.locked);
    legalHold = Boolean("legalHold" in result && result.legalHold);
  } catch (error) {
    await cleanupNewSignatures();
    // Samtidig innsending: den unike indeksen avviser duplikatet.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "locked", returnTo };
    }
    throw error;
  }

  if (legalHold) {
    await cleanupNewSignatures();
    return { ok: false, error: "legal-hold", returnTo };
  }

  if (locked) {
    await cleanupNewSignatures();
    return { ok: false, error: "locked", returnTo };
  }

  // Nye signaturer erstatter de gamle i rapporten, men de forrige filene
  // slettes bevisst ikke. Revisjonshistorikken peker fortsatt på dem, og en
  // opplåst rapport skal kunne vises slik den ble signert den gangen.

  const reportName = template.reportName || template.title;
  try {
    await notifyWorkOrderEvent(
      workOrderId,
      "REPORT_READY",
      `Rapport klar: ${reportName}`,
      `«${reportName}» for «${workOrder.title}» er signert og klar.`,
      `/mine-oppdrag/${workOrderId}`,
      `report-ready:${workOrderId}:${templateId}`,
    );
  } catch {
    // Varsling er best effort; rapporten er allerede lagret.
  }

  if (remediationWorkOrderId) {
    try {
      await notifyWorkOrderEvent(
        remediationWorkOrderId,
        "ASSIGNMENT",
        "Nytt utbedringsoppdrag",
        `Et utbedringsoppdrag for ${deviatingUnits.length} avvik er opprettet og tildelt deg.`,
        `/mine-oppdrag/${remediationWorkOrderId}`,
        `remediation:${remediationWorkOrderId}`,
      );
    } catch {
      // Varsling er best effort; oppdraget er allerede opprettet.
    }
  }

  return {
    ok: true,
    returnTo,
    // UI kan lenke direkte til utbedringsoppdraget når rapporten hadde avvik.
    ...(remediationWorkOrderId ? { remediationWorkOrderId } : {}),
  };
}

export type ReportLockResult =
  | { ok: true }
  | { ok: false; error: "ikke-tilgang" | "ugyldig-data" | "ikke-funnet" | "legal-hold" };

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
  let held = false;

  await prisma.$transaction(async (tx) => {
    const current = await tx.report.findFirst({
      where: { id: reportId, workOrderId, deletedAt: null },
      select: {
        ...REVISION_SOURCE_SELECT,
        workOrder: { select: { legalHold: true } },
      },
    });
    if (!current) return;
    found = true;

    // Bevaringsplikt fryser rapporten. Opplåsing er en endring av beviset og
    // skal ikke skje selv om administratoren har rettighet til det – holdet må
    // først frigjøres eksplisitt med grunn.
    if (current.legalHold || current.workOrder.legalHold) {
      held = true;
      return;
    }

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
          // Opplåsing er en ny versjon av beviset. En kvittering kunden ga for
          // den signerte versjonen kan ikke gjelde etter at den åpnes for
          // retting, og må derfor trekkes tilbake med revisjonsspor.
          customerAcknowledgedAt: null,
          customerAcknowledgedBy: null,
          customerAcknowledgedComment: null,
          revision: { increment: 1 },
        },
      });

      if (current.customerAcknowledgedAt) {
        await audit(tx, {
          entityType: "Report",
          entityId: reportId,
          action: "Kundens kvittering ble trukket tilbake ved opplåsing",
          actor: { id: user.id, name: user.name, email: user.email },
          metadata: {
            workOrderId,
            acknowledgedAt: current.customerAcknowledgedAt.toISOString(),
            acknowledgedBy: current.customerAcknowledgedBy,
            reason,
          },
        });
      }
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

  if (held) return { ok: false, error: "legal-hold" };
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
 *
 * Med `reportId` må rapporten faktisk tilhøre oppdraget. Da rendres bare den
 * ene sjekklisten i stedet for den kombinerte oppdrags-PDF-en.
 */
export async function getReportPdfForViewer(
  viewer: Actor,
  workOrderId: string,
  reportId?: string,
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

  // Kundeportalbrukere ser bare egen kunde. Ansatte med reports.view kan se
  // rapporter fra alle avdelinger, men får ikke dermed se oppdraget i listene.
  // En kunde uten kundetilknytning må aldri matche et oppdrag uten kunde.
  if (viewer.role === "CUSTOMER") {
    if (!viewer.customerId || workOrder.customerId !== viewer.customerId) {
      return { ok: false, status: 403, message: "Ingen tilgang" };
    }
  }
  if (viewer.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return { ok: false, status: 403, message: "Ingen tilgang" };
  }

  if (workOrder.reports.length === 0) {
    return { ok: false, status: 404, message: "Oppdraget har ingen rapport ennå" };
  }

  // En rapport-id fra URL-en må tilhøre oppdraget. Uten denne kontrollen
  // kunne en gyldig oppdrags-id kombinert med en fremmed rapport-id brukt
  // PDF-cachen til å rendre feil dokument.
  if (reportId && !workOrder.reports.some((report) => report.id === reportId)) {
    return { ok: false, status: 404, message: "Fant ikke rapporten" };
  }

  // Bilder ligger som /uploads/... og må gjøres absolutte for PDF-motoren.
  // Bare konfigurert adresse brukes – aldri Host/X-Forwarded-Host, som en
  // klient kan sette for å styre PDF-motoren mot en annen origin.
  const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL;

  const pdf = reportId
    ? await (
        await import("@/lib/report-pdf-store")
      ).getOrRenderReportPdf(workOrderId, baseUrl, reportId)
    : await (
        await import("@/lib/report-pdf-store")
      ).getOrRenderReportPdf(workOrderId, baseUrl);
  if (!pdf) {
    return { ok: false, status: 404, message: "Oppdraget har ingen rapport ennå" };
  }

  return { ok: true, buffer: pdf.buffer, fileName: pdf.fileName };
}
