"use server";

import fs from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { requireOffice, requireStaff, actorName } from "@/lib/session";
import { uploadDir } from "@/lib/uploads";

export type AttachmentActionResult = { ok: boolean; error?: string };

/** Bare filer som ligger i opplastingsmappen kan knyttes til et oppdrag. */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

function attachmentPath(fileUrl: string): string | null {
  if (!UPLOAD_URL.test(fileUrl)) return null;
  return path.join(uploadDir(), path.basename(fileUrl));
}

/**
 * Knytter en allerede opplastet fil til et oppdrag.
 *
 * Selve filen lastes opp via /api/upload av klienten; her lagres bare
 * visningsnavnet og URL-en. Det hindrer at en server action må håndtere store
 * filer, og gjenbruker samme validering og lagring som resten av appen.
 */
export async function addAttachment(formData: FormData): Promise<AttachmentActionResult> {
  if (!(await requireStaff())) return { ok: false, error: "Ikke tilgang" };

  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  const fileUrl = cleanText(formData.get("fileUrl"), { maxLength: LIMITS.line });
  const fileName = cleanText(formData.get("fileName"), { maxLength: LIMITS.title });

  if (!workOrderId || !fileUrl) return { ok: false, error: "Mangler data" };

  const filePath = attachmentPath(fileUrl);
  if (!filePath) return { ok: false, error: "Ugyldig fil" };

  // Filen må faktisk finnes i opplastingsmappen.
  try {
    await fs.access(filePath);
  } catch {
    return { ok: false, error: "Filen ble ikke funnet" };
  }

  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true }
  });
  if (!workOrder) return { ok: false, error: "Oppdraget finnes ikke" };

  // Ikke legg ved samme fil to ganger på samme oppdrag.
  const existing = await prisma.attachment.findFirst({
    where: { workOrderId, dataUrl: fileUrl },
    select: { id: true }
  });
  if (existing) return { ok: true };

  const displayName = fileName || "Vedlegg";

  await prisma.attachment.create({
    data: {
      workOrderId,
      fileName: displayName,
      dataUrl: fileUrl
    }
  });

  await prisma.auditLog.create({
    data: {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: `La ved fil: ${displayName}`,
      userName: (await actorName()) || "Ukjent"
    }
  });

  revalidateAttachmentViews(workOrderId);
  return { ok: true };
}

/** Fjerner vedlegget fra oppdraget og sletter filen fra disk. */
export async function removeAttachment(formData: FormData): Promise<AttachmentActionResult> {
  if (!(await requireStaff())) return { ok: false, error: "Ikke tilgang" };

  const attachmentId = cleanText(formData.get("attachmentId"), { maxLength: LIMITS.line });
  if (!attachmentId) return { ok: false, error: "Mangler data" };

  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return { ok: false, error: "Vedlegget finnes ikke" };

  await prisma.attachment.delete({ where: { id: attachmentId } });

  // Slett filen fra disk. Feiler det (f.eks. fordi filen alt er borte), er
  // databaseraden likevel fjernet – derfor ignoreres feilen.
  const filePath = attachmentPath(attachment.dataUrl);
  if (filePath) {
    try {
      await fs.unlink(filePath);
    } catch {}
  }

  await prisma.auditLog.create({
    data: {
      entityType: "WorkOrder",
      entityId: attachment.workOrderId,
      action: `Slettet vedlegg: ${attachment.fileName}`,
      userName: (await actorName()) || "Ukjent"
    }
  });

  revalidateAttachmentViews(attachment.workOrderId);
  return { ok: true };
}

/** Knytter en opplastet fil til kundekortet. */
export async function addCustomerAttachment(
  formData: FormData,
): Promise<AttachmentActionResult> {
  if (!(await requireOffice())) return { ok: false, error: "Ikke tilgang" };

  const customerId = cleanText(formData.get("customerId"), {
    maxLength: LIMITS.line,
  });
  const fileUrl = cleanText(formData.get("fileUrl"), { maxLength: LIMITS.line });
  const fileName = cleanText(formData.get("fileName"), { maxLength: LIMITS.title });

  if (!customerId || !fileUrl) return { ok: false, error: "Mangler data" };

  const filePath = attachmentPath(fileUrl);
  if (!filePath) return { ok: false, error: "Ugyldig fil" };

  try {
    await fs.access(filePath);
  } catch {
    return { ok: false, error: "Filen ble ikke funnet" };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: "Kunden finnes ikke" };

  const existing = await prisma.customerAttachment.findFirst({
    where: { customerId, dataUrl: fileUrl },
    select: { id: true },
  });
  if (existing) return { ok: true };

  const displayName = fileName || "Vedlegg";

  await prisma.customerAttachment.create({
    data: { customerId, fileName: displayName, dataUrl: fileUrl },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `La ved fil: ${displayName}`,
      userName: (await actorName()) || "Ukjent",
    },
  });

  revalidatePath(`/kunder/${customerId}`);
  return { ok: true };
}

/** Fjerner et kundeverlegg og sletter filen fra disk. */
export async function removeCustomerAttachment(
  formData: FormData,
): Promise<AttachmentActionResult> {
  if (!(await requireOffice())) return { ok: false, error: "Ikke tilgang" };

  const attachmentId = cleanText(formData.get("attachmentId"), {
    maxLength: LIMITS.line,
  });
  if (!attachmentId) return { ok: false, error: "Mangler data" };

  const attachment = await prisma.customerAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) return { ok: false, error: "Vedlegget finnes ikke" };

  await prisma.customerAttachment.delete({ where: { id: attachmentId } });

  const filePath = attachmentPath(attachment.dataUrl);
  if (filePath) {
    try {
      await fs.unlink(filePath);
    } catch {}
  }

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: attachment.customerId,
      action: `Slettet vedlegg: ${attachment.fileName}`,
      userName: (await actorName()) || "Ukjent",
    },
  });

  revalidatePath(`/kunder/${attachment.customerId}`);
  return { ok: true };
}

function revalidateAttachmentViews(workOrderId: string) {
  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}
