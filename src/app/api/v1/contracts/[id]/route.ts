import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { toDateOnly } from "@/lib/dates";
import {
  getContract,
  updateContract,
  type ContractCreateInput,
  type ContractDetail,
} from "@/server/contracts";

export const runtime = "nodejs";

const PATCH_FIELDS = new Set([
  "title",
  "contractNumber",
  "startDate",
  "endDate",
  "intervalMonths",
  "departmentId",
  "contactId",
  "templateId",
  "slaPolicyId",
  "priceListId",
  "status",
  "renewalMode",
  "noticeDays",
  "indexationPercent",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(reason: string) {
  switch (reason) {
    case "forbidden":
      return apiError("forbidden", 403, {
        messageKey: "errors.api.forbidden",
      });
    case "not_found":
      return apiError("not_found", 404, {
        messageKey: "errors.api.notFound",
      });
    case "conflict":
      return apiError("conflict", 409, {
        messageKey: "errors.api.conflict",
      });
    case "invalid":
      return apiError("validation_error", 422, {
        messageKey: "errors.api.validation",
      });
    default:
      return apiError("server_error", 500, {
        messageKey: "errors.api.serverError",
      });
  }
}

function amount(value: { toString(): string } | number): string {
  return Number(value.toString()).toFixed(2);
}

function serializeDetail(contract: ContractDetail) {
  return {
    id: contract.id,
    title: contract.title,
    contractNumber: contract.contractNumber,
    status: contract.status,
    startDate: toDateOnly(contract.startDate),
    endDate: contract.endDate ? toDateOnly(contract.endDate) : null,
    nextServiceDate: toDateOnly(contract.nextServiceDate),
    intervalMonths: contract.intervalMonths,
    renewalMode: contract.renewalMode,
    noticeDays: contract.noticeDays,
    indexationPercent:
      contract.indexationPercent === null
        ? null
        : Number(contract.indexationPercent),
    isActive: contract.isActive,
    customer: contract.customer,
    department: contract.department,
    contact: contract.contact,
    template: contract.template,
    slaPolicy: contract.slaPolicy,
    priceList: contract.priceList
      ? {
          id: contract.priceList.id,
          name: contract.priceList.name,
          items: contract.priceList.items.map((item) => ({
            id: item.id,
            code: item.code,
            label: item.label,
            unit: item.unit,
            amount: amount(item.amount),
          })),
        }
      : null,
    lines: contract.lines.map((line) => ({
      id: line.id,
      product: line.product,
      scope: line.scope,
      visitsPerYear: line.visitsPerYear,
      responseMinutes: line.responseMinutes,
      resolutionMinutes: line.resolutionMinutes,
    })),
    workOrders: contract.workOrders.map((order) => ({
      id: order.id,
      title: order.title,
      status: order.status,
      scheduledFor: order.scheduledFor
        ? toDateOnly(order.scheduledFor)
        : null,
    })),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (
    !hasPermission(auth.actor, "contracts.view") &&
    !hasPermission(auth.actor, "contracts.manage")
  ) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.forbidden",
    });
  }

  const { id } = await params;
  const result = await getContract(auth.actor, id);
  if (!result.ok) return contractError(result.reason);

  return apiJson(serializeDetail(result.data.contract));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "contracts.manage")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.forbidden",
    });
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError("validation_error", 413, {
          messageKey: "errors.api.tooLarge",
        })
      : apiError("validation_error", 400, {
          messageKey: "errors.api.invalidJson",
        });
  }
  if (!isRecord(parsed.data)) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.invalidData",
    });
  }

  const unknownField = Object.keys(parsed.data).find(
    (key) => !PATCH_FIELDS.has(key),
  );
  if (unknownField) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.validation",
      details: { field: unknownField },
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.missingField",
    });
  }

  const { id } = await params;
  const result = await updateContract(
    auth.actor,
    id,
    parsed.data as ContractCreateInput,
  );
  if (!result.ok) return contractError(result.reason);

  return apiJson({ id });
}
