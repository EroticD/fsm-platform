"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { actorName, getCurrentUser, isOffice, isStaff } from "@/lib/session";
import { lineCommentKey } from "@/lib/report-answers";

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
    const value = formData.get(`answer__${key}__${field.id}`);
    answers[field.id] =
      field.type === "CHECKBOX" ? value !== null : typeof value === "string" ? value : "";

    // Tilstandsfelt: kommentaren til linjen lagres sammen med svaret, slik at
    // rapporten viser "Utbedres – kommentar" på samme linje.
    const lineComment = formData.get(`linecomment__${key}__${field.id}`);
    answers[lineCommentKey(field.id)] =
      typeof lineComment === "string" ? lineComment.trim() : "";
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

export async function submitReport(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/logg-inn");
  // Rapportinnsending er en felt-handling: montører og kontor, ikke kunder.
  if (!isStaff(user.role)) redirect("/");

  const workOrderId = formData.get("workOrderId") as string;
  const templateId = (formData.get("templateId") as string) || null;
  if (!workOrderId) return;

  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder) return;

  const template = templateId
    ? await prisma.template.findUnique({ where: { id: templateId } })
    : null;
  const fields = parseFields(template?.fieldsJson);

  // Én rapport per sjekkliste per oppdrag. Er den allerede fylt ut og låst, kan
  // den ikke endres før en administrator har låst den opp.
  const existing = templateId
    ? await prisma.report.findFirst({
        where: { workOrderId, templateId },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (existing?.isLocked) {
    redirect(`${returnPath(formData, workOrderId)}?error=locked`);
  }

  const unitStatus: string[] = [];
  const unitRows = [];

  for (const [index, unit] of parseUnits(formData.get("unitsJson")).entries()) {
    const label = (unit.label || "").trim();
    if (!label) continue; // hopper over tomme rader

    const status = formData.get(`status__${unit.key}`) === "AVVIK" ? "AVVIK" : "GODKJENT";
    unitStatus.push(status);

    unitRows.push({
      productId: await resolveProductId(workOrder.customerId, {
        productId: unit.productId || "",
        label,
        serialNumber: unit.serialNumber || "",
        location: unit.location || "",
      }),
      label,
      serialNumber: (unit.serialNumber || "").trim() || null,
      location: (unit.location || "").trim() || null,
      status,
      answersJson: JSON.stringify(readAnswers(formData, fields, unit.key)),
      comment: ((formData.get(`comment__${unit.key}`) as string) || "").trim() || null,
      sortOrder: index,
    });
  }

  const text = (name: string) => ((formData.get(name) as string) || "").trim() || null;

  // Rapporten er "godkjent" bare når ingen av enhetene har avvik.
  const overallStatus = unitStatus.includes("AVVIK") ? "AVVIK" : "GODKJENT";

  const now = new Date();

  // Rapporten låses automatisk når den lagres. Nye bilder fra tidligere
  // signaturer beholdes hvis man ikke signerer på nytt ved en gjenopplåst
  // redigering.
  const data = {
    comments: text("notes") ?? "",
    dataJson: JSON.stringify({
      status: overallStatus,
      answers: {},
      unitCount: unitRows.length,
    }),
    technicianSignatureUrl: text("technicianSignature") ?? existing?.technicianSignatureUrl ?? null,
    technicianName: text("technicianName") ?? existing?.technicianName ?? null,
    customerSignatureUrl: text("customerSignature") ?? existing?.customerSignatureUrl ?? null,
    customerName: text("customerName") ?? existing?.customerName ?? null,
    isLocked: true,
    lockedAt: now,
    lockedByName: user.name || user.email,
  };

  if (existing) {
    await prisma.report.update({
      where: { id: existing.id },
      data: {
        ...data,
        // Enhetene erstattes helt, slik at rapporten speiler det som ble sendt inn.
        units: { deleteMany: {}, create: unitRows },
      },
    });
  } else {
    await prisma.report.create({
      data: {
        workOrderId,
        templateId,
        ...data,
        units: { create: unitRows },
      },
    });
  }

  const actor = await actorName();
  await prisma.auditLog.create({
    data: {
      entityType: "Report",
      entityId: workOrderId,
      action:
        `${existing ? "Rapport oppdatert" : `${isOffice(user.role) ? "Kontoret" : "Montør"} fylte ut skjema`}: ${template?.title || "Ukjent skjema"}` +
        ` (${unitRows.length} ${unitRows.length === 1 ? "enhet" : "enheter"}, ${overallStatus === "AVVIK" ? "avvik" : "godkjent"})` +
        " – rapporten låses automatisk",
      userName: actor,
    },
  });

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
  revalidatePath(`/rapporter/${workOrderId}`);
  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(returnPath(formData, workOrderId));
}
