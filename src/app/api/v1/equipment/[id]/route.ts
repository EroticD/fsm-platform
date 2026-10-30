// i18n-ignore-file: API v1 beholder den eksisterende kontrakten med korte
// norske meldinger ved siden av stabile maskinlesbare koder i error.details.code.
import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  getEquipment,
  updateEquipment,
  type EquipmentDetailData,
} from "@/server/equipment";
import {
  dateOnly,
  decimalString,
  equipmentApiError,
  hasOwn,
  isRecord,
} from "../_shared";

export const runtime = "nodejs";

function toDetail(data: EquipmentDetailData) {
  const equipment = data.equipment;
  return {
    id: equipment.id,
    model: equipment.model,
    serialNumber: equipment.serialNumber,
    location: equipment.location,
    status: equipment.status,
    criticality: equipment.criticality,
    meterUnit: equipment.meterUnit,
    installDate: dateOnly(equipment.installDate),
    warrantyUntil: dateOnly(equipment.warrantyUntil),
    warrantyNotifiedAt: equipment.warrantyNotifiedAt?.toISOString() ?? null,
    qrToken: equipment.qrToken,
    customer: equipment.customer,
    category: equipment.category,
    parent: equipment.parent,
    ancestors: data.ancestors,
    children: equipment.children.map((child) => ({
      id: child.id,
      model: child.model,
      serialNumber: child.serialNumber,
      location: child.location,
      status: child.status,
      criticality: child.criticality,
      counts: {
        children: child._count.children,
        meterReadings: child._count.meterReadings,
      },
    })),
    counts: {
      children: equipment._count.children,
      meterReadings: equipment._count.meterReadings,
      maintenancePlans: equipment._count.maintenancePlans,
      reports: equipment._count.reportUnits,
      workOrders: equipment._count.workOrder,
    },
    meterReadings: equipment.meterReadings.map((reading) => ({
      id: reading.id,
      value: decimalString(reading.value),
      readAt: reading.readAt.toISOString(),
      source: reading.source,
      note: reading.note,
      user: reading.user,
      createdAt: reading.createdAt.toISOString(),
    })),
    maintenancePlans: equipment.maintenancePlans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      trigger: plan.trigger,
      intervalMonths: plan.intervalMonths,
      meterInterval: decimalString(plan.meterInterval),
      leadDays: plan.leadDays,
      nextDueDate: dateOnly(plan.nextDueDate),
      isActive: plan.isActive,
      occurrences: plan.occurrences.map((occurrence) => ({
        id: occurrence.id,
        dueDate: dateOnly(occurrence.dueDate),
        status: occurrence.status,
        workOrderId: occurrence.workOrderId,
        meterValue: decimalString(occurrence.meterValue),
      })),
    })),
    documents: data.uploads.map((upload) => ({
      id: upload.id,
      fileName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.size,
      url: `/uploads/${upload.storedName}`,
      createdAt: upload.createdAt.toISOString(),
    })),
    recentWorkOrders: equipment.workOrder.map((order) => ({
      id: order.id,
      title: order.title,
      status: order.status,
      scheduledFor: dateOnly(order.scheduledFor),
      createdAt: order.createdAt.toISOString(),
    })),
    recentReports: equipment.reportUnits.map((unit) => ({
      id: unit.id,
      status: unit.status,
      createdAt: unit.createdAt.toISOString(),
      reportId: unit.report.id,
      workOrderId: unit.report.workOrderId,
      workOrderTitle: unit.report.workOrder.title,
      scheduledFor: dateOnly(unit.report.workOrder.scheduledFor),
      template: unit.report.template?.title ?? null,
    })),
    createdAt: equipment.createdAt.toISOString(),
    updatedAt: equipment.updatedAt.toISOString(),
  };
}

/** Én enhet med målinger, planer, dokumenter og avgrenset historikk. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.view")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.equipment.forbidden",
    });
  }

  const { id } = await params;
  const result = await getEquipment(auth.actor, id);
  if (!result.ok) return equipmentApiError(result);

  return apiJson(toDetail(result.data));
}

const PATCH_FIELDS = new Set([
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

/**
 * Oppdaterer en enhet. `categoryId`, `parentId` og datofeltene kan settes til
 * null for å fjerne verdien. Flytting kontrolleres for sykluser i tjenesten.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.manage")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.equipment.updateForbidden",
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
  if (Object.keys(parsed.data).length === 0) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.equipment.noFields",
    });
  }
  for (const key of Object.keys(parsed.data)) {
    if (!PATCH_FIELDS.has(key)) {
      return apiError("validation_error", 422, {
        messageKey: "errors.api.equipment.unknownField",
        details: { field: key },
      });
    }
  }

  const { id } = await params;
  const input: Record<string, unknown> = { id };
  for (const key of PATCH_FIELDS) {
    if (hasOwn(parsed.data, key)) input[key] = parsed.data[key];
  }

  const result = await updateEquipment(auth.actor, input);
  if (!result.ok) return equipmentApiError(result);

  return apiJson({ id: result.data.id });
}
