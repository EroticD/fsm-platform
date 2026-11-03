import prisma from "@/lib/prisma";
import { workOrderScope, type AccessUser } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";
import { normalizeScannedCode, parseScannedCode } from "@/lib/scan-code";
import {
  getEquipment,
  recordEquipmentQrCodeScan,
  resolveEquipmentExternalQr,
  resolveEquipmentQrToken,
} from "@/server/equipment";
import type { ServiceActor } from "@/server/actor";

export type ScanFailure = "invalid" | "not_found" | "forbidden";

export type ScanResolution =
  | { ok: true; href: string }
  | { ok: false; reason: ScanFailure };

/**
 * Prøver den eksterne katalogen med den eksakte, normaliserte koden. Returnerer
 * null når koden ikke finnes, slik at kalleren kan beholde resultatet fra vår
 * egen form. En ekstern kode kan aldri skygge for enheten eller oppdraget som
 * ble funnet først.
 */
async function resolveExternalCode(
  actor: ServiceActor,
  value: string,
): Promise<ScanResolution | null> {
  const code = await resolveEquipmentExternalQr(value);
  if (!code) return null;
  const result = await getEquipment(actor, code.productId);
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason === "forbidden" ? "forbidden" : "not_found",
    };
  }
  // Best effort: en treg oppdatering skal aldri forsinke navigeringen.
  void recordEquipmentQrCodeScan(code.id);
  return { ok: true, href: `/enheter/${code.productId}` };
}

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
  const externalValue = normalizeScannedCode(rawCode);

  if (parsed.kind === "equipment-token") {
    const equipment = await resolveEquipmentQrToken(parsed.token);
    if (!equipment) {
      return (
        (await resolveExternalCode(actor, externalValue)) ?? {
          ok: false,
          reason: "not_found",
        }
      );
    }
    const result = await getEquipment(actor, equipment.id);
    if (!result.ok) {
      if (result.reason === "forbidden") {
        return { ok: false, reason: "forbidden" };
      }
      return (
        (await resolveExternalCode(actor, externalValue)) ?? {
          ok: false,
          reason: "not_found",
        }
      );
    }
    return { ok: true, href: `/enheter/${equipment.id}` };
  }

  if (parsed.kind === "equipment-id") {
    const result = await getEquipment(actor, parsed.id);
    if (!result.ok) {
      if (result.reason === "forbidden") {
        return { ok: false, reason: "forbidden" };
      }
      return (
        (await resolveExternalCode(actor, externalValue)) ?? {
          ok: false,
          reason: "not_found",
        }
      );
    }
    return { ok: true, href: `/enheter/${parsed.id}` };
  }

  // Kunders eksisterende QR-koder ligger etter våre egne former. Verdien er
  // opak: vi slår bare opp den normaliserte strengen og autoriserer enheten.
  if (parsed.kind === "external") {
    return (
      (await resolveExternalCode(actor, parsed.value)) ?? {
        ok: false,
        reason: "not_found",
      }
    );
  }

  // Kundeportalen har egne sider og skal ikke kunne skanne seg inn i
  // saksbehandlingen. En ekstern kode som tilfeldigvis ligner en
  // oppdragsreferanse får likevel lov til å peke på en enhet.
  if (!hasPermission(actor, "workorders.view") || actor.role === "CUSTOMER") {
    return (
      (await resolveExternalCode(actor, externalValue)) ?? {
        ok: false,
        reason: "forbidden",
      }
    );
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
  if (!workOrder) {
    return (
      (await resolveExternalCode(actor, externalValue)) ?? {
        ok: false,
        reason: "not_found",
      }
    );
  }

  return {
    ok: true,
    href:
      actor.role === "TECHNICIAN"
        ? `/mine-oppdrag/${workOrder.id}`
        : `/oppdrag/${workOrder.id}`,
  };
}
