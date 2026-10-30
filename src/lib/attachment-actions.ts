"use server";

import fs from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { requireAdmin, getCurrentUser } from "@/lib/session";
import { requireWorkOrderAccess } from "@/lib/access";
import { claimUpload } from "@/lib/upload-access";
import { releaseUpload } from "@/lib/upload-cleanup";
import { uploadDir } from "@/lib/uploads";
import { isClosedStatus } from "@/lib/work-order-status";
import type { WorkStatus } from "@prisma/client";
import {
  addCustomerAttachment as addCustomerAttachmentService,
  removeCustomerAttachment as removeCustomerAttachmentService,
} from "@/server/customers";

export type AttachmentActionResult = {
  ok: boolean;
  /** Stabil feilkode; klienten oversetter `messageKey` og faller tilbake til denne. */
  error?: string;
  messageKey?: string;
};

function failAttachment(error: string, messageKey?: string): AttachmentActionResult {
  return messageKey ? { ok: false, error, messageKey } : { ok: false, error };
}

/** Bare filer som ligger i opplastingsmappen kan knyttes til et oppdrag. */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

function attachmentPath(fileUrl: string): string | null {
  if (!UPLOAD_URL.test(fileUrl)) return null;
  return path.join(uploadDir(), path.basename(fileUrl));
}

/**
 * Et fullført/kansellert oppdrag og et oppdrag med bevaringsplikt er låst
 * historikk. Regelen gjelder alle roller, også administrator: det finnes ingen
 * dokumentert admin-overstyring for vedlegg. En administrator må eventuelt
 * gjenåpne oppdraget eller fjerne bevaringsplikten med begrunnelse først.
 */
function attachmentLockError(
  workOrder: { status: string; legalHold: boolean } | null | undefined,
): "legal-hold" | "workorder-locked" | null {
  if (!workOrder) return null;
  if (workOrder.legalHold) return "legal-hold";
  if (isClosedStatus(workOrder.status as WorkStatus)) return "workorder-locked";
  return null;
}

/**
 * Knytter en allerede opplastet fil til et oppdrag.
 *
 * Selve filen lastes opp via /api/upload av klienten; her lagres bare
 * visningsnavnet og URL-en. Det hindrer at en server action må håndtere store
 * filer, og gjenbruker samme validering og lagring som resten av appen.
 */
export async function addAttachment(formData: FormData): Promise<AttachmentActionResult> {
  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  if (!workOrderId) return failAttachment("missing_field", "errors.api.missingField");
  const access = await requireWorkOrderAccess("workorders.update", workOrderId);
  if (!access) {
    return failAttachment("forbidden", "errors.api.forbidden");
  }

  const fileUrl = cleanText(formData.get("fileUrl"), { maxLength: LIMITS.line });
  const fileName = cleanText(formData.get("fileName"), { maxLength: LIMITS.title });

  if (!fileUrl) return failAttachment("missing_field", "errors.api.missingField");

  const filePath = attachmentPath(fileUrl);
  if (!filePath) return failAttachment("invalid_file", "errors.api.invalidFile");

  // Filen må faktisk finnes i opplastingsmappen.
  try {
    await fs.access(filePath);
  } catch {
    return failAttachment("file_not_found", "errors.api.fileNotFound");
  }

  const displayName = fileName || "Vedlegg";

  // Kravet på filen, vedlegget og revisjonen skjer i samme transaksjon. Hvis
  // filen allerede tilhører et annet oppdrag/en annen bruker, opprettes det
  // ingen attachment-rad, og svaret er generisk slik at det ikke røper om
  // filen finnes.
  //
  // Låsen kontrolleres på nytt inne i transaksjonen, slik at et oppdrag som
  // fullføres eller får bevaringsplikt samtidig ikke kan få nye vedlegg. Også
  // duplikatsjekken ligger etter låsen: et lukket oppdrag skal avvises selv om
  // filen allerede er vedlagt.
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { status: true, legalHold: true },
    });
    const locked = attachmentLockError(current);
    if (locked) return { ok: false as const, error: locked, messageKey: locked === "legal-hold" ? "errors.api.attachment.legalHold" : "errors.api.attachment.locked" };

    // Ikke legg ved samme fil to ganger på samme oppdrag.
    const existing = await tx.attachment.findFirst({
      where: { workOrderId, dataUrl: fileUrl },
      select: { id: true }
    });
    if (existing) return { ok: true as const };

    const { claimed } = await claimUpload(tx, fileUrl, access.user.id, {
      ownerType: "WORK_ORDER",
      ownerId: workOrderId,
      departmentId: access.workOrder.departmentId,
      customerId: access.workOrder.customerId,
    });
    if (!claimed) {
      return { ok: false as const, error: "invalid_file", messageKey: "errors.api.invalidFile" };
    }

    const attachment = await tx.attachment.create({
      data: {
        workOrderId,
        fileName: displayName,
        dataUrl: fileUrl
      }
    });

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: `La ved fil: ${displayName}`,
      actor: {
        id: access.user.id,
        name: access.user.name,
        email: access.user.email,
      },
      metadata: { attachmentId: attachment.id },
    });

    return { ok: true as const };
  });

  if (!result.ok) return { ok: false, error: result.error, messageKey: result.messageKey };

  revalidateAttachmentViews(workOrderId);
  return { ok: true };
}

/** Fjerner vedlegget fra oppdraget og sletter filen fra disk. */
export async function removeAttachment(formData: FormData): Promise<AttachmentActionResult> {
  // Sletting av filer er forbeholdt administrator.
  if (!(await requireAdmin())) return failAttachment("forbidden", "errors.api.forbidden");

  const attachmentId = cleanText(formData.get("attachmentId"), { maxLength: LIMITS.line });
  if (!attachmentId) return failAttachment("missing_field", "errors.api.missingField");

  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return failAttachment("file_not_found", "errors.api.attachment.notFound");

  const actor = await getCurrentUser();
  if (!actor) return failAttachment("forbidden", "errors.api.forbidden");

  // Bevaringsplikt på oppdraget eller en av rapportene fryser også vedleggene.
  // Et fullført eller kansellert oppdrag er låst historikk. Låsen kontrolleres
  // på nytt inne i transaksjonen, like før slettingen.
  const locked = await prisma.$transaction(async (tx) => {
    const current = await tx.workOrder.findUnique({
      where: { id: attachment.workOrderId },
      select: {
        status: true,
        legalHold: true,
        reports: { select: { legalHold: true } },
      },
    });
    if (
      current?.legalHold ||
      current?.reports.some((report) => report.legalHold)
    ) {
      return "legal-hold";
    }
    const guard = attachmentLockError(current);
    if (guard) return guard;

    await tx.attachment.delete({ where: { id: attachmentId } });

    // Filen blir liggende på disk. Samme fil kan være referert fra flere
    // steder (f.eks. en rapport og et dokument), så den kan ikke slettes trygt
    // her. En egen opprydningsjobb kan fjerne filer uten referanser senere.
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: attachment.workOrderId,
      action: `Slettet vedlegg: ${attachment.fileName}`,
      actor: { id: actor.id, name: actor.name, email: actor.email },
      metadata: { attachmentId },
    });

    return null;
  });
  if (locked) return { ok: false, error: locked, messageKey: locked === "legal-hold" ? "errors.api.attachment.legalHold" : "errors.api.attachment.locked" };

  await releaseUpload(attachment.dataUrl);

  revalidateAttachmentViews(attachment.workOrderId);
  return { ok: true };
}

/** Knytter en opplastet fil til kundekortet. */
export async function addCustomerAttachment(
  formData: FormData,
): Promise<AttachmentActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return failAttachment("forbidden", "errors.api.forbidden");

  const customerId = cleanText(formData.get("customerId"), {
    maxLength: LIMITS.line,
  });
  const fileUrl = cleanText(formData.get("fileUrl"), {
    maxLength: LIMITS.line,
  });
  const fileName = cleanText(formData.get("fileName"), {
    maxLength: LIMITS.title,
  });

  if (!customerId || !fileUrl) return failAttachment("missing_field", "errors.api.missingField");

  const result = await addCustomerAttachmentService(actor, {
    customerId,
    fileUrl,
    fileName,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "forbidden":
        return failAttachment("forbidden", "errors.api.forbidden");
      case "invalid":
        return failAttachment("invalid_file", "errors.api.invalidFile");
      case "file_not_found":
        return failAttachment("file_not_found", "errors.api.fileNotFound");
      case "customer_not_found":
        return failAttachment("not_found", "errors.api.customers.notFound");
      default:
        return failAttachment("save_failed", "errors.api.attachment.saveFailed");
    }
  }

  revalidatePath(`/kunder/${customerId}`);
  return { ok: true };
}

/** Fjerner et kundeverlegg. Sletting er forbeholdt administrator. */
export async function removeCustomerAttachment(
  formData: FormData,
): Promise<AttachmentActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return failAttachment("forbidden", "errors.api.forbidden");

  const attachmentId = cleanText(formData.get("attachmentId"), {
    maxLength: LIMITS.line,
  });
  if (!attachmentId) return failAttachment("missing_field", "errors.api.missingField");

  const result = await removeCustomerAttachmentService(actor, {
    attachmentId,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "forbidden":
        return failAttachment("forbidden", "errors.api.forbidden");
      case "invalid":
        return failAttachment("missing_field", "errors.api.missingField");
      case "not_found":
        return failAttachment("file_not_found", "errors.api.attachment.notFound");
      default:
        return failAttachment("save_failed", "errors.api.attachment.deleteFailed");
    }
  }

  return { ok: true };
}

function revalidateAttachmentViews(workOrderId: string) {
  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}
