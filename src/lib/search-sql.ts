import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { normalizeSearchText } from "@/lib/fuzzy";

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

/**
 * Felter som ikke har trigram-indeks, men som fortsatt skal kunne søkes i med
 * en normalisert delstreng. Vi bruker `strpos`/ILIKE-lignende matching i
 * databasen på samme normaliserte form som JS-søket, slik at «arlig-service»
 * matcher «Årlig service» og «2026-1042» matcher «NO-2026-1042».
 */
export const SUBSTRING_SEARCH_FIELDS = {
  "WorkOrder.title": { table: '"WorkOrder"', column: '"title"', hasDeletedAt: true },
  "WorkOrder.orderNumber": { table: '"WorkOrder"', column: '"orderNumber"', hasDeletedAt: true },
  "Tag.name": { table: '"Tag"', column: '"name"', hasDeletedAt: false },
} as const;

export type SubstringSearchTable = "WorkOrder" | "Tag";
export type SubstringSearchColumn = "title" | "orderNumber" | "name";

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

/** Er kombinasjonen av tabell og kolonne trygg for normalisert delstrengsøk? */
export function isAllowedSubstringSearchField(table: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    SUBSTRING_SEARCH_FIELDS,
    fieldKey(table, column),
  );
}

/**
 * SQL-uttrykk som normaliserer en tekstkolonne på samme måte som
 * `normalizeSearchText` i JS: lower case, unaccent, ikke-alfanumeriske tegn
 * blir mellomrom, og mellomrom trimmes/kollapses.
 */
function normalizedSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`btrim(regexp_replace(lower(unaccent(coalesce(${expression}, ''))), '[^a-z0-9]+', ' ', 'g'))`;
}

function fieldExpression(table: string, column: string): Prisma.Sql {
  return Prisma.raw(`${table}.${column}`);
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

/**
 * Normalisert delstrengsøk i en kolonne uten trigram-indeks. Returnerer id-er
 * med en grov score (eksakt > prefiks > substring), slik at kalleren kan
 * rangere videre i JS med `fuzzyScore`.
 *
 * Både kolonnen og søkeordet normaliseres i SQL. Det er samme normalisering
 * som i JS, så tegnsetting, aksenter og æ/ø/å ikke avgjør om noe treffer.
 */
export async function searchBySubstring(
  table: SubstringSearchTable,
  column: SubstringSearchColumn,
  query: string,
  limit: number,
): Promise<NameSearchRow[]> {
  const key = fieldKey(table, column) as keyof typeof SUBSTRING_SEARCH_FIELDS;
  const field = SUBSTRING_SEARCH_FIELDS[key];
  if (!field) {
    throw new Error(`Ugyldig tabell/kolonne for delstrengsøk: ${key}`);
  }

  const take = takeLimit(limit);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const deletedFilter = field.hasDeletedAt
    ? Prisma.sql`AND ${Prisma.raw(field.table)}."deletedAt" IS NULL`
    : Prisma.empty;

  const normalizedColumn = normalizedSql(
    fieldExpression(field.table, field.column),
  );
  const normalizedTerm = normalizedSql(Prisma.sql`${normalizedQuery}`);

  return prisma.$queryRaw<NameSearchRow[]>(Prisma.sql`
    SELECT
      "id",
      CASE
        WHEN ${normalizedColumn} = ${normalizedTerm} THEN 1
        WHEN strpos(${normalizedColumn}, ${normalizedTerm}) = 1 THEN 0.9
        ELSE 0.8
      END AS "score"
    FROM ${Prisma.raw(field.table)}
    WHERE strpos(${normalizedColumn}, ${normalizedTerm}) > 0
      ${deletedFilter}
    ORDER BY "score" DESC, "id" ASC
    LIMIT ${take}
  `);
}

/**
 * Finner oppdrags-id-er der et normalisert søkeord finnes i tittel,
 * beskrivelse, ordrenummer, kundenavn/-sted/-adresse eller et tag-navn.
 *
 * Brukes av oppdragslisten for å få samme tegnsettings- og aksenttoleranse som
 * det globale søket. Resultatet må alltid intersects med brukerens
 * `workOrderScope` før det vises, så denne spørringen kan ikke brukes alene
 * til tilgangskontroll.
 */
export async function searchWorkOrderIds(
  query: string,
  limit = 500,
): Promise<string[]> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const take = takeLimit(limit);
  const term = normalizedSql(Prisma.sql`${normalizedQuery}`);

  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT w."id"
    FROM "WorkOrder" w
    LEFT JOIN "Customer" c ON c."id" = w."customerId"
    WHERE w."deletedAt" IS NULL
      AND (
        strpos(${normalizedSql(Prisma.sql`w."title"`)}, ${term}) > 0
        OR strpos(${normalizedSql(Prisma.sql`w."description"`)}, ${term}) > 0
        OR strpos(${normalizedSql(Prisma.sql`w."orderNumber"`)}, ${term}) > 0
        OR strpos(${normalizedSql(Prisma.sql`c."name"`)}, ${term}) > 0
        OR strpos(${normalizedSql(Prisma.sql`c."city"`)}, ${term}) > 0
        OR strpos(${normalizedSql(Prisma.sql`c."address"`)}, ${term}) > 0
        OR EXISTS (
          SELECT 1
          FROM "_WorkOrderTags" wt
          JOIN "Tag" t ON t."id" = wt."A"
          WHERE wt."B" = w."id"
            AND strpos(${normalizedSql(Prisma.sql`t."name"`)}, ${term}) > 0
        )
      )
    ORDER BY w."id" ASC
    LIMIT ${take}
  `);

  return rows.map((row) => row.id);
}
