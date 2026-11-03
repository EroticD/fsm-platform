import prisma from "@/lib/prisma";
import { workOrderScope, type AccessUser } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";
import { parseScannedCode } from "@/lib/scan-code";
import { getEquipment, resolveEquipmentQrToken } from "@/server/equipment";
import type { ServiceActor } from "@/server/actor";

export type ScanFailure = "invalid" | "not_found" | "forbidden";

export type ScanResolution =
  | { ok: true; href: string }
  | { ok: false; reason: ScanFailure };

/**
 * Slår opp en skannet kode på nytt på serveren. Kameraet er ikke en
 * autorisasjonskilde: en enhetstoken, en id eller en oppdragsreferanse gir
 * bare en omdirigering når brukeren har tilgang til målet.
 */
export async function resolveScanCode(
  actor: ServiceActor,
  rawCode: string,
): Promise<ScanResolution> {
  const parsed = parseScannedCode(rawCode);
  if (parsed.kind === "invalid") return { ok: false, reason: "invalid" };

  if (parsed.kind === "equipment-token") {
    const equipment = await resolveEquipmentQrToken(parsed.token);
    if (!equipment) return { ok: false, reason: "not_found" };
    const result = await getEquipment(actor, equipment.id);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "forbidden" ? "forbidden" : "not_found",
      };
    }
    return { ok: true, href: `/enheter/${equipment.id}` };
  }

  if (parsed.kind === "equipment-id") {
    const result = await getEquipment(actor, parsed.id);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === "forbidden" ? "forbidden" : "not_found",
      };
    }
    return { ok: true, href: `/enheter/${parsed.id}` };
  }

  // Kundeportalen har egne sider og skal ikke kunne skanne seg inn i
  // saksbehandlingen.
  if (!hasPermission(actor, "workorders.view") || actor.role === "CUSTOMER") {
    return { ok: false, reason: "forbidden" };
  }

  const identity =
    parsed.kind === "work-order-id"
      ? { id: parsed.id }
      : parsed.kind === "work-order-reference"
        ? {
            OR: [
              { reference: parsed.reference },
              { orderNumber: parsed.reference },
            ],
          }
        : { orderNumber: parsed.number };

  const workOrder = await prisma.workOrder.findFirst({
    where: {
      ...workOrderScope(actor as unknown as AccessUser),
      ...identity,
    },
    select: { id: true },
  });
  if (!workOrder) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    href:
      actor.role === "TECHNICIAN"
        ? `/mine-oppdrag/${workOrder.id}`
        : `/oppdrag/${workOrder.id}`,
  };
}
