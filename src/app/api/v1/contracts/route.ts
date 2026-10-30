import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { toDateOnly } from "@/lib/dates";
import {
  createContract,
  isContractStatus,
  listContracts,
  type ContractCreateInput,
} from "@/server/contracts";

export const runtime = "nodejs";

const CREATE_FIELDS = new Set([
  "customerId",
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
  "lines",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(reason: string) {
  switch (reason) {
    case "forbidden":
      return apiError(403, "forbidden", "Du har ikke tilgang til avtaler.");
    case "not_found":
      return apiError(404, "not_found", "Fant ikke avtalen.");
    case "conflict":
      return apiError(409, "conflict", "Avtalenummeret er allerede i bruk.");
    case "invalid":
      return apiError(422, "validation_error", "Feltene er ikke gyldige.");
    default:
      return apiError(500, "server_error", "Kunne ikke lagre avtalen.");
  }
}

function serializeContract(row: {
  id: string;
  title: string;
  contractNumber: string | null;
  status: string;
  startDate: Date;
  endDate: Date | null;
  nextServiceDate: Date;
  intervalMonths: number;
  renewalMode: string;
  noticeDays: number;
  customer: { id: string; name: string };
  department: { id: string; name: string };
  slaPolicy: { id: string; name: string } | null;
  priceList: { id: string; name: string } | null;
  _count: { lines: number; workOrders: number };
}) {
  return {
    id: row.id,
    title: row.title,
    contractNumber: row.contractNumber,
    status: row.status,
    startDate: toDateOnly(row.startDate),
    endDate: row.endDate ? toDateOnly(row.endDate) : null,
    nextServiceDate: toDateOnly(row.nextServiceDate),
    intervalMonths: row.intervalMonths,
    renewalMode: row.renewalMode,
    noticeDays: row.noticeDays,
    customer: row.customer,
    department: row.department,
    slaPolicy: row.slaPolicy,
    priceList: row.priceList,
    lineCount: row._count.lines,
    workOrderCount: row._count.workOrders,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (
    !hasPermission(auth.actor, "contracts.view") &&
    !hasPermission(auth.actor, "contracts.manage")
  ) {
    return apiError(403, "forbidden", "Du har ikke tilgang til avtaler.");
  }

  const url = new URL(request.url);
  const { page, limit } = parseApiPagination(url);
  const statusRaw = (url.searchParams.get("status") ?? "").trim();
  if (statusRaw && !isContractStatus(statusRaw)) {
    return apiError(400, "validation_error", "Ugyldig statusfilter.", {
      field: "status",
    });
  }
  const expiringRaw = (url.searchParams.get("expiringDays") ?? "").trim();
  const expiringDays = expiringRaw ? Number(expiringRaw) : null;
  if (
    expiringRaw &&
    (!Number.isInteger(expiringDays) ||
      (expiringDays as number) <= 0 ||
      (expiringDays as number) > 3650)
  ) {
    return apiError(400, "validation_error", "Ugyldig utløpsfilter.", {
      field: "expiringDays",
    });
  }

  const result = await listContracts(auth.actor, {
    status: statusRaw || null,
    customerId: url.searchParams.get("customerId"),
    expiringDays,
    query: url.searchParams.get("q"),
    page,
    pageSize: limit,
  });
  if (!result.ok) return contractError(result.reason);

  return apiJson(
    result.data.contracts.map(serializeContract),
    paginationMeta(result.data.total, page, limit),
  );
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "contracts.manage")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til å endre avtaler.");
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError(413, "validation_error", "Forespørselen er for stor.")
      : apiError(400, "validation_error", "Ugyldig JSON.");
  }
  if (!isRecord(parsed.data)) {
    return apiError(400, "validation_error", "Body må være et JSON-objekt.");
  }

  const unknownField = Object.keys(parsed.data).find(
    (key) => !CREATE_FIELDS.has(key),
  );
  if (unknownField) {
    return apiError(400, "validation_error", "Ukjent felt.", {
      field: unknownField,
    });
  }

  const customerId =
    typeof parsed.data.customerId === "string"
      ? parsed.data.customerId.trim()
      : "";
  if (!customerId) {
    return apiError(422, "validation_error", "customerId er påkrevd.", {
      field: "customerId",
    });
  }

  const result = await createContract(
    auth.actor,
    customerId,
    parsed.data as ContractCreateInput,
  );
  if (!result.ok) return contractError(result.reason);

  const response = apiJson({ id: result.data.id }, 201);
  response.headers.set("Location", `/api/v1/contracts/${result.data.id}`);
  return response;
}
