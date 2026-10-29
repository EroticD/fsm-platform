import prisma from "@/lib/prisma";
import type { UploadOwnerType } from "@/lib/upload-access";

/**
 * Hvilke opplastinger som kan brukes som rapporteringsbilder. Signaturer og
 * vedlegg knyttes til oppdraget når rapporten lagres, så en fil uten denne
 * eieren skal aldri leses inn i en PDF.
 */
export const REPORT_IMAGE_OWNER_TYPES: readonly UploadOwnerType[] = ["WORK_ORDER"];

/** Merkevarelogoen lastes opp med egen eiertype, uavhengig av oppdrag. */
export const BRANDING_LOGO_OWNER_TYPES: readonly UploadOwnerType[] = ["BRANDING"];

/** `/uploads/<lagret filnavn>` – samme strenge form som opplastingsruten lager. */
const UPLOAD_URL = /^\/uploads\/([A-Za-z0-9._-]+)$/;

/** Filnavnet en `/uploads`-URL peker på, eller null for andre URL-er. */
export function uploadStoredName(url: string | null | undefined): string | null {
  const match = UPLOAD_URL.exec((url ?? "").trim());
  return match ? match[1] : null;
}

export type UploadOwnership = {
  ownerType: string;
  ownerId?: string | null;
  departmentId?: string | null;
  customerId?: string | null;
  uploadedById: string | null;
};

/** Sjekker eierskapet til en opplastet fil, uten å lese selve filen. */
export function hasAllowedOwner(
  upload: UploadOwnership | null | undefined,
  allowedOwnerTypes: readonly UploadOwnerType[],
): upload is UploadOwnership {
  return Boolean(upload && allowedOwnerTypes.includes(upload.ownerType as UploadOwnerType));
}

/** Henter eierskapet til flere filer i én spørring. */
export async function loadUploadOwnerships(
  urls: readonly (string | null | undefined)[],
): Promise<Map<string, UploadOwnership>> {
  const storedNames = [
    ...new Set(
      urls
        .map((url) => uploadStoredName(url))
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (storedNames.length === 0) return new Map();

  const rows = await prisma.upload.findMany({
    where: { storedName: { in: storedNames } },
    select: {
      storedName: true,
      ownerType: true,
      ownerId: true,
      departmentId: true,
      customerId: true,
      uploadedById: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.storedName,
      {
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        departmentId: row.departmentId,
        customerId: row.customerId,
        uploadedById: row.uploadedById,
      },
    ]),
  );
}

/** Er filen lastet opp med en av de tillatte eiertypene? */
export async function isUploadOwnedBy(
  url: string | null | undefined,
  allowedOwnerTypes: readonly UploadOwnerType[],
): Promise<boolean> {
  const storedName = uploadStoredName(url);
  if (!storedName) return false;

  const upload = await prisma.upload.findUnique({
    where: { storedName },
    select: { ownerType: true, uploadedById: true },
  });
  return hasAllowedOwner(upload, allowedOwnerTypes);
}

/**
 * En logo kan bare brukes av den som lastet den opp som merkevare. Da kan en
 * vilkårlig `/uploads`-fil (fra et oppdrag, en kunde eller en annen bruker)
 * ikke settes som logo.
 */
export async function isBrandingLogoForActor(
  url: string | null | undefined,
  actorId: string,
): Promise<boolean> {
  const storedName = uploadStoredName(url);
  if (!storedName) return false;

  const upload = await prisma.upload.findUnique({
    where: { storedName },
    select: { ownerType: true, uploadedById: true },
  });

  return Boolean(
    hasAllowedOwner(upload, BRANDING_LOGO_OWNER_TYPES) &&
      upload.uploadedById === actorId,
  );
}
