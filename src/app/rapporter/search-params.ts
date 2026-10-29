import { Prisma } from "@prisma/client";
import { reportWhereFor, type ReportRange } from "@/lib/report-filters";

/**
 * URL- og databasespørring for rapportlisten.
 *
 * Alle verdier valideres mot en allowlist før de brukes. Filtreringen legges
 * alltid oppå `reportWhereFor`, slik at slettede rapporter, avdelingsoppdragets
 * `deletedAt` og montørenes kanselleringsregler ikke kan overstyres fra URL-en.
 */

/** Rapporter per side. Listen kan bla gjennom hele historikken. */
export const REPORTS_PAGE_SIZE = 20;

export const REPORT_RANGE_KEYS = [
  "denne-maneden",
  "forrige-maned",
  "alle",
] as const;

export type ReportRangeKey = (typeof REPORT_RANGE_KEYS)[number];

export const REPORT_SORT_KEYS = [
  "dato-desc",
  "dato-asc",
  "kunde",
  "montor",
] as const;

export type ReportSortKey = (typeof REPORT_SORT_KEYS)[number];

export type ReportListFilters = {
  range: ReportRangeKey;
  category?: "HMS";
  customer?: string;
  technician?: string;
  deviationOnly: boolean;
  q: string;
  sort: ReportSortKey;
};

export type ReportListParams = ReportListFilters & {
  page: number;
};

const MAX_QUERY_LENGTH = 100;
const MAX_FILTER_VALUE_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type ParamInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function readFirst(params: ParamInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined;
  }
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Id-er er cuid-er i dag, men vi godtar også tall og bindestrek. */
function safeId(value: string | undefined): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.length > MAX_FILTER_VALUE_LENGTH) return undefined;
  return ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function isReportRange(value: string | undefined): value is ReportRangeKey {
  return REPORT_RANGE_KEYS.includes(value as ReportRangeKey);
}

export function isReportSort(value: string | undefined): value is ReportSortKey {
  return REPORT_SORT_KEYS.includes(value as ReportSortKey);
}

/** Leser og validerer alle filterparametrene. Ukjente verdier ignoreres. */
export function parseReportListParams(params: ParamInput): ReportListParams {
  const vis = readFirst(params, "vis");
  const type = readFirst(params, "type");
  const sort = readFirst(params, "sorter");
  const side = Number.parseInt(String(readFirst(params, "side") ?? ""), 10);

  return {
    range: isReportRange(vis) ? vis : "denne-maneden",
    category: type === "HMS" ? "HMS" : undefined,
    customer: safeId(readFirst(params, "kunde")),
    technician: safeId(readFirst(params, "montor")),
    deviationOnly: readFirst(params, "avvik") === "1",
    q: String(readFirst(params, "q") ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH),
    sort: isReportSort(sort) ? sort : "dato-desc",
    page: Number.isFinite(side) && side >= 1 ? side : 1,
  };
}

/**
 * Filteret for listen. `reportWhereFor` står for tidsrom, kategori, sletting og
 * montør-/kanselleringsregelen; de ekstra filtrene legges ved siden av.
 * `workOrderScope` er rapportomfanget for aktøren, slik at ansatte uten
 * `reports.viewAllDepartments` bare ser egen avdeling.
 */
export function reportListWhere(
  filters: ReportListFilters,
  excludeCancelled = false,
  workOrderScope?: Prisma.WorkOrderWhereInput,
): Prisma.ReportWhereInput {
  const extra: Prisma.ReportWhereInput[] = [];

  if (workOrderScope && Object.keys(workOrderScope).length > 0) {
    extra.push({ workOrder: workOrderScope });
  }

  if (filters.customer) {
    extra.push({ workOrder: { customerId: filters.customer } });
  }

  if (filters.technician) {
    extra.push({
      workOrder: { technicians: { some: { id: filters.technician } } },
    });
  }

  if (filters.deviationOnly) {
    // En rapport uten enheter har ingen avvik å filtrere på.
    extra.push({ requiresUnits: true, units: { some: { status: "AVVIK" } } });
  }

  if (filters.q) {
    const contains = {
      contains: filters.q,
      mode: "insensitive" as const,
    };
    extra.push({
      OR: [
        { name: contains },
        { templateTitle: contains },
        { reportNumber: contains },
        { comments: contains },
        { technicianName: contains },
        { workOrder: { title: contains } },
        { workOrder: { orderNumber: contains } },
        { workOrder: { customer: { name: contains } } },
      ],
    });
  }

  return {
    AND: [
      reportWhereFor(
        filters.range as ReportRange,
        excludeCancelled,
        filters.category,
      ),
      ...extra,
    ],
  };
}

/** Sortering med en stabil id som siste nøkkel, slik at sider ikke hopper. */
export function reportListOrderBy(
  sort: ReportSortKey,
): Prisma.ReportOrderByWithRelationInput[] {
  switch (sort) {
    case "dato-asc":
      return [{ completedAt: "asc" }, { id: "asc" }];
    case "kunde":
      return [
        { workOrder: { customer: { name: "asc" } } },
        { completedAt: "desc" },
        { id: "asc" },
      ];
    case "montor":
      return [
        { technicianName: "asc" },
        { completedAt: "desc" },
        { id: "asc" },
      ];
    default:
      return [{ completedAt: "desc" }, { id: "asc" }];
  }
}

export type ReportListHrefInput = {
  filters: ReportListFilters;
  overrides?: Partial<ReportListFilters>;
  page?: number;
};

/**
 * Bygger en /rapporter-lenke. Endring av filter nullstiller siden fordi
 * `page` bare tas med når den er større enn 1.
 */
export function reportListHref({
  filters,
  overrides,
  page,
}: ReportListHrefInput): string {
  const next: ReportListFilters = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (next.range !== "denne-maneden") params.set("vis", next.range);
  if (next.category) params.set("type", next.category);
  if (next.customer) params.set("kunde", next.customer);
  if (next.technician) params.set("montor", next.technician);
  if (next.deviationOnly) params.set("avvik", "1");
  if (next.q) params.set("q", next.q);
  if (next.sort !== "dato-desc") params.set("sorter", next.sort);
  if (page && page > 1) params.set("side", String(page));

  const query = params.toString();
  return query ? `/rapporter?${query}` : "/rapporter";
}
