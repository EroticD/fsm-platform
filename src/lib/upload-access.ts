import prisma from "@/lib/prisma";
import type { AccessUser } from "@/lib/access";
import { canAccessWorkOrder } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";

export type UploadOwnerType = "WORK_ORDER" | "CUSTOMER" | "DOCUMENT" | "USER";

export type UploadRecord = {
  ownerType: string;
  ownerId: string | null;
  departmentId: string | null;
  customerId: string | null;
  uploadedById: string | null;
};

/**
 * Avgjør om en bruker kan lese en opplastet fil.
 *
 * - ADMIN ser alt.
 * - Kundeportalbrukere ser bare filer som tilhører deres egen kunde.
 * - Oppdragsfil er synlig for dem som kan se oppdraget (avdeling/kunde).
 * - Dokumentfiler krever documents.view.
 * - Private filer er bare synlige for den som lastet dem opp.
 */
export function canReadUpload(
  user: AccessUser | null | undefined,
  upload: UploadRecord,
): boolean {
  if (!user?.isActive) return false;
  if (user.role === "ADMIN") return true;

  switch (upload.ownerType) {
    case "WORK_ORDER":
      return canAccessWorkOrder(user, {
        departmentId: upload.departmentId,
        customerId: upload.customerId,
      });
    case "CUSTOMER":
      if (user.role === "CUSTOMER") {
        return Boolean(upload.customerId && upload.customerId === user.customerId);
      }
      return hasPermission(user, "customers.view");
    case "DOCUMENT":
      return hasPermission(user, "documents.view");
    case "USER":
      return Boolean(upload.uploadedById && upload.uploadedById === user.id);
    default:
      return false;
  }
}

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Flytter en opplastet fil fra privat eierskap til oppdraget, kunden eller
 * dokumentet den ble lagt ved. Kalles etter at vedlegget er lagret.
 *
 * Ukjente URL-er ignoreres stille: bare filer i opplastingsmappen kan knyttes.
 */
export async function linkUploadOwner(
  fileUrl: string,
  owner: {
    ownerType: UploadOwnerType;
    ownerId: string | null;
    departmentId: string | null;
    customerId: string | null;
  },
): Promise<void> {
  if (!UPLOAD_URL.test(fileUrl)) return;
  const storedName = fileUrl.slice(fileUrl.lastIndexOf("/") + 1);
  if (!storedName) return;

  await prisma.upload.updateMany({
    where: { storedName },
    data: {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      departmentId: owner.departmentId,
      customerId: owner.customerId,
    },
  });
}
