import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { uploadDir } from "@/lib/uploads";

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Frigjør en opplastet fil når den ikke lenger er referert fra noe sted.
 *
 * Vi sletter bare `Upload`-raden og filen når ingen attachment, dokument,
 * dokumentversjon eller rapport (signatur/bilde) peker på samme URL. Da kan en
 * slettet fil ikke lenger hentes via `/uploads/...` av andre enn administrator,
 * samtidig som filer som deles mellom flere rader blir liggende.
 */
export async function releaseUpload(
  fileUrl: string | null | undefined,
): Promise<void> {
  if (!fileUrl || !UPLOAD_URL.test(fileUrl)) return;
  const storedName = fileUrl.slice("/uploads/".length);

  const [attachment, customerAttachment, document, version, signature, unit, legacy] =
    await Promise.all([
      prisma.attachment.findFirst({
        where: { dataUrl: fileUrl },
        select: { id: true },
      }),
      prisma.customerAttachment.findFirst({
        where: { dataUrl: fileUrl },
        select: { id: true },
      }),
      prisma.document.findFirst({
        where: { filePath: fileUrl },
        select: { id: true },
      }),
      prisma.documentVersion.findFirst({
        where: { filePath: fileUrl },
        select: { id: true },
      }),
      prisma.report.findFirst({
        where: {
          OR: [
            { technicianSignatureUrl: fileUrl },
            { customerSignatureUrl: fileUrl },
          ],
        },
        select: { id: true },
      }),
      prisma.reportUnit.findFirst({
        where: { answersJson: { contains: fileUrl } },
        select: { id: true },
      }),
      prisma.report.findFirst({
        where: { dataJson: { contains: fileUrl } },
        select: { id: true },
      }),
    ]);

  if (
    attachment ||
    customerAttachment ||
    document ||
    version ||
    signature ||
    unit ||
    legacy
  ) {
    return;
  }

  const deleted = await prisma.upload.deleteMany({ where: { storedName } });
  if (deleted.count > 0) {
    await fs.unlink(path.join(uploadDir(), storedName)).catch(() => undefined);
  }
}
