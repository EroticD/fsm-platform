import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { normalizeSearchText } from "@/lib/fuzzy";
import { parseSearchFilters, type SearchFilters } from "@/lib/search-filters";
import { redactSearchQuery } from "@/lib/search-analytics-redact";
import { can, fail, isAdminActor, ok, type ServiceActor, type ServiceResult } from "./actor";

/**
 * Intern søkeanalyse.
 *
 * Logging er «best effort»: en feil i analyseinnsettingen skal aldri gjøre at
 * selve søket feiler. Analysen er bare tilgjengelig for brukere med
 * `audit.view` eller administrator. Søketeksten maskeres før lagring, og
 * loggen kobles aldri til brukeren som søkte.
 */

const MAX_QUERY_LENGTH = 100;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;
const TOP_QUERY_LIMIT = 10;

export type SearchLogInput = {
  query: string;
  resultCount: number;
  latencyMs: number;
  filters?: SearchFilters | null;
};

export type TopQuery = { query: string; count: number };
export type DailySearchSeries = {
  date: string;
  count: number;
  zeroResultCount: number;
};

export type SearchAnalytics = {
  days: number;
  totalSearches: number;
  zeroResultCount: number;
  zeroResultRate: number;
  averageLatencyMs: number;
  topQueries: TopQuery[];
  topZeroResultQueries: TopQuery[];
  daily: DailySearchSeries[];
};

/** Skriver én søkelogg. Feiler stille, og kapper query/filtre. */
export async function logSearch(input: SearchLogInput): Promise<void> {
  // Masker personopplysninger før teksten havner i databasen. Normaliseringen
  // gjøres etter maskeringen, slik at e-post og telefonnummer ikke kan snike
  // seg inn via en ferdig normalisert variant.
  const query = redactSearchQuery(String(input.query ?? ""))
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
  if (!query) return;

  const filters = parseSearchFilters(
    (input.filters ?? {}) as Record<string, string | string[] | undefined>,
  );
  const hasFilters = Object.keys(filters).length > 0;

  try {
    await prisma.searchLog.create({
      data: {
        query,
        normalizedQuery: normalizeSearchText(query).slice(0, MAX_QUERY_LENGTH),
        resultCount: Math.max(0, Math.trunc(Number(input.resultCount) || 0)),
        latencyMs: Math.max(0, Math.trunc(Number(input.latencyMs) || 0)),
        filters: hasFilters ? (filters as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  } catch {
    // Analyse er ikke kritisk for søket. En manglende logg skal ikke vises
    // som en søkefeil for brukeren.
  }
}

export async function getSearchAnalytics(
  actor: ServiceActor,
  days = DEFAULT_DAYS,
): Promise<ServiceResult<SearchAnalytics>> {
  if (!(isAdminActor(actor) || can(actor, "audit.view"))) return fail("forbidden");

  const numericDays = Number(days);
  const safeDays = Math.min(
    Math.max(Number.isFinite(numericDays) ? Math.trunc(numericDays) : DEFAULT_DAYS, 1),
    MAX_DAYS,
  );
  const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  const where: Prisma.SearchLogWhereInput = { createdAt: { gte: from } };
  const zeroWhere: Prisma.SearchLogWhereInput = { ...where, resultCount: 0 };

  const [totalSearches, zeroResultCount, latency, top, topZero, dailyRows] =
    await Promise.all([
      prisma.searchLog.count({ where }),
      prisma.searchLog.count({ where: zeroWhere }),
      prisma.searchLog.aggregate({ where, _avg: { latencyMs: true } }),
      prisma.searchLog.groupBy({
        by: ["normalizedQuery"],
        where,
        _count: { _all: true },
        _min: { query: true },
        orderBy: { _count: { normalizedQuery: "desc" } },
        take: TOP_QUERY_LIMIT,
      }),
      prisma.searchLog.groupBy({
        by: ["normalizedQuery"],
        where: zeroWhere,
        _count: { _all: true },
        _min: { query: true },
        orderBy: { _count: { normalizedQuery: "desc" } },
        take: TOP_QUERY_LIMIT,
      }),
      prisma.$queryRaw<Array<{ date: Date | string; count: bigint | number; zero_count: bigint | number }>>(
        // Dato og intervall er parametrisert. Ingen brukertekst går inn i SQL-en.
        Prisma.sql`
          SELECT
            date_trunc('day', l."createdAt") AS "date",
            COUNT(*)::int AS "count",
            COUNT(*) FILTER (WHERE l."resultCount" = 0)::int AS "zero_count"
          FROM "SearchLog" l
          WHERE l."createdAt" >= ${from}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
      ),
    ]);

  return ok({
    days: safeDays,
    totalSearches,
    zeroResultCount,
    zeroResultRate: totalSearches > 0 ? zeroResultCount / totalSearches : 0,
    averageLatencyMs: Math.round(latency._avg.latencyMs ?? 0),
    topQueries: top.map((row) => ({
      query: redactSearchQuery(row._min?.query ?? row.normalizedQuery).slice(
        0,
        MAX_QUERY_LENGTH,
      ),
      count: row._count._all,
    })),
    topZeroResultQueries: topZero.map((row) => ({
      query: redactSearchQuery(row._min?.query ?? row.normalizedQuery).slice(
        0,
        MAX_QUERY_LENGTH,
      ),
      count: row._count._all,
    })),
    daily: dailyRows.map((row) => ({
      date:
        row.date instanceof Date
          ? row.date.toISOString().slice(0, 10)
          : String(row.date).slice(0, 10),
      count: Number(row.count) || 0,
      zeroResultCount: Number(row.zero_count) || 0,
    })),
  });
}
