import { NextResponse } from "next/server";
import { performSearch } from "@/lib/search";
import { parseSearchFilters } from "@/lib/search-filters";
import { normalizeSearchText } from "@/lib/fuzzy";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { logSearch } from "@/server/search-analytics";

const MAX_QUERY_LENGTH = 100;
const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;

function readInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isActive || currentUser.role === "CUSTOMER") {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  // Maks 60 søk per minutt per konto. Samme nøkkel som /sok, slik at de deler
  // kvoten, og telleren ligger i databasen for flere instanser.
  const limit = await allowRequestDb(`search:${currentUser.id}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange søk. Prøv igjen om litt." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const filters = parseSearchFilters(params);
  const page = readInt(params.get("page"), 1, 1, 10_000);
  const pageSize = readInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const includeCancelled = currentUser.role === "ADMIN" || currentUser.role === "OFFICE";

  const started = Date.now();
  const results = await performSearch(q, {
    user: currentUser,
    includeCancelled,
    page,
    pageSize,
    filters,
  });

  // Analysen er best effort og skal aldri påvirke søkeresultatet.
  if (q) {
    await logSearch({
      userId: currentUser.id,
      query: q,
      normalizedQuery: normalizeSearchText(q),
      resultCount: results.total,
      latencyMs: results.tookMs ?? Date.now() - started,
      filters,
    });
  }

  // Søkeresultatet er person- og kundedata som er avgrenset per bruker. Det
  // skal aldri mellomlagres i nettleser, proxy eller delt cache.
  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
