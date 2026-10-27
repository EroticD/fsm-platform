import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  parseSearchFilters,
  serializeSearchFilters,
  type SearchFilters,
} from "@/lib/search-filters";
import {
  fail,
  ok,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/**
 * Lagrede søk.
 *
 * Et lagret søk tilhører alltid brukeren som opprettet det. Navnet er unikt
 * per bruker, slik at listen kan brukes som en enkel snarveismeny uten
 * duplikater. Filtrene valideres med samme allowlist som URL-filtrene.
 */

const MAX_NAME_LENGTH = 80;
const MAX_QUERY_LENGTH = 100;
const MAX_FILTERS_JSON_LENGTH = 2_000;

export type SavedSearch = {
  id: string;
  name: string;
  query: string;
  filters: SearchFilters;
  createdAt: Date;
  updatedAt: Date;
};

export type SavedSearchInput = {
  name: string;
  query: string;
  filters?: SearchFilters | null;
};

function canUseSavedSearches(actor: ServiceActor): boolean {
  return actor.isActive && actor.role !== "CUSTOMER";
}

function toSavedSearch(row: {
  id: string;
  name: string;
  query: string;
  filters: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): SavedSearch {
  const filters =
    row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)
      ? parseSearchFilters(row.filters as Record<string, string | string[] | undefined>)
      : {};
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    filters,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Validerer og normaliserer input. Returnerer null ved ugyldig data. */
function normalizeInput(
  input: SavedSearchInput,
): { name: string; query: string; filters: SearchFilters; filtersJson: Prisma.InputJsonValue | typeof Prisma.DbNull } | null {
  const name = String(input.name ?? "").trim();
  const query = String(input.query ?? "").trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (!query || query.length > MAX_QUERY_LENGTH) return null;

  const filters = parseSearchFilters(
    (input.filters ?? {}) as Record<string, string | string[] | undefined>,
  );
  const serialized = serializeSearchFilters(filters);
  if (serialized.length > MAX_FILTERS_JSON_LENGTH) return null;

  return {
    name,
    query,
    filters,
    filtersJson: serialized ? (filters as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

export async function listSavedSearches(
  actor: ServiceActor,
): Promise<ServiceResult<SavedSearch[]>> {
  if (!canUseSavedSearches(actor)) return fail("forbidden");

  const rows = await prisma.savedSearch.findMany({
    where: { userId: actor.id },
    orderBy: { updatedAt: "desc" },
  });
  return ok(rows.map(toSavedSearch));
}

export async function createSavedSearch(
  actor: ServiceActor,
  input: SavedSearchInput,
): Promise<ServiceResult<SavedSearch>> {
  if (!canUseSavedSearches(actor)) return fail("forbidden");
  const normalized = normalizeInput(input);
  if (!normalized) return fail("invalid");

  try {
    const row = await prisma.savedSearch.create({
      data: {
        userId: actor.id,
        name: normalized.name,
        query: normalized.query,
        filters: normalized.filtersJson,
      },
    });
    return ok(toSavedSearch(row));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return fail("conflict");
    }
    throw error;
  }
}

export async function updateSavedSearch(
  actor: ServiceActor,
  id: string,
  input: SavedSearchInput,
): Promise<ServiceResult<SavedSearch>> {
  if (!canUseSavedSearches(actor)) return fail("forbidden");
  if (!id) return fail("invalid");
  const normalized = normalizeInput(input);
  if (!normalized) return fail("invalid");

  const existing = await prisma.savedSearch.findFirst({
    where: { id, userId: actor.id },
    select: { id: true },
  });
  if (!existing) return fail("not_found");

  try {
    const row = await prisma.savedSearch.update({
      where: { id: existing.id },
      data: {
        name: normalized.name,
        query: normalized.query,
        filters: normalized.filtersJson,
      },
    });
    return ok(toSavedSearch(row));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return fail("conflict");
    }
    throw error;
  }
}

export async function deleteSavedSearch(
  actor: ServiceActor,
  id: string,
): Promise<ServiceResult<undefined>> {
  if (!canUseSavedSearches(actor)) return fail("forbidden");
  if (!id) return fail("invalid");

  const existing = await prisma.savedSearch.findFirst({
    where: { id, userId: actor.id },
    select: { id: true },
  });
  if (!existing) return fail("not_found");

  await prisma.savedSearch.delete({ where: { id: existing.id } });
  return ok(undefined);
}

