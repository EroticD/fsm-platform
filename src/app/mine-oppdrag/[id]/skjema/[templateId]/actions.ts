"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { actorName, getCurrentUser, isOffice } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { lineCommentKey, parseImageUrls } from "@/lib/report-answers";
import { LIMITS, cleanDataImage, cleanMarkdown, cleanText } from "@/lib/sanitize";

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

export async function submitReport(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/logg-inn");
  // Rapportinnsending krever reports.write og tilgang til oppdragets avdeling.
  if (!hasPermission(user, "reports.write")) redirect("/");

  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  const templateId = cleanText(formData.get("templateId"), { maxLength: LIMITS.line }) || null;
  if (!workOrderId) return;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
  });
  if (!workOrder) return;
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    redirect("/oppdrag");
  }

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

  // Rapporten låses automatisk når den lagres. Nye bilder fra tidligere
  // signaturer beholdes hvis man ikke signerer på nytt ved en gjenopplåst
  // redigering.
  const data = {
    comments: cleanMarkdown(formData.get("notes")),
    dataJson: JSON.stringify({
      status: overallStatus,
      answers: {},
      unitCount: unitRows.length,
    }),
    technicianSignatureUrl:
      cleanDataImage(formData.get("technicianSignature")) || existing?.technicianSignatureUrl || null,
    technicianName: text("technicianName") ?? existing?.technicianName ?? null,
    customerSignatureUrl:
      cleanDataImage(formData.get("customerSignature")) || existing?.customerSignatureUrl || null,
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
