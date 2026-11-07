import type { NextRequest } from "next/server";
import {
  guardTransferRoute,
  requireSameOrigin,
  transferJson,
  transferRateLimit,
  transferFailureResponse,
} from "@/lib/customer-transfer/http";
import {
  EXPORT_RATE_LIMIT,
  exportRateLimitKey,
  normaliseExportOptions,
} from "@/lib/customer-transfer/export-request";
import {
  exportCustomerPackage,
  findReusableExport,
} from "@/server/customer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportBody = {
  customerIds?: unknown;
  includeFiles?: unknown;
  includeDeleted?: unknown;
  includeLegalHold?: unknown;
  includeAudit?: unknown;
  includeSignatures?: unknown;
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export async function POST(request: NextRequest) {
  const guard = await guardTransferRoute();
  if (!guard.ok) return guard.response;
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return transferJson(
      { error: "invalid_json", messageKey: "errors.api.invalidJson" },
      { status: 400 },
    );
  }

  if (
    !Array.isArray(body.customerIds) ||
    body.customerIds.some((id) => typeof id !== "string")
  ) {
    return transferJson(
      { error: "validation_error", messageKey: "errors.customerTransfer.noCustomers" },
      { status: 400 },
    );
  }

  const options = normaliseExportOptions({
    customerIds: body.customerIds as string[],
    includeFiles: bool(body.includeFiles, true),
    includeDeleted: bool(body.includeDeleted, false),
    includeLegalHold: bool(body.includeLegalHold, false),
    includeAudit: bool(body.includeAudit, true),
    includeSignatures: bool(body.includeSignatures, false),
  });

  // Idempotens før telleren: et dobbeltklikk eller en automatisk retry skal
  // returnere den nylige jobben uten å spise av rate-limit-budsjettet.
  const reusable = await findReusableExport(guard.actor, options);
  if (!reusable.ok) return transferFailureResponse(reusable);
  if (reusable.data) {
    return transferJson(reusable.data, { status: 200 });
  }

  const limited = await transferRateLimit(
    exportRateLimitKey(guard.actor.id),
    EXPORT_RATE_LIMIT.limit,
    EXPORT_RATE_LIMIT.windowMs,
  );
  if (limited) return limited;

  // Selve pakkebyggingen skjer i den vedvarende workeren. Ruten returnerer en
  // jobb med en gang; klienten poller statusruten og laster ned når READY.
  const result = await exportCustomerPackage(guard.actor, options, {
    mode: "queue",
  });
  if (!result.ok) return transferFailureResponse(result);
  const ready = result.data.status === "READY";
  return transferJson(result.data, {
    status: result.data.reused ? 200 : ready ? 201 : 202,
  });
}
