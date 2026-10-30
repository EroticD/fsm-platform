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
): Promise<boolean> {
  if (!fileUrl || !UPLOAD_URL.test(fileUrl)) return false;
  const storedName = fileUrl.slice("/uploads/".length);

  const [
    attachment,
    customerAttachment,
    document,
    version,
    signature,
    unit,
    legacy,
    revision,
    draft,
  ] = await Promise.all([
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
          // Mellomlagret PDF peker også på en opplastingsfil.
          { pdfUrl: fileUrl },
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
    // Historiske revisjoner beholder signaturene og svarene fra da de ble
    // laget. En fil som bare brukes der, må ikke slettes.
    prisma.reportRevision.findFirst({
      where: {
        OR: [
          { technicianSignatureUrl: fileUrl },
          { customerSignatureUrl: fileUrl },
          { dataJson: { contains: fileUrl } },
          { unitsJson: { contains: fileUrl } },
        ],
      },
      select: { id: true },
    }),
    prisma.reportDraft.findFirst({
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
    legacy ||
    revision ||
    draft
  ) {
    return false;
  }

  const deleted = await prisma.upload.deleteMany({ where: { storedName } });
  if (deleted.count > 0) {
    await fs.unlink(path.join(uploadDir(), storedName)).catch(() => undefined);
    return true;
  }
  return false;
}

/**
 * Rydder opplastinger som aldri ble knyttet til et vedlegg, dokument eller en
 * rapport. En fil regnes som forlatt først etter en karanteneperiode, slik at
 * et skjema som fortsatt er åpent ikke mister filen sin. `releaseUpload`
 * kontrollerer alle referanser på nytt, også revisjoner og kladder.
 */
export async function cleanupAbandonedUploads(options?: {
  olderThanHours?: number;
  limit?: number;
}): Promise<{ checked: number; released: number }> {
  const olderThanHours = Math.max(1, options?.olderThanHours ?? 24);
  const limit = Math.min(Math.max(1, options?.limit ?? 500), 2000);
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const candidates = await prisma.upload.findMany({
    where: {
      createdAt: { lt: cutoff },
      // WORK_ORDER-filer er også kandidater: en fil som lastes opp i
      // feltportalen, men aldri knyttes til et vedlegg/rapport/revisjon/kladd,
      // blir ellers liggende for alltid. `releaseUpload` kontrollerer alle
      // referansene på nytt, også rapportens mellomlagrede PDF og signaturer.
      ownerType: { in: ["USER", "DOCUMENT", "WORK_ORDER", "CONTRACT"] },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { storedName: true, ownerType: true, ownerId: true },
  });

  let released = 0;
  for (const candidate of candidates) {
    // En avtaleeid fil har ingen egen URL-kolonne på Contract. Så lenge
    // avtalen finnes, regnes filen som referert og røres ikke.
    if (candidate.ownerType === "CONTRACT" && candidate.ownerId) {
      const contract = await prisma.contract.findUnique({
        where: { id: candidate.ownerId },
        select: { id: true },
      });
      if (contract) continue;
    }
    if (await releaseUpload(`/uploads/${candidate.storedName}`)) {
      released += 1;
    }
  }

  return { checked: candidates.length, released };
}
