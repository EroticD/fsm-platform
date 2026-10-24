import type { Prisma } from "@prisma/client";
import type { AccessUser } from "@/lib/access";
import { canAccessWorkOrder } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";

export type UploadOwnerType = "WORK_ORDER" | "CUSTOMER" | "DOCUMENT" | "USER" | "BRANDING";

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
    case "BRANDING":
      // Merkevarelogoen vises for alle innloggede, også kundeportalen.
      return true;
    default:
      return false;
  }
}

const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Knytter en opplastet fil til oppdraget, kunden eller dokumentet den legges
 * ved. Kalles fra samme transaksjon som vedlegget/dokumentet og revisjonen, slik
 * at en fil aldri kan knyttes til noe annet enn det som faktisk ble lagret.
 *
 * Predikatet er bevisst strengt: en fil som allerede tilhører et annet oppdrag,
 * en annen kunde eller et annet dokument kan ikke flyttes. En bruker kan bare
 * gjøre krav på sin egen private opplasting (USER) eller en dokumentfil som
 * ennå ikke er knyttet til et dokument. `claimed` er false når ingen rad matcher.
 */
export async function claimUpload(
  tx: Prisma.TransactionClient,
  fileUrl: string,
  actorId: string,
  owner: {
    ownerType: UploadOwnerType;
    ownerId: string | null;
    departmentId: string | null;
    customerId: string | null;
  },
): Promise<{ claimed: boolean }> {
  if (!UPLOAD_URL.test(fileUrl)) return { claimed: false };
  const storedName = fileUrl.slice(fileUrl.lastIndexOf("/") + 1);
  if (!storedName) return { claimed: false };

  // En ueid DOCUMENT-opplasting (ownerId: null) eller en privat USER-opplasting
  // kan bare claimеs av den som lastet den opp. Uten dette ville hvem som helst
  // med dokumenttilgang kunne ta over en annens ennå ikke tilknyttede fil.
  const sameTarget =
    owner.ownerId === null || owner.ownerType === "USER"
      ? {
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          uploadedById: actorId,
        }
      : { ownerType: owner.ownerType, ownerId: owner.ownerId };

  const result = await tx.upload.updateMany({
    where: {
      storedName,
      OR: [
        sameTarget,
        { uploadedById: actorId, ownerType: "USER", ownerId: actorId },
        { uploadedById: actorId, ownerType: "DOCUMENT", ownerId: null },
      ],
    },
    data: {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      departmentId: owner.departmentId,
      customerId: owner.customerId,
    },
  });

  return { claimed: result.count > 0 };
}
