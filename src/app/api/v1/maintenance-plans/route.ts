// i18n-ignore-file: API v1 beholder den eksisterende kontrakten med korte
// norske meldinger ved siden av stabile maskinlesbare koder i error.details.code.
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  createMaintenancePlan,
  listMaintenancePlans,
} from "@/server/maintenance";
import {
  dateOnly,
  decimalString,
  equipmentApiError,
  isRecord,
} from "../equipment/_shared";

export const runtime = "nodejs";

type MaintenancePlanItem = Extract<
  Awaited<ReturnType<typeof listMaintenancePlans>>,
  { ok: true }
>["data"]["items"][number];

function toPlan(plan: MaintenancePlanItem) {
  return {
    id: plan.id,
    title: plan.title,
    trigger: plan.trigger,
    intervalMonths: plan.intervalMonths,
    meterInterval: decimalString(plan.meterInterval),
    leadDays: plan.leadDays,
    nextDueDate: dateOnly(plan.nextDueDate),
    isActive: plan.isActive,
    product: plan.product,
    customer: plan.customer,
    department: plan.department,
    template: plan.template,
    occurrences: plan.occurrences.map((occurrence) => ({
      id: occurrence.id,
      dueDate: dateOnly(occurrence.dueDate),
      status: occurrence.status,
      workOrderId: occurrence.workOrderId,
      meterValue: decimalString(occurrence.meterValue),
    })),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/** Vedlikeholdsplaner på tvers av enheter og kunder. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.view")) {
    return apiError(
      403,
      "forbidden",
      "Du har ikke tilgang til vedlikeholdsplaner.",
    );
  }

  const url = new URL(request.url);
  const { page, limit } = parseApiPagination(url);
  const activeParam = url.searchParams.get("active");
  const result = await listMaintenancePlans(auth.actor, {
    productId: url.searchParams.get("productId") ?? undefined,
    customerId: url.searchParams.get("customerId") ?? undefined,
    trigger: url.searchParams.get("trigger") ?? undefined,
    active:
      activeParam === null
        ? undefined
        : activeParam === "true" || activeParam === "1",
    page,
    limit,
  });
  if (!result.ok) return equipmentApiError(result);

  return apiJson(
    result.data.items.map(toPlan),
    paginationMeta(result.data.total, result.data.page, result.data.pageSize),
  );
}

const CREATE_FIELDS = new Set([
  "title",
  "trigger",
  "productId",
  "customerId",
  "departmentId",
  "templateId",
  "intervalMonths",
  "meterInterval",
  "leadDays",
  "nextDueDate",
]);

/** Oppretter en kalender- eller målerbasert vedlikeholdsplan. */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.manage")) {
    return apiError(
      403,
      "forbidden",
      "Du har ikke tilgang til å opprette vedlikeholdsplaner.",
    );
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError(413, "validation_error", "Forespørselen er for stor.")
      : apiError(422, "validation_error", "Ugyldig JSON.");
  }
  if (!isRecord(parsed.data)) {
    return apiError(422, "validation_error", "Forventet et JSON-objekt.");
  }
  for (const key of Object.keys(parsed.data)) {
    if (!CREATE_FIELDS.has(key)) {
      return apiError(422, "validation_error", `Ukjent felt: ${key}.`);
    }
  }

  const result = await createMaintenancePlan(auth.actor, parsed.data);
  if (!result.ok) return equipmentApiError(result);

  return apiJson({ id: result.data.id }, 201);
}
