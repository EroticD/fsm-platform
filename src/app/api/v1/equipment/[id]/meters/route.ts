// i18n-ignore-file: API v1 beholder den eksisterende kontrakten med korte
// norske meldinger ved siden av stabile maskinlesbare koder i error.details.code.
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { addMeterReading, listMeterReadings } from "@/server/equipment";
import {
  decimalString,
  equipmentApiError,
  isRecord,
} from "../../_shared";

export const runtime = "nodejs";

/** Målinger for én enhet, nyeste først. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til målinger.");
  }

  const { id } = await params;
  const url = new URL(request.url);
  const { page, limit } = parseApiPagination(url);
  const result = await listMeterReadings(auth.actor, id, { page, limit });
  if (!result.ok) return equipmentApiError(result);

  return apiJson(
    result.data.items.map((reading) => ({
      id: reading.id,
      productId: reading.productId,
      value: decimalString(reading.value),
      readAt: reading.readAt.toISOString(),
      source: reading.source,
      note: reading.note,
      user: reading.user,
      createdAt: reading.createdAt.toISOString(),
    })),
    paginationMeta(
      result.data.total,
      result.data.page,
      result.data.pageSize,
    ),
  );
}

const METER_FIELDS = new Set(["value", "readAt", "source", "note", "visitId"]);

/** Registrerer en måling. En terskel kan utløse ett vedlikeholdsoppdrag. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "equipment.manage")) {
    return apiError(
      403,
      "forbidden",
      "Du har ikke tilgang til å registrere målinger.",
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
    if (!METER_FIELDS.has(key)) {
      return apiError(422, "validation_error", `Ukjent felt: ${key}.`);
    }
  }

  const { id } = await params;
  const result = await addMeterReading(auth.actor, id, parsed.data);
  if (!result.ok) return equipmentApiError(result);

  return apiJson({ id: result.data.id }, 201);
}
