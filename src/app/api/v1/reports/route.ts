import type { Prisma } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { reportWorkOrderScope } from "@/lib/report-scope";

export const runtime = "nodejs";

const MAX_QUERY_LENGTH = 100;

type ParsedDay =
  | { valid: true; date: Date }
  | { valid: false };

/**
 * Leser en kalenderdato (`YYYY-MM-DD`) som et avgrenset døgn i UTC.
 *
 * `dateFrom` tar starten av dagen og `dateTo` tar starten av neste dag, slik
 * at `dateTo=2026-10-30` også omfatter rapporter fullført senere samme dag.
 */
function parseDay(value: string, endOfDay: boolean): ParsedDay {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { valid: false };

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { valid: false };
  if (date.toISOString().slice(0, 10) !== trimmed) return { valid: false };
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return { valid: true, date };
}

function readBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

/** Rapporter for API-klienter, avgrenset av aktørens rapportomfang. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "reports.view")) {
    return apiError("forbidden", 403, { messageKey: "errors.api.reports.forbidden" });
  }

  const url = new URL(request.url);
  const { page, limit, skip } = parseApiPagination(url);
  const params = url.searchParams;

  const query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const customerId = (params.get("customerId") ?? "").trim();
  const workOrderId = (params.get("workOrderId") ?? "").trim();

  const completedAt: Prisma.DateTimeFilter = {};
  // `dateFrom`/`dateTo` er det dokumenterte API-navnet. `from`/`to` beholdes
  // som kortform for eldre klienter.
  const fromKey = params.has("dateFrom")
    ? "dateFrom"
    : params.has("from")
      ? "from"
      : null;
  const from = fromKey ? params.get(fromKey) : null;
  if (from !== null && from.trim()) {
    const parsed = parseDay(from, false);
    if (!parsed.valid) {
      return apiError("validation_error", 400, { messageKey: "errors.api.workOrders.invalidFromDate", details: {
        field: fromKey,
      } });
    }
    completedAt.gte = parsed.date;
  }
  const toKey = params.has("dateTo")
    ? "dateTo"
    : params.has("to")
      ? "to"
      : null;
  const to = toKey ? params.get(toKey) : null;
  if (to !== null && to.trim()) {
    const parsed = parseDay(to, true);
    if (!parsed.valid) {
      return apiError("validation_error", 400, { messageKey: "errors.api.workOrders.invalidToDate", details: {
        field: toKey,
      } });
    }
    completedAt.lt = parsed.date;
  }

  const lockedRaw = params.get("locked");
  const locked = lockedRaw === null || !lockedRaw.trim()
    ? undefined
    : readBoolean(lockedRaw);
  if (locked === null) {
    return apiError("validation_error", 400, { messageKey: "errors.api.reports.invalidLocked", details: {
      field: "locked",
    } });
  }

  const acknowledgedRaw = params.get("acknowledged");
  const acknowledged = acknowledgedRaw === null || !acknowledgedRaw.trim()
    ? undefined
    : readBoolean(acknowledgedRaw);
  if (acknowledged === null) {
    return apiError("validation_error", 400, { messageKey: "errors.api.reports.invalidAcknowledged", details: { field: "acknowledged" } });
  }

  // Omfanget legges som én egen AND-gren. Da kan ikke et filter på
  // oppdrags-id eller kunde overstyre en tom avdelingssperre.
  const workOrderFilters: Prisma.WorkOrderWhereInput[] = [
    reportWorkOrderScope(auth.actor),
    { deletedAt: null },
  ];
  if (customerId) workOrderFilters.push({ customerId });
  if (workOrderId) workOrderFilters.push({ id: workOrderId });

  const where: Prisma.ReportWhereInput = {
    deletedAt: null,
    workOrder: { AND: workOrderFilters },
  };

  if (locked !== undefined) where.isLocked = locked;
  if (acknowledged !== undefined) {
    where.customerAcknowledgedAt = acknowledged ? { not: null } : null;
  }
  if (completedAt.gte || completedAt.lt) where.completedAt = completedAt;

  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    where.OR = [
      { name: contains },
      { templateTitle: contains },
      { reportNumber: contains },
      { workOrder: { title: contains } },
      { workOrder: { orderNumber: contains } },
    ];
  }

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        reportNumber: true,
        completedAt: true,
        isLocked: true,
        customerAcknowledgedAt: true,
        technicianName: true,
        workOrder: {
          select: {
            id: true,
            title: true,
            customer: { select: { id: true, name: true } },
          },
        },
        _count: { select: { units: true } },
      },
    }),
  ]);

  const data = reports.map(({ _count, ...report }) => ({
    ...report,
    unitsCount: _count.units,
  }));

  return apiJson(data, paginationMeta(total, page, limit));
}
