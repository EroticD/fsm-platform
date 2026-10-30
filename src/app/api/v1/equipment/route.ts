// i18n-ignore-file: API v1 beholder den eksisterende kontrakten med korte
// norske meldinger ved siden av stabile maskinlesbare koder i error.details.code.
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  createEquipment,
  listEquipment,
  type EquipmentListData,
} from "@/server/equipment";
import {
  dateOnly,
  equipmentApiError,
  isRecord,
} from "./_shared";

export const runtime = "nodejs";

function toSummary(item: EquipmentListData["items"][number]) {
  return {
    id: item.id,
    model: item.model,
    serialNumber: item.serialNumber,
    location: item.location,
    status: item.status,
    criticality: item.criticality,
    meterUnit: item.meterUnit,
    installDate: dateOnly(item.installDate),
    warrantyUntil: dateOnly(item.warrantyUntil),
    qrToken: item.qrToken,
    customer: item.customer,
    category: item.category,
    parent: item.parent,
    counts: {
      children: item._count.children,
      meterReadings: item._count.meterReadings,
      maintenancePlans: item._count.maintenancePlans,
      reports: item._count.reportUnits,
      workOrders: item._count.workOrder,
    },
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

/**
 * Utstyrsregisteret. Søket dekker modell, serienummer, plassering og kunde.
 * Alle filtre kombineres med AND, og `categoryId` tar med hele undertreet.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.view")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.equipment.forbidden",
    });
  }

  const url = new URL(request.url);
  const { page, limit } = parseApiPagination(url);
  const result = await listEquipment(auth.actor, {
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    categoryId: url.searchParams.get("categoryId") ?? undefined,
    customerId: url.searchParams.get("customerId") ?? undefined,
    parentId: url.searchParams.has("parentId")
      ? (url.searchParams.get("parentId") || null)
      : undefined,
    page,
    limit,
  });
  if (!result.ok) return equipmentApiError(result);

  return apiJson(
    result.data.items.map(toSummary),
    paginationMeta(result.data.total, result.data.page, result.data.pageSize),
  );
}

const CREATE_FIELDS = new Set([
  "customerId",
  "model",
  "serialNumber",
  "location",
  "categoryId",
  "parentId",
  "installDate",
  "warrantyUntil",
  "status",
  "criticality",
  "meterUnit",
]);

/** Registrerer en ny enhet. Krever `equipment.manage`. */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.manage")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.equipment.createForbidden",
    });
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError("validation_error", 413, {
        messageKey: "errors.api.tooLarge",
      })
      : apiError("validation_error", 422, {
        messageKey: "errors.api.invalidJson",
      });
  }
  if (!isRecord(parsed.data)) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.equipment.bodyObject",
    });
  }
  for (const key of Object.keys(parsed.data)) {
    if (!CREATE_FIELDS.has(key)) {
      return apiError("validation_error", 422, {
        messageKey: "errors.api.equipment.unknownField",
        details: { field: key },
      });
    }
  }

  const result = await createEquipment(auth.actor, parsed.data);
  if (!result.ok) return equipmentApiError(result);

  return apiJson({ id: result.data.id }, 201);
}
