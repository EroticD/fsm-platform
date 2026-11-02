import type { NextRequest } from "next/server";
import {
  guardTransferRoute,
  requireSameOrigin,
  transferJson,
  transferRateLimit,
  transferFailureResponse,
} from "@/lib/customer-transfer/http";
import { exportCustomerPackage } from "@/server/customer-transfer";

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

  const limited = await transferRateLimit(
    `customer-transfer-export:${guard.actor.id}`,
    3,
    60 * 60 * 1000,
  );
  if (limited) return limited;

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

  const result = await exportCustomerPackage(guard.actor, {
    customerIds: body.customerIds as string[],
    includeFiles: bool(body.includeFiles, true),
    includeDeleted: bool(body.includeDeleted, false),
    includeLegalHold: bool(body.includeLegalHold, false),
    includeAudit: bool(body.includeAudit, true),
    includeSignatures: bool(body.includeSignatures, false),
  });
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data, { status: 201 });
}
