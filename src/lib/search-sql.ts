import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { normalizeSearchCompact, normalizeSearchText } from "@/lib/fuzzy";

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
  /** ts_rank fra fulltekstsøket, når det finnes. */
  score?: number;
  /** Antall treff før LIMIT. */
  total?: number;
};

/** Et navnetreff med trigram-likhet (0–1). */
export type NameSearchRow = {
  id: string;
  score: number;
  /** Antall treff før LIMIT, når spørringen returnerer det. */
  total?: number;
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

/**
 * Tabeller og kolonner som kan søkes med normalisert delstreng. Listen er en
 * allowlist: tabell- og kolonnenavn kommer aldri fra brukeren.
 *
 * Kontakter, brukere, maler, mapper, rapporter og kommentarer bruker denne
 * veien i stedet for Prismas `contains`, slik at søket blir like tolerant for
 * æ/ø/å, aksenter og tegnsetting som resten av søket.
 */
const NORMALIZED_SEARCH_TABLES = {
  Customer: {
    table: '"Customer"',
    // Alle feltene på kundekortet. Da gir orgnummer, kundenummer, telefon,
    // e-post, adresse, postnummer og notater kundetreff – ikke bare navn og
    // sted. Notater brukes bare til rangering/treff og vises aldri i UI.
    columns: [
      "name",
      "customerNumber",
      "orgNumber",
      "phone",
      "email",
      "address",
      "postalCode",
      "city",
      "notes",
    ],
    hasDeletedAt: true,
    // Kontaktdata har sin egen gruppe, men kunden skal også dukke opp når
    // telefonnummeret/e-posten står på en kontaktperson.
    matchContacts: true,
  },
  Product: {
    table: '"Product"',
    columns: ["model", "serialNumber", "location"],
    hasDeletedAt: false,
  },
  Contact: {
    table: '"Contact"',
    columns: ["name", "email", "phone", "role"],
    hasDeletedAt: false,
  },
  WorkOrder: {
    table: '"WorkOrder"',
    columns: ["title", "description", "orderNumber"],
    hasDeletedAt: true,
  },
  Tag: { table: '"Tag"', columns: ["name"], hasDeletedAt: false },
  Report: {
    table: '"Report"',
    columns: ["reportNumber", "name", "templateTitle", "comments"],
    hasDeletedAt: true,
  },
  Comment: { table: '"Comment"', columns: ["content", "authorName"], hasDeletedAt: false },
  User: { table: '"User"', columns: ["name", "email", "phone"], hasDeletedAt: false },
  Template: {
    table: '"Template"',
    columns: ["title", "reportName", "description"],
    hasDeletedAt: false,
  },
  DocumentFolder: { table: '"DocumentFolder"', columns: ["name"], hasDeletedAt: false },
} as const;

export type NormalizedSearchTable = keyof typeof NORMALIZED_SEARCH_TABLES;

/** Et normalisert treff med en grov score (eksakt > prefiks > delstreng). */
export type NormalizedSearchRow = NameSearchRow;

function normalizedTableConfig(table: NormalizedSearchTable) {
  const config = NORMALIZED_SEARCH_TABLES[table];
  if (!config) throw new Error(`Ugyldig tabell for normalisert søk: ${table}`);
  return config;
}

function normalizedColumnExpression(
  table: NormalizedSearchTable,
  column: string,
): Prisma.Sql {
  const config = normalizedTableConfig(table);
  if (!(config.columns as readonly string[]).includes(column)) {
    throw new Error(`Ugyldig kolonne for normalisert søk: ${table}.${column}`);
  }
  return normalizedSql(Prisma.raw(`${config.table}."${column}"`));
}

/**
 * Normalisert delstrengsøk mot én eller flere allowlistede kolonner.
 *
 * Returnerer id-er og score, ikke visningsdata. Kalleren henter de få radene
 * den trenger og legger alltid på tilgangskontroll før noe vises.
 *
 * Søket matcher både normalt (med mellomrom) og kompakt (uten mellomrom), slik
 * at «+47 123 45 678» treffer «12345678», «123 456 789» treffer «123456789»
 * og «K-100» treffer «K100». `includeDeleted` er en bevisst opt-in for lister
 * som skal vise slettede rader (f.eks. kundelisten); standard er at mykt
 * slettede rader aldri kommer med.
 */
export async function searchNormalizedIds(
  table: NormalizedSearchTable,
  query: string,
  limit: number,
  columns?: string[],
  includeDeleted = false,
): Promise<NormalizedSearchRow[]> {
  const config = normalizedTableConfig(table);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  // Kompakt form uten separatorer. For søk som allerede er uten separatorer
  // er den identisk med `normalizedQuery`, og da er det bare én ekstra,
  // billig strpos per kolonne.
  const compactQuery = normalizeSearchCompact(query);

  const selected = columns ?? [...config.columns];
  for (const column of selected) {
    if (!(config.columns as readonly string[]).includes(column)) {
      throw new Error(`Ugyldig kolonne for normalisert søk: ${table}.${column}`);
    }
  }
  if (selected.length === 0) return [];

  const take = takeLimit(limit);
  const rawQuery = query.trim();
  const term = Prisma.sql`${normalizedQuery}`;
  const compactTerm = Prisma.sql`${compactQuery}`;
  const contains = selected.map(
    (column) => {
      const compactColumn = compactNormalizedColumnExpression(table, column);
      return Prisma.sql`(
      strpos(${normalizedColumnExpression(table, column)}, ${term}) > 0
      OR strpos(${compactColumn}, ${compactTerm}) > 0
      -- Også når kolonnen er kortere enn søket: «+47 123 45 678» skal treffe
      -- et telefonnummer lagret som «12345678». Korte verdier (< 5 tegn)
      -- krever full match, så en by som «Os» ikke gir treff på alt.
      OR (length(${compactColumn}) >= 5 AND strpos(${compactTerm}, ${compactColumn}) > 0)
      OR ${Prisma.raw(`${config.table}."${column}"`)} % ${rawQuery}
    )`;
    },
  );
  const exact = selected.map(
    (column) => Prisma.sql`(
      ${normalizedColumnExpression(table, column)} = ${term}
      OR ${compactNormalizedColumnExpression(table, column)} = ${compactTerm}
    )`,
  );
  const prefix = selected.map(
    (column) => Prisma.sql`(
      strpos(${normalizedColumnExpression(table, column)}, ${term}) = 1
      OR strpos(${compactNormalizedColumnExpression(table, column)}, ${compactTerm}) = 1
    )`,
  );

  // Kunder skal også matche når søkeordet står på en kontaktperson. Det gir
  // kundetreff uten at kontaktradene dupliseres i kundegruppen. Bare når
  // kalleren ikke har begrenset kolonnene eksplisitt.
  const matchContacts =
    columns === undefined && "matchContacts" in config && config.matchContacts;
  const contactMatch = matchContacts
    ? Prisma.sql`EXISTS (
        SELECT 1
        FROM "Contact" ct
        WHERE ct."customerId" = ${Prisma.raw(config.table)}."id"
          AND (
            ${Prisma.join(
              ["name", "email", "phone", "role"].map(
                (column) => Prisma.sql`(
                  strpos(${normalizedSql(Prisma.raw(`ct."${column}"`))}, ${term}) > 0
                  OR strpos(${compactNormalizedSql(Prisma.raw(`ct."${column}"`))}, ${compactTerm}) > 0
                )`,
              ),
              " OR ",
            )}
          )
      )`
    : Prisma.empty;

  const showDeleted = includeDeleted === true;
  const deletedFilter =
    config.hasDeletedAt && !showDeleted
      ? Prisma.sql`AND ${Prisma.raw(config.table)}."deletedAt" IS NULL`
      : Prisma.empty;

  const where = matchContacts
    ? Prisma.sql`((${Prisma.join(contains, " OR ")}) OR ${contactMatch})`
    : Prisma.sql`(${Prisma.join(contains, " OR ")})`;

  return prisma.$queryRaw<NormalizedSearchRow[]>(Prisma.sql`
    SELECT
      "id",
      CASE
        WHEN ${Prisma.join(exact, " OR ")} THEN 1
        WHEN ${Prisma.join(prefix, " OR ")} THEN 0.9
        ELSE 0.8
      END AS "score",
      COUNT(*) OVER() AS "total"
    FROM ${Prisma.raw(config.table)}
    WHERE ${where}
      ${deletedFilter}
    ORDER BY "score" DESC, "id" ASC
    LIMIT ${take}
  `);
}

export type ReportSearchRow = {
  id: string;
  score: number;
  snippet: string | null;
  /** Antall rapporter som matcher før limit, med samme filter og tilgang. */
  total: number;
};

export type ReportSearchOptions = {
  limit: number;
  includeCancelled: boolean;
  filters?: import("./search-filters").SearchFilters;
  /** Hopp over så mange rangerte treff (1-basert side konverteres av kalleren). */
  offset?: number;
};

/**
 * Fulltekst- og trigramsøk i rapporter.
 *
 * Bruker de nye GIN-indeksene:
 * - `Report_search_fts_idx` for navn, malnavn, rapportnummer og kommentar
 * - `ReportUnit_answers_fts_idx` for sjekkpunkt-svar
 * - trigram-indeksene for rapportnummer/navn/malnavn
 *
 * I tillegg matcher vi normalisert oppdragstittel og kundenavn, slik at
 * «pumpe service» finner rapporten selv når teksten bare står på oppdraget.
 * Alle verdier er parametrisert; tabell- og kolonnenavn er faste.
 */
export async function searchReports(
  query: string,
  options: ReportSearchOptions,
): Promise<ReportSearchRow[]> {
  const rawQuery = query.trim();
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) return [];

  const take = takeLimit(options.limit);
  const offset = Number.isFinite(options.offset)
    ? Math.max(0, Math.trunc(options.offset as number))
    : 0;
  const filters = options.filters ?? {};
  const term = normalizedSql(Prisma.sql`${normalizedQuery}`);

  const reportText = Prisma.sql`(
    coalesce(r."name", '') || ' ' ||
    coalesce(r."templateTitle", '') || ' ' ||
    coalesce(r."reportNumber", '') || ' ' ||
    coalesce(r."comments", '')
  )`;
  const reportTsv = Prisma.sql`to_tsvector('norwegian', ${reportText})`;

  const unitAnswers = Prisma.sql`(
    SELECT string_agg(ru."answersJson", ' ')
    FROM "ReportUnit" ru
    WHERE ru."reportId" = r."id"
  )`;

  const normalizedReportNumber = normalizedSql(Prisma.raw('r."reportNumber"'));
  const normalizedName = normalizedSql(Prisma.raw('r."name"'));
  const normalizedTemplateTitle = normalizedSql(Prisma.raw('r."templateTitle"'));
  const normalizedComments = normalizedSql(Prisma.raw('r."comments"'));
  const normalizedHmsType = normalizedSql(Prisma.raw('r."hmsType"::text'));
  const normalizedWorkOrderTitle = normalizedSql(Prisma.raw('w."title"'));
  const normalizedCustomerName = normalizedSql(Prisma.raw('c."name"'));

  const substringMatch = Prisma.sql`(
    strpos(${normalizedReportNumber}, ${term}) > 0
    OR strpos(${normalizedName}, ${term}) > 0
    OR strpos(${normalizedTemplateTitle}, ${term}) > 0
    OR strpos(${normalizedComments}, ${term}) > 0
    OR strpos(${normalizedHmsType}, ${term}) > 0
    OR strpos(${normalizedWorkOrderTitle}, ${term}) > 0
    OR strpos(${normalizedCustomerName}, ${term}) > 0
    OR EXISTS (
      SELECT 1 FROM "ReportUnit" ru
      WHERE ru."reportId" = r."id"
        AND strpos(${normalizedSql(Prisma.raw('ru."answersJson"'))}, ${term}) > 0
    )
  )`;

  const matchingUnits = Prisma.sql`EXISTS (
    SELECT 1 FROM "ReportUnit" ru
    WHERE ru."reportId" = r."id"
      AND to_tsvector('norwegian', coalesce(ru."answersJson", '')) @@ q.tsq
  )`;

  // Alle treffkildene er alternative måter å matche samme rapport på. De må
  // derfor OR-es sammen; tidligere ble de AND-et, slik at en rapport bare
  // kom med hvis *alle* feltene lignet søkeordet.
  const matchConditions: Prisma.Sql[] = [
    Prisma.sql`${reportTsv} @@ q.tsq`,
    Prisma.sql`r."reportNumber" % ${rawQuery}`,
    Prisma.sql`r."name" % ${rawQuery}`,
    Prisma.sql`r."templateTitle" % ${rawQuery}`,
    Prisma.sql`w."title" % ${rawQuery}`,
    Prisma.sql`c."name" % ${rawQuery}`,
    matchingUnits,
    substringMatch,
  ];

  const conditions: Prisma.Sql[] = [
    Prisma.sql`(${Prisma.join(matchConditions, " OR ")})`,
  ];

  if (!options.includeCancelled) {
    conditions.push(Prisma.sql`w."status" <> 'CANCELLED'::"WorkStatus"`);
  }
  if (filters.status) {
    conditions.push(Prisma.sql`w."status" = ${filters.status}::"WorkStatus"`);
  }
  if (filters.customer) {
    conditions.push(Prisma.sql`w."customerId" = ${filters.customer}`);
  }
  if (filters.technician) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "_WorkOrderTechnicians" wt
      WHERE wt."B" = w."id" AND wt."A" = ${filters.technician}
    )`);
  }
  if (filters.tag) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "_WorkOrderTags" wt
      JOIN "Tag" t ON t."id" = wt."A"
      WHERE wt."B" = w."id" AND t."name" = ${filters.tag}
    )`);
  }
  if (filters.hmsType) {
    conditions.push(Prisma.sql`r."hmsType" = ${filters.hmsType}::"HmsFormType"`);
  }
  if (filters.dateFrom) {
    conditions.push(Prisma.sql`r."completedAt" >= ${filters.dateFrom}::date`);
  }
  if (filters.dateTo) {
    conditions.push(
      Prisma.sql`r."completedAt" < (${filters.dateTo}::date + INTERVAL '1 day')`,
    );
  }

  const sql = Prisma.sql`
    WITH q AS (
      SELECT websearch_to_tsquery('norwegian', ${rawQuery}) AS tsq
    )
    SELECT
      r."id",
      GREATEST(
        ts_rank(${reportTsv}, q.tsq) * 4,
        similarity(coalesce(r."reportNumber", ''), ${rawQuery}),
        similarity(coalesce(r."name", ''), ${rawQuery}),
        similarity(coalesce(r."templateTitle", ''), ${rawQuery})
      ) AS "score",
      ts_headline(
        'norwegian',
        ${reportText} || ' ' || coalesce(${unitAnswers}, ''),
        q.tsq,
        'MaxFragments=2,MaxWords=18,MinWords=5'
      ) AS "snippet",
      COUNT(*) OVER() AS "total"
    FROM "Report" r
    JOIN "WorkOrder" w ON w."id" = r."workOrderId"
    LEFT JOIN "Customer" c ON c."id" = w."customerId"
    CROSS JOIN q
    WHERE r."deletedAt" IS NULL
      AND w."deletedAt" IS NULL
      AND (${Prisma.join(conditions, " AND ")})
    ORDER BY "score" DESC, r."completedAt" DESC
    LIMIT ${take}
    OFFSET ${offset}
  `;
  const rows = await prisma.$queryRaw<
    Array<{ id: string; score: number; snippet: string | null; total: bigint | number }>
  >(sql);

  return rows.map((row) => ({
    id: row.id,
    score: Number(row.score) || 0,
    snippet: row.snippet,
    total: Number(row.total) || 0,
  }));
}

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

/**
 * Som `normalizedSql`, men fjerner også mellomrom. Speiler
 * `normalizeSearchCompact` i JS, slik at telefon-, org- og kundenumre matcher
 * uavhengig av separatorer.
 */
function compactNormalizedSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`replace(${normalizedSql(expression)}, ' ', '')`;
}

function compactNormalizedColumnExpression(
  table: NormalizedSearchTable,
  column: string,
): Prisma.Sql {
  const config = normalizedTableConfig(table);
  if (!(config.columns as readonly string[]).includes(column)) {
    throw new Error(`Ugyldig kolonne for normalisert søk: ${table}.${column}`);
  }
  return compactNormalizedSql(Prisma.raw(`${config.table}."${column}"`));
}

function fieldExpression(table: string, column: string): Prisma.Sql {
  return Prisma.raw(`${table}.${column}`);
}

/**
 * Fulltekstsøk i dokumenter med `websearch_to_tsquery`, `ts_rank` og
 * `ts_headline`. `searchTsv` er vedlikeholdt av en trigger, så vi leser aldri
 * `contentText` eller `pageTexts` inn i Node.
 *
 * Filnavn er ikke en del av `searchTsv`, og kan inneholde tegnsetting som
 * ødelegger en rå `websearch_to_tsquery`. Derfor matcher vi filnavnet både
 * normalisert og kompakt (uten separatorer), i tillegg til trigram-likhet.
 * Da finner «faktura 123 kunde» filen «Faktura #123 (kunde).pdf», og
 * «Faktura-123.pdf» matcher «faktura 123».
 */
export async function searchDocuments(
  query: string,
  limit: number,
): Promise<DocumentSearchRow[]> {
  const take = takeLimit(limit);
  const rawQuery = query.trim();
  const normalizedQuery = normalizeSearchText(rawQuery);
  const compactQuery = normalizeSearchCompact(rawQuery);
  // Bare tegnsetting/whitespace: ingenting kan matche.
  if (!normalizedQuery) return [];

  const normalizedTerm = Prisma.sql`${normalizedQuery}`;
  const compactTerm = Prisma.sql`${compactQuery}`;
  const normalizedFileName = normalizedSql(Prisma.raw('d."fileName"'));
  const compactFileName = compactNormalizedSql(Prisma.raw('d."fileName"'));

  const filenameMatch = Prisma.sql`(
    strpos(${normalizedFileName}, ${normalizedTerm}) > 0
    OR strpos(${compactFileName}, ${compactTerm}) > 0
    -- Filnavnet kan være kortere enn søket (f.eks. med «(1).pdf»-suffiks).
    OR (length(${compactFileName}) >= 5 AND strpos(${compactTerm}, ${compactFileName}) > 0)
    OR d."fileName" % ${rawQuery}
  )`;

  // `numnode` er 0 for tomme/stopword-only spørringer. Da hopper vi over
  // ts_headline, som ikke skal kjøres med en tom tsquery.
  const headline = Prisma.sql`CASE
    WHEN numnode(q.tsq) > 0 THEN ts_headline(
      'norwegian',
      -- contentText leses av PostgreSQL for å lage utdraget, men sendes
      -- aldri til Node. Det holder minnebruken borte fra app-prosessen.
      coalesce(d."title", '') || ' ' ||
      coalesce(d."description", '') || ' ' ||
      coalesce(d."contentText", ''),
      q.tsq,
      'MaxFragments=2,MaxWords=18,MinWords=5'
    )
    ELSE left(coalesce(nullif(d."description", ''), d."title", ''), 160)
  END`;

  const score = Prisma.sql`GREATEST(
    ts_rank(d."searchTsv", q.tsq) * 4,
    similarity(coalesce(d."fileName", ''), ${rawQuery}),
    CASE
      WHEN strpos(${normalizedFileName}, ${normalizedTerm}) = 1 THEN 1
      WHEN strpos(${compactFileName}, ${compactTerm}) = 1 THEN 0.95
      WHEN strpos(${normalizedFileName}, ${normalizedTerm}) > 0 THEN 0.9
      WHEN strpos(${compactFileName}, ${compactTerm}) > 0 THEN 0.85
      ELSE 0
    END
  )`;

  return prisma.$queryRaw<DocumentSearchRow[]>(Prisma.sql`
    WITH q AS (
      SELECT websearch_to_tsquery('norwegian', ${normalizedQuery}) AS tsq
    )
    SELECT
      d."id",
      d."title",
      d."description",
      d."fileName",
      d."filePath",
      ${headline} AS "snippet",
      ${score} AS "score",
      COUNT(*) OVER() AS "total"
    FROM "Document" d, q
    WHERE (d."searchTsv" @@ q.tsq OR ${filenameMatch})
      AND d."deletedAt" IS NULL
    ORDER BY "score" DESC, d."title" ASC
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
      similarity(coalesce(${Prisma.raw(field.column)}, ''), ${query}) AS "score",
      COUNT(*) OVER() AS "total"
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
      END AS "score",
      COUNT(*) OVER() AS "total"
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
  const { ids } = await searchWorkOrderIdsWithTotal(query, limit);
  return ids;
}

/** Som `searchWorkOrderIds`, men returnerer også antall treff før LIMIT. */
export async function searchWorkOrderIdsWithTotal(
  query: string,
  limit = 500,
): Promise<{ ids: string[]; total: number }> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { ids: [], total: 0 };

  const take = takeLimit(limit);
  const term = normalizedSql(Prisma.sql`${normalizedQuery}`);

  const rows = await prisma.$queryRaw<{ id: string; total: number | bigint }[]>(Prisma.sql`
    SELECT w."id", COUNT(*) OVER() AS "total"
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

  return {
    ids: rows.map((row) => row.id),
    total: Number(rows[0]?.total ?? 0) || 0,
  };
}
