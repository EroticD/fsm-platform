import prisma from "@/lib/prisma";

/** Standard døgnkvote per bruker (2 GiB), overstyrbar i miljøet. */
export const DEFAULT_USER_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
/** Standard total kvote per kunde (10 GiB), overstyrbar i miljøet. */
export const DEFAULT_CUSTOMER_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

function quotaFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value * 1024 * 1024 : fallback;
}

export function userQuotaBytes(): number {
  return quotaFromEnv("UPLOAD_QUOTA_USER_MB", DEFAULT_USER_QUOTA_BYTES / 1024 / 1024);
}

export function customerQuotaBytes(): number {
  return quotaFromEnv(
    "UPLOAD_QUOTA_CUSTOMER_MB",
    DEFAULT_CUSTOMER_QUOTA_BYTES / 1024 / 1024,
  );
}

export type UploadQuotaResult =
  | { allowed: true }
  | {
      allowed: false;
      scope: "user" | "customer";
      usedBytes: number;
      limitBytes: number;
    };

/**
 * Kontrollerer kvotene før filen flyttes fra midlertidig til endelig mappe.
 *
 * Brukerkvoten er rullerende 24 timer. Kunderkvoten er samlet lagringsbruk
 * for kunden, slik at én kunde ikke kan fylle hele volumet. Selve kontrollen
 * er en lesning; to samtidige opplastinger kan derfor i teorien passere
 * grensen med noen få megabyte. Filstørrelsesgrensene og den prosesslokale
 * køen begrenser hvor stort overskuddet kan bli.
 */
export async function checkUploadQuota(input: {
  userId: string;
  customerId: string | null;
  size: number;
  now?: Date;
}): Promise<UploadQuotaResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const userLimit = userQuotaBytes();
  const userUsed = await prisma.upload.aggregate({
    where: { uploadedById: input.userId, createdAt: { gte: since } },
    _sum: { size: true },
  });
  const userTotal = userUsed._sum.size ?? 0;
  if (userTotal + input.size > userLimit) {
    return {
      allowed: false,
      scope: "user",
      usedBytes: userTotal,
      limitBytes: userLimit,
    };
  }

  if (input.customerId) {
    const customerLimit = customerQuotaBytes();
    const customerUsed = await prisma.upload.aggregate({
      where: { customerId: input.customerId },
      _sum: { size: true },
    });
    const customerTotal = customerUsed._sum.size ?? 0;
    if (customerTotal + input.size > customerLimit) {
      return {
        allowed: false,
        scope: "customer",
        usedBytes: customerTotal,
        limitBytes: customerLimit,
      };
    }
  }

  return { allowed: true };
}
