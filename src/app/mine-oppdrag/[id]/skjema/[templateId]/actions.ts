"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { actorName, getCurrentUser, isOffice } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { lineCommentKey, parseImageUrls } from "@/lib/report-answers";
import { LIMITS, cleanDataImage, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { deleteUploadIfOwned, storeDataImage } from "@/lib/upload-store";

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;
const SIGNATURE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;

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
  return accepted;
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
        (u): u is UnitPayload =>
          !!u && typeof u === "object" && typeof (u as UnitPayload).key === "string",
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
function returnPath(formData: FormData, workOrderId: string): string {
  const raw = (formData.get("returnTo") as string) || "";
  return [`/oppdrag/${workOrderId}`, `/mine-oppdrag/${workOrderId}`].includes(raw)
    ? raw
    : `/mine-oppdrag/${workOrderId}`;
}

/**
 * Lagrer en kladd av sjekklisten. Kalles automatisk fra skjemaet mens det
 * fylles ut, slik at ingenting går tapt hvis nettet eller appen faller ut.
 * Kladden er per bruker, oppdrag og mal.
 */
export async function saveDraft(
  formData: FormData,
): Promise<{ ok: boolean; savedAt?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  if (!hasPermission(user, "reports.write")) return { ok: false };

  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  const templateId = cleanText(formData.get("templateId"), { maxLength: LIMITS.line });
  if (!workOrderId || !templateId) return { ok: false };

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

  // Ikke lagre kladd over en rapport som allerede er låst.
  const existingReport = await prisma.report.findUnique({
    where: { workOrderId_templateId: { workOrderId, templateId } },
    select: { isLocked: true },
  });
  if (existingReport?.isLocked) return { ok: false };

  const fields = parseFields(template.fieldsJson);

  const units = parseUnits(formData.get("unitsJson")).map((unit) => ({
    productId: unit.productId || "",
    label: cleanText(unit.label, { maxLength: LIMITS.title }),
    serialNumber: cleanText(unit.serialNumber, { maxLength: LIMITS.line }),
    location: cleanText(unit.location, { maxLength: LIMITS.line }),
    status: formData.get(`status__${unit.key}`) === "AVVIK" ? "AVVIK" : "GODKJENT",
    comment: cleanMarkdown(formData.get(`comment__${unit.key}`)),
    answers: readAnswers(formData, fields, unit.key),
  }));

  const payload = {
    notes: cleanMarkdown(formData.get("notes")),
    technicianSignatureUrl: cleanDataImage(formData.get("technicianSignature")) || null,
    technicianName: cleanText(formData.get("technicianName"), { maxLength: LIMITS.title }) || null,
    customerSignatureUrl: cleanDataImage(formData.get("customerSignature")) || null,
    customerName: cleanText(formData.get("customerName"), { maxLength: LIMITS.title }) || null,
    units,
  };

  const now = new Date();
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
      dataJson: JSON.stringify(payload),
      updatedByName: user.name || user.email || null,
    },
    update: {
      dataJson: JSON.stringify(payload),
      updatedByName: user.name || user.email || null,
    },
  });

  return { ok: true, savedAt: now.toISOString() };
}

export async function submitReport(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/logg-inn");
  // Rapportinnsending krever reports.write og tilgang til oppdragets avdeling.
  if (!hasPermission(user, "reports.write")) redirect("/");

  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  const templateId = cleanText(formData.get("templateId"), { maxLength: LIMITS.line });
  if (!workOrderId || !templateId) return;

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
  if (!workOrder) return;
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    redirect("/oppdrag");
  }

  const template = workOrder.templates[0];
  if (!template) return;
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
    redirect(`${returnPath(formData, workOrderId)}?error=locked`);
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

  const text = (name: string) => cleanText(formData.get(name), { maxLength: LIMITS.title }) || null;

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
  const technicianSignatureUrl = await resolveSignature(
    formData.get("technicianSignature"),
    previousTechnicianSignature,
    signatureContext,
  );
  const customerSignatureUrl = await resolveSignature(
    formData.get("customerSignature"),
    previousCustomerSignature,
    signatureContext,
  );

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

  const actor = await actorName();
  const actionText =
    `${existing ? "Rapport oppdatert" : `${isOffice(user.role) ? "Kontoret" : "Montør"} fylte ut skjema`}: ${template.title}` +
    ` (${unitRows.length} ${unitRows.length === 1 ? "enhet" : "enheter"}, ${overallStatus === "AVVIK" ? "avvik" : "godkjent"})` +
    " – rapporten låses automatisk";

  const signatureOwner = { ownerType: "WORK_ORDER" as const, ownerId: workOrderId };

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
        select: { id: true, isLocked: true },
      });
      if (current?.isLocked) return { locked: true } as const;

      if (current) {
        await tx.report.update({
          where: { id: current.id },
          data: {
            ...data,
            // Enhetene erstattes helt, slik at rapporten speiler det som ble sendt inn.
            units: { deleteMany: {}, create: unitRows },
          },
        });
      } else {
        await tx.report.create({
          data: {
            workOrderId,
            templateId,
            ...data,
            units: { create: unitRows },
          },
        });
      }

      // Kladden er ikke lenger nødvendig når rapporten er lagret.
      await tx.reportDraft.deleteMany({
        where: { workOrderId, templateId, userId: user.id },
      });

      await tx.auditLog.create({
        data: {
          entityType: "Report",
          entityId: workOrderId,
          action: actionText,
          userName: actor,
        },
      });

      return { locked: false } as const;
    });
    locked = result.locked;
  } catch (error) {
    await cleanupNewSignatures();
    // Samtidig innsending: den unike indeksen avviser duplikatet.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(`${returnPath(formData, workOrderId)}?error=locked`);
    }
    throw error;
  }

  if (locked) {
    await cleanupNewSignatures();
    redirect(`${returnPath(formData, workOrderId)}?error=locked`);
  }

  // Nye signaturer erstatter de gamle. Slett den forrige filen bare når den
  // faktisk eies av dette oppdraget – aldri en annen rapports bilde.
  if (previousTechnicianSignature && previousTechnicianSignature !== technicianSignatureUrl) {
    await deleteUploadIfOwned(previousTechnicianSignature, signatureOwner);
  }
  if (previousCustomerSignature && previousCustomerSignature !== customerSignatureUrl) {
    await deleteUploadIfOwned(previousCustomerSignature, signatureOwner);
  }

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
  revalidatePath(`/rapporter/${workOrderId}`);
  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(returnPath(formData, workOrderId));
}
