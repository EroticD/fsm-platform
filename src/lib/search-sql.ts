import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * SQL-søk mot PostgreSQL-indeksene fra P1-4.
 *
 * Alt som går inn i SQL-en er enten parameterisert (`$1`, `$2`, …) eller hentet
 * fra en fast allowlist. Tabell- og kolonnenavn kan derfor aldri komme fra
 * brukeren, og søkeordet blir aldri en del av SQL-teksten.
 */

/** Dokumentene vi trenger for å bygge et treff. `contentText`/`pageTexts` er
 *  bevisst utelatt: de kan være store, og fullteksten ligger i `searchTsv`. */
export type DocumentSearchRow = {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  filePath: string;
  snippet: string | null;
};

/** Et navnetreff med trigram-likhet (0–1). */
export type NameSearchRow = {
  id: string;
  score: number;
};

/** Hvilke tabeller og kolonner som har trigram-indeks. */
export const NAME_SEARCH_FIELDS = {
  "Customer.name": { table: '"Customer"', column: '"name"', hasDeletedAt: true },
  "Customer.city": { table: '"Customer"', column: '"city"', hasDeletedAt: true },
  "Product.model": { table: '"Product"', column: '"model"', hasDeletedAt: false },
  "WorkOrder.title": { table: '"WorkOrder"', column: '"title"', hasDeletedAt: true },
} as const;

export type NameSearchTable = "Customer" | "Product" | "WorkOrder";
export type NameSearchColumn = "name" | "city" | "model" | "title";

/** En hard øvre grense, uavhengig av hva kalleren ber om. */
const MAX_LIMIT = 200;

function takeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 1;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function fieldKey(table: string, column: string): string {
  return `${table}.${column}`;
}

/** Er kombinasjonen av tabell og kolonne trygg å bruke i SQL? */
export function isAllowedNameSearchField(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    NAME_SEARCH_FIELDS,
    fieldKey(table, column),
  );
}

/**
 * Fulltekstsøk i dokumenter med `websearch_to_tsquery`, `ts_rank` og
 * `ts_headline`. `searchTsv` er vedlikeholdt av en trigger, så vi leser aldri
 * `contentText` eller `pageTexts` inn i Node.
 */
export async function searchDocuments(
  query: string,
  limit: number,
): Promise<DocumentSearchRow[]> {
  const take = takeLimit(limit);

  return prisma.$queryRaw<DocumentSearchRow[]>(Prisma.sql`
    WITH q AS (
      SELECT websearch_to_tsquery('norwegian', ${query}) AS tsq
    )
    SELECT
      d."id",
      d."title",
      d."description",
      d."fileName",
      d."filePath",
      ts_headline(
        'norwegian',
        -- contentText leses av PostgreSQL for å lage utdraget, men sendes
        -- aldri til Node. Det holder minnebruken borte fra app-prosessen.
        coalesce(d."title", '') || ' ' ||
        coalesce(d."description", '') || ' ' ||
        coalesce(d."contentText", ''),
        q.tsq,
        'MaxFragments=2,MaxWords=18,MinWords=5'
      ) AS "snippet"
    FROM "Document" d, q
    WHERE d."searchTsv" @@ q.tsq
      AND d."deletedAt" IS NULL
    ORDER BY ts_rank(d."searchTsv", q.tsq) DESC, d."title" ASC
    LIMIT ${take}
  `);
}

/**
 * Trigram-søk i en indeksert navnekolonne. Returnerer id-er med likhetsscore,
 * slik at kalleren kan hente visningsfeltene og rangere kandidatene videre.
 *
 * Ukjente tabell/kolonne-kombinasjoner avvises før noe sendes til databasen.
 */
export async function searchByName(
  table: NameSearchTable,
  column: NameSearchColumn,
  query: string,
  limit: number,
): Promise<NameSearchRow[]> {
  const key = fieldKey(table, column) as keyof typeof NAME_SEARCH_FIELDS;
  const field = NAME_SEARCH_FIELDS[key];
  if (!field) {
    throw new Error(`Ugyldig tabell/kolonne for navnesøk: ${key}`);
  }

  const take = takeLimit(limit);

  // `%` bruker pg_trgm-indeksen (gin_trgm_ops) når kolonnen er indeksert.
  // Mykt slettede rader skal aldri dukke opp i søket.
  const deletedFilter = field.hasDeletedAt
    ? Prisma.sql`AND ${Prisma.raw(field.table)}."deletedAt" IS NULL`
    : Prisma.empty;

  return prisma.$queryRaw<NameSearchRow[]>(Prisma.sql`
    SELECT
      "id",
      similarity(coalesce(${Prisma.raw(field.column)}, ''), ${query}) AS "score"
    FROM ${Prisma.raw(field.table)}
    WHERE ${Prisma.raw(field.column)} % ${query}
      ${deletedFilter}
    ORDER BY "score" DESC, "id" ASC
    LIMIT ${take}
  `);
}
