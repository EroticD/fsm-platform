import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { moduleApiGuard } from "@/lib/module-guards";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  applyRouteOrder,
  getRoutePlan,
  ROUTE_ERROR_CODES,
  type RoutePlanOverview,
} from "@/server/route-plan";
import type { ServiceFailure } from "@/server/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function serviceError(result: ServiceFailure) {
  const code =
    result.details && typeof result.details === "object"
      ? (result.details as { code?: unknown }).code
      : undefined;
  const messageKey = typeof code === "string" ? code : undefined;
  switch (result.reason) {
    case "forbidden":
      return internalApiError("forbidden", 403);
    case "not_found":
      return internalApiError("not_found", 404, { messageKey });
    case "invalid":
      return internalApiError("invalid_request", 400, { messageKey });
    case "conflict":
      return internalApiError("conflict", 409, {
        messageKey,
        details: result.details,
      });
    case "rate_limited":
      return internalApiError("rate_limited", 429);
    default:
      return internalApiError("server_error", 500);
  }
}

function orderFor(plan: RoutePlanOverview, technicianId: string): string[] | null {
  const row = plan.plans.find(
    (technicianPlan) => technicianPlan.technicianId === technicianId,
  );
  return row ? row.stops.map((stop) => stop.visitId) : null;
}

/**
 * Optimaliserer én montørs dag, eller et utvalg visiter, og returnerer et
 * før/etter-sammendrag. Standard er tørrkjøring: ingenting flyttes uten
 * `apply: true`, og da kreves `workorders.assign` i tillegg. Selve
 * flyttingen går gjennom `applyRouteOrder`, som revisjonslogger hver endring.
 *
 * Ruten er intern og øktbasert. Modulen `calendar` må være på, og
 * trafikkleverandørens nøkkel brukes bare server-side.
 */
export async function POST(request: Request) {
  const moduleGuard = await moduleApiGuard("calendar");
  if (moduleGuard) return moduleGuard;

  if (!assertSameOrigin(request)) {
    return internalApiError("invalid_origin", 403);
  }

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return internalApiError("not_authenticated", 401);
  }

  const canOptimise =
    hasPermission(user, "workorders.update") ||
    hasPermission(user, "workorders.assign") ||
    hasPermission(user, "dispatch.configure");
  if (!canOptimise) return internalApiError("forbidden", 403);

  const limit = await allowRequestDb(`ruteoptimalisering:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return internalApiError("rate_limited", 429, {
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const parsed = await readJsonWithLimit<Record<string, unknown>>(
    request,
    JSON_BODY_LIMIT,
  );
  if (!parsed.ok) {
    return parsed.status === 413
      ? internalApiError("too_large", 413)
      : internalApiError("invalid_data", 400);
  }

  const date = cleanText(parsed.data?.date, { maxLength: 10 });
  if (!DATE_ONLY.test(date)) {
    return internalApiError("invalid_date", 400, {
      messageKey: ROUTE_ERROR_CODES.invalid,
    });
  }

  const technicianId = cleanText(parsed.data?.technicianId, {
    maxLength: LIMITS.line,
  });
  const departmentId = cleanText(parsed.data?.departmentId, {
    maxLength: LIMITS.line,
  });
  const visitIds = Array.isArray(parsed.data?.visitIds)
    ? parsed.data.visitIds
        .map((value) => cleanText(value, { maxLength: LIMITS.line }))
        .filter(Boolean)
        .slice(0, 50)
    : undefined;
  const apply = parsed.data?.apply === true;

  if (apply) {
    if (!hasPermission(user, "workorders.assign")) {
      return internalApiError("forbidden", 403);
    }
    if (!technicianId) {
      return internalApiError("missing_field", 400);
    }
  }

  const plan = await getRoutePlan(user, {
    date,
    technicianId: technicianId || undefined,
    departmentId: departmentId || undefined,
    visitIds,
  });
  if (!plan.ok) return serviceError(plan);

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      applied: 0,
      ...plan.data,
    });
  }

  const order = orderFor(plan.data, technicianId);
  if (!order || order.length === 0) {
    return internalApiError("not_found", 404);
  }

  const applied = await applyRouteOrder(user, {
    date,
    technicianId,
    visitIds: order,
  });
  if (!applied.ok) return serviceError(applied);

  return NextResponse.json({
    dryRun: false,
    applied: applied.data.applied,
    ...plan.data,
  });
}
