// i18n-ignore-file: SQL-fragmenter og PostgreSQL-konfigurasjon, ikke UI-tekst.
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
  /** Første side i PDF-en der søket matcher indeksert sidetekst. */
  page?: number | null;
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
 * en normalisert delstreng. Vi matcher med `LIKE` mot `fsm_search_norm(...)`,
 * som har uttrykksindeks (gin_trgm_ops), slik at «arlig-service» matcher
 * «Årlig service» og «2026-1042» matcher «NO-2026-1042».
 */
export const SUBSTRING_SEARCH_FIELDS = {
  "WorkOrder.title": { table: '"WorkOrder"', column: '"title"', hasDeletedAt: true },
  "WorkOrder.reference": { table: '"WorkOrder"', column: '"reference"', hasDeletedAt: true },
  "WorkOrder.orderNumber": { table: '"WorkOrder"', column: '"orderNumber"', hasDeletedAt: true },
  "Tag.name": { table: '"Tag"', column: '"name"', hasDeletedAt: false },
} as const;

export type SubstringSearchTable = "WorkOrder" | "Tag";
export type SubstringSearchColumn = "title" | "reference" | "orderNumber" | "name";

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
    // Bare kolonner der separatorer kan stå i veien for et treff. Hver av dem
    // får en egen kompakt uttrykksindeks (se migreringen
    // 20261112230000_search_expression_indexes).
    compactColumns: ["customerNumber", "orgNumber", "phone", "postalCode"],
    hasDeletedAt: true,
    // Kontaktdata har sin egen gruppe, men kunden skal også dukke opp når
    // telefonnummeret/e-posten står på en kontaktperson.
    matchContacts: true,
  },
  Product: {
    table: '"Product"',
    columns: ["model", "serialNumber", "location"],
    compactColumns: ["serialNumber"],
    hasDeletedAt: false,
    customerScoped: true,
  },
  CustomerSite: {
    table: '"CustomerSite"',
    columns: ["name", "address", "postalCode", "city"],
    compactColumns: ["postalCode"],
    hasDeletedAt: false,
    customerScoped: true,
  },
  Contact: {
    table: '"Contact"',
    columns: ["name", "email", "phone", "role"],
    compactColumns: ["phone"],
    hasDeletedAt: false,
  },
  WorkOrder: {
    table: '"WorkOrder"',
    columns: ["title", "reference", "description", "orderNumber"],
    compactColumns: ["reference", "orderNumber"],
    hasDeletedAt: true,
  },
  Tag: { table: '"Tag"', columns: ["name"], compactColumns: [], hasDeletedAt: false },
  Report: {
    table: '"Report"',
    columns: ["reportNumber", "name", "templateTitle", "comments"],
    compactColumns: ["reportNumber"],
    hasDeletedAt: true,
  },
  Comment: {
    table: '"Comment"',
    columns: ["content", "authorName"],
    compactColumns: [],
    hasDeletedAt: false,
  },
  User: {
    table: '"User"',
    columns: ["name", "email", "phone"],
    compactColumns: ["phone"],
    hasDeletedAt: false,
  },
  Template: {
    table: '"Template"',
    columns: ["title", "reportName", "description"],
    compactColumns: [],
    hasDeletedAt: false,
  },
  DocumentFolder: {
    table: '"DocumentFolder"',
    columns: ["name"],
    compactColumns: [],
    hasDeletedAt: false,
  },
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
 * og «K-100» treffer «K100». Kompakt form brukes bare der kolonnen er merket
 * `compactColumns`, fordi det er der separatorer faktisk kan stå i veien.
 * `includeDeleted` er en bevisst opt-in for lister som skal vise slettede
 * rader (f.eks. kundelisten); standard er at mykt slettede rader aldri kommer
 * med.
 */
export type NormalizedSearchOptions = {
  /**
   * Begrens søket til én kunde. Bare tabeller som er merket `customerScoped`
   * i allowlisten kan bruke dette, slik at et kall aldri kan peke på en
   * tilfeldig kolonne.
   */
  customerId?: string;
};

export async function searchNormalizedIds(
  table: NormalizedSearchTable,
  query: string,
  limit: number,
  columns?: string[],
  includeDeleted = false,
  options: NormalizedSearchOptions = {},
): Promise<NormalizedSearchRow[]> {
  const config = normalizedTableConfig(table);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  if (options.customerId && !("customerScoped" in config)) {
    throw new Error(`Ugyldig kundefilter for tabellen ${table}`);
  }
  // Kompakt form uten separatorer, for numre der «+47 123 45 678» skal treffe
  // «4712345678». Brukes bare på kolonnene som er merket `compactColumns`.
  const compactQuery = normalizeSearchCompact(query);

  const selected = columns ?? [...config.columns];
  for (const column of selected) {
    if (!(config.columns as readonly string[]).includes(column)) {
      throw new Error(`Ugyldig kolonne for normalisert søk: ${table}.${column}`);
    }
  }
  if (selected.length === 0) return [];

  const take = takeLimit(limit);
  const terms: SearchTerms = {
    normalized: normalizedQuery,
    compact: compactQuery,
    // Tall-suffikser av den kompakte termen dekker tilfellet der kolonnen er
    // kortere enn søket: «+47 123 45 678» (kompakt «4712345678») skal treffe
    // et telefonnummer lagret som «12345678». Før ble det løst med
    // `strpos(term, kolonne) > 0`, som aldri kan bruke en indeks fordi
    // mønsteret kommer fra kolonnen. Nå matches hvert suffiks med LIKE, som er
    // indekserbart. Kravet om minst fem tegn gjør at en by som «Os» fortsatt
    // krever full match.
    suffixPatterns: compactSuffixPatterns(compactQuery),
  };
  const compactColumns = config.compactColumns as readonly string[];

  const contains = selected.map((column) =>
    columnMatchParts(
      normalizedColumnExpression(table, column),
      compactColumns.includes(column)
        ? compactNormalizedColumnExpression(table, column)
        : null,
      terms,
    ),
  );
  const exact = selected.map((column) =>
    columnExactParts(
      normalizedColumnExpression(table, column),
      compactColumns.includes(column)
        ? compactNormalizedColumnExpression(table, column)
        : null,
      terms,
    ),
  );
  const prefix = selected.map((column) =>
    columnPrefixParts(
      normalizedColumnExpression(table, column),
      compactColumns.includes(column)
        ? compactNormalizedColumnExpression(table, column)
        : null,
      terms,
    ),
  );

  // Kunder skal også matche når søkeordet står på en kontaktperson. Det gir
  // kundetreff uten at kontaktradene dupliseres i kundegruppen. Bare når
  // kalleren ikke har begrenset kolonnene eksplisitt.
  //
  // Kontaktmatchen ligger i en egen UNION-gren, ikke som `OR EXISTS (...)`, av
  // ytelsesgrunner: en OR med en subplan gjør at PostgreSQL ikke kan bruke
  // BitmapOr for de indekserte grenene, og da faller hele søket tilbake til
  // sekvensskanning. Grupperingen på id slår sammen treff fra begge grenene og
  // beholder den høyeste scoren, så resultat og rangering er uendret.
  const showDeleted = includeDeleted === true;
  const deletedFilter =
    config.hasDeletedAt && !showDeleted
      ? Prisma.sql`AND ${Prisma.raw(config.table)}."deletedAt" IS NULL`
      : Prisma.empty;
  const customerFilter = options.customerId
    ? Prisma.sql`AND ${Prisma.raw(config.table)}."customerId" = ${options.customerId}`
    : Prisma.empty;

  const matchContacts =
    columns === undefined && "matchContacts" in config && config.matchContacts;
  // `matchContacts` finnes bare på Customer, så joinen kan hardkodes til
  // "Customer" (Contact.customerId peker dit).
  const contactCompactColumns = NORMALIZED_SEARCH_TABLES.Contact
    .compactColumns as readonly string[];
  const contactBranch = matchContacts
    ? Prisma.sql`
      UNION ALL
      SELECT "Customer"."id" AS "id", 0.8 AS "score"
      FROM "Contact" ct
      JOIN "Customer" ON "Customer"."id" = ct."customerId"
      WHERE (
        ${Prisma.join(
          ["name", "email", "phone", "role"].map((column) =>
            columnMatchParts(
              normalizedSql(Prisma.raw(`ct."${column}"`)),
              contactCompactColumns.includes(column)
                ? compactNormalizedSql(Prisma.raw(`ct."${column}"`))
                : null,
              terms,
              // Kontaktradene er bare en ekstra treffkilde for kunden, så
              // vi beholder delstrengmatch uten trigram-likhet her.
              { similarity: false },
            ),
          ),
          " OR ",
        )}
      )
        ${deletedFilter}`
    : Prisma.empty;

  return prisma.$queryRaw<NormalizedSearchRow[]>(Prisma.sql`
    SELECT
      "id",
      MAX("score") AS "score",
      COUNT(*) OVER() AS "total"
    FROM (
      SELECT
        ${Prisma.raw(config.table)}."id" AS "id",
        CASE
          WHEN ${Prisma.join(exact, " OR ")} THEN 1
          WHEN ${Prisma.join(prefix, " OR ")} THEN 0.9
          ELSE 0.8
        END AS "score"
      FROM ${Prisma.raw(config.table)}
      WHERE (${Prisma.join(contains, " OR ")})
        ${customerFilter}
        ${deletedFilter}
      ${contactBranch}
    ) AS "hits"
    GROUP BY "id"
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
  /**
   * Avdelingssperre for rapporten. `undefined` betyr alle avdelinger (bare
   * administrator og `reports.viewAllDepartments`). `null` betyr ingen
   * avdeling og gir aldri treff.
   */
  departmentId?: string | null;
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
  const termLike = containsLike(normalizedQuery);

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
    ${normalizedReportNumber} LIKE ${termLike}
    OR ${normalizedName} LIKE ${termLike}
    OR ${normalizedTemplateTitle} LIKE ${termLike}
    OR ${normalizedComments} LIKE ${termLike}
    OR ${normalizedHmsType} LIKE ${termLike}
    OR ${normalizedWorkOrderTitle} LIKE ${termLike}
    OR ${normalizedCustomerName} LIKE ${termLike}
    OR EXISTS (
      SELECT 1 FROM "ReportUnit" ru
      WHERE ru."reportId" = r."id"
        AND ${normalizedSql(Prisma.raw('ru."answersJson"'))} LIKE ${termLike}
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
  if (options.departmentId !== undefined) {
    if (options.departmentId === null) {
      // Aktøren har ingen avdeling og ser derfor ingen rapporter.
      conditions.push(Prisma.sql`1 = 0`);
    } else {
      conditions.push(
        Prisma.sql`w."departmentId" = ${options.departmentId}`,
      );
    }
  }
  // Inaktive avdelinger er stengt for rapportsøk, også for globale lesere.
  conditions.push(
    Prisma.sql`EXISTS (
      SELECT 1 FROM "Department" d
      WHERE d."id" = w."departmentId" AND d."isActive"
    )`,
  );
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
 * Normaliserer en tekstkolonne med `fsm_search_norm`, den samme IMMUTABLE
 * funksjonen som uttrykksindeksene i migreringen
 * 20261112230000_search_expression_indexes er bygget på. Funksjonen gjør
 * nøyaktig det samme som `normalizeSearchText` i JS: lower case, unaccent,
 * ikke-alfanumeriske tegn blir mellomrom, og mellomrom trimmes/kollapses.
 *
 * Uttrykket MÅ være tekstlig identisk med indeksuttrykket, ellers kan ikke
 * PostgreSQL bruke indeksen. Ikke bytt funksjonskallet ut med den inline
 * varianten igjen.
 */
function normalizedSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`fsm_search_norm(${expression})`;
}

/**
 * Som `normalizedSql`, men fjerner også mellomrom. Speiler
 * `normalizeSearchCompact` i JS, slik at telefon-, org- og kundenumre matcher
 * uavhengig av separatorer. Uttrykket er skrevet nøyaktig slik
 * uttrykksindeksene i migreringen er definert (`replace(fsm_search_norm(...),
 * ' ', '')`), slik at PostgreSQL kan bruke dem.
 */
function compactNormalizedSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`replace(${normalizedSql(expression)}, ' ', '')`;
}

/** Søketermene i de formene SQL-en trenger dem. */
type SearchTerms = {
  /** `normalizeSearchText(query)` – med mellomrom. */
  normalized: string;
  /** `normalizeSearchCompact(query)` – uten mellomrom. */
  compact: string;
  /** LIKE-mønstre for tall-suffikser, se `compactSuffixPatterns`. */
  suffixPatterns: string[];
};

/**
 * LIKE-mønstre for hvert suffiks av et heltallig søk, med minst fem sifre.
 *
 * Brukes der kolonneverdien er kortere enn søket («+47 123 45 678» mot lagret
 * «12345678»). Suffiksvariantene erstatter den gamle
 * `strpos(term, kolonne) > 0`, som aldri kunne bruke en indeks fordi mønsteret
 * kom fra kolonnen. Bare rene tall gir suffikser, så et navnesøk som «gardshol»
 * aldri gir løse delstrengtreff.
 */
function compactSuffixPatterns(compact: string): string[] {
  if (!/^\d{6,}$/.test(compact)) return [];
  const patterns: string[] = [];
  const lastStart = compact.length - 5;
  for (let start = 1; start <= lastStart && patterns.length < 8; start++) {
    patterns.push(`%${compact.slice(start)}%`);
  }
  return patterns;
}

/** LIKE-mønster for «inneholder termen». Termen er normalisert i JS og kan
 *  derfor ikke inneholde jokertegn. */
function containsLike(term: string): string {
  return `%${term}%`;
}

/** LIKE-mønster for «starter med termen». */
function prefixLike(term: string): string {
  return `${term}%`;
}

/**
 * Delstrengmatch for én kolonne: normalisert form, kompakt form (bare der
 * separatorer kan stå i veien) og trigram-likhet på normalisert form.
 *
 * Alle variantene har en uttrykksindeks, slik at OR-et kan kjøres som BitmapOr
 * i stedet for sekvensskanning.
 */
function columnMatchParts(
  normalized: Prisma.Sql,
  compact: Prisma.Sql | null,
  terms: SearchTerms,
  options: { similarity?: boolean } = {},
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`${normalized} LIKE ${containsLike(terms.normalized)}`,
  ];
  if (compact) {
    parts.push(Prisma.sql`${compact} LIKE ${containsLike(terms.compact)}`);
    for (const pattern of terms.suffixPatterns) {
      parts.push(Prisma.sql`${compact} LIKE ${pattern}`);
    }
  }
  if (options.similarity !== false) {
    // Trigram-likhet gir skrivefeil-toleranse. Den sammenligner normaliserte
    // former, så samme indeks som LIKE brukes.
    parts.push(Prisma.sql`${normalized} % ${terms.normalized}`);
  }
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

/** Eksakt treff, brukt til score 1 i SELECT-delen. */
function columnExactParts(
  normalized: Prisma.Sql,
  compact: Prisma.Sql | null,
  terms: SearchTerms,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`${normalized} = ${terms.normalized}`];
  if (compact) parts.push(Prisma.sql`${compact} = ${terms.compact}`);
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

/** Prefikstreff, brukt til score 0,9 i SELECT-delen. */
function columnPrefixParts(
  normalized: Prisma.Sql,
  compact: Prisma.Sql | null,
  terms: SearchTerms,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`${normalized} LIKE ${prefixLike(terms.normalized)}`,
  ];
  if (compact) {
    parts.push(Prisma.sql`${compact} LIKE ${prefixLike(terms.compact)}`);
  }
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
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

  const normalizedFileName = normalizedSql(Prisma.raw('d."fileName"'));
  const compactFileName = compactNormalizedSql(Prisma.raw('d."fileName"'));

  // Filnavnet kan være kortere enn søket (f.eks. med «(1).pdf»-suffiks). Det
  // dekkes av tall-suffiksene i `compactSuffixPatterns`, som er indekserbare;
  // den gamle `strpos(term, kolonne)`-varianten kunne aldri bruke indeks.
  // Trigram-likheten sammenligner normaliserte former, så også den bruker
  // indeksen på fsm_search_norm("fileName").
  const filenameMatch = columnMatchParts(normalizedFileName, compactFileName, {
    normalized: normalizedQuery,
    compact: compactQuery,
    suffixPatterns: compactSuffixPatterns(compactQuery),
  });

  // `numnode` er 0 for tomme/stopword-only spørringer. Da hopper vi over
  // ts_headline, som ikke skal kjøres med en tom tsquery.
  const headline = Prisma.sql`CASE
    WHEN numnode(q.tsq) > 0 THEN ts_headline(
      'norwegian',
      -- Utdraget bygges fra sideteksten, som er kilden etter at contentText
      -- sluttet å bli lagret. Teksten leses av PostgreSQL og sendes aldri til
      -- Node, så minnebruken i app-prosessen er uendret.
      coalesce(d."title", '') || ' ' ||
      coalesce(d."description", '') || ' ' ||
      CASE
        WHEN d."pageTexts" IS NOT NULL AND btrim(d."pageTexts") LIKE '[%'
        THEN coalesce((
          SELECT string_agg(e->>'text', ' ')
          FROM jsonb_array_elements(d."pageTexts"::jsonb) AS e
        ), '')
        ELSE coalesce(d."contentText", '')
      END,
      q.tsq,
      'MaxFragments=2,MaxWords=18,MinWords=5'
    )
    ELSE left(coalesce(nullif(d."description", ''), d."title", ''), 160)
  END`;

  // Sideteksten ligger som JSON på dokumentet. Vi finner første side som
  // matcher den samme tsqueryen, uten å sende hele pageTexts til Node.
  const matchingPage = Prisma.sql`(
    SELECT (element->>'page')::int
    FROM jsonb_array_elements(
      CASE
        WHEN d."pageTexts" IS NULL OR btrim(d."pageTexts") = ''
          THEN '[]'::jsonb
        ELSE d."pageTexts"::jsonb
      END
    ) AS element
    WHERE numnode(q.tsq) > 0
      AND to_tsvector('norwegian', coalesce(element->>'text', '')) @@ q.tsq
    ORDER BY (element->>'page')::int
    LIMIT 1
  )`;

  const score = Prisma.sql`GREATEST(
    ts_rank(d."searchTsv", q.tsq) * 4,
    similarity(coalesce(d."fileName", ''), ${rawQuery}),
    CASE
      WHEN ${normalizedFileName} LIKE ${prefixLike(normalizedQuery)} THEN 1
      WHEN ${compactFileName} LIKE ${prefixLike(compactQuery)} THEN 0.95
      WHEN ${normalizedFileName} LIKE ${containsLike(normalizedQuery)} THEN 0.9
      WHEN ${compactFileName} LIKE ${containsLike(compactQuery)} THEN 0.85
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
      ${matchingPage} AS "page",
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
  const containsTerm = containsLike(normalizedQuery);

  return prisma.$queryRaw<NameSearchRow[]>(Prisma.sql`
    SELECT
      "id",
      CASE
        WHEN ${normalizedColumn} = ${normalizedQuery} THEN 1
        WHEN ${normalizedColumn} LIKE ${prefixLike(normalizedQuery)} THEN 0.9
        ELSE 0.8
      END AS "score",
      COUNT(*) OVER() AS "total"
    FROM ${Prisma.raw(field.table)}
    WHERE ${normalizedColumn} LIKE ${containsTerm}
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
  const compactQuery = normalizeSearchCompact(query);
  const containsTerm = containsLike(normalizedQuery);
  const containsCompact = containsLike(compactQuery);
  // Samme tall-suffikser som i det normaliserte søket, slik at et ordrenummer
  // lagret kortere enn søket fortsatt treffer uten `strpos(term, kolonne)`.
  const suffixPatterns = compactSuffixPatterns(compactQuery);
  const compactMatch = (expression: Prisma.Sql): Prisma.Sql =>
    Prisma.sql`(${Prisma.join(
      [
        Prisma.sql`${expression} LIKE ${containsCompact}`,
        ...suffixPatterns.map((pattern) => Prisma.sql`${expression} LIKE ${pattern}`),
      ],
      " OR ",
    )})`;
  const compactReference = compactNormalizedSql(Prisma.sql`w."reference"`);
  const compactOrderNumber = compactNormalizedSql(Prisma.sql`w."orderNumber"`);

  const rows = await prisma.$queryRaw<{ id: string; total: number | bigint }[]>(Prisma.sql`
    SELECT w."id", COUNT(*) OVER() AS "total"
    FROM "WorkOrder" w
    LEFT JOIN "Customer" c ON c."id" = w."customerId"
    WHERE w."deletedAt" IS NULL
      AND (
        ${normalizedSql(Prisma.sql`w."title"`)} LIKE ${containsTerm}
        OR ${normalizedSql(Prisma.sql`w."description"`)} LIKE ${containsTerm}
        OR ${compactMatch(compactReference)}
        OR ${compactMatch(compactOrderNumber)}
        OR ${normalizedSql(Prisma.sql`c."name"`)} LIKE ${containsTerm}
        OR ${normalizedSql(Prisma.sql`c."city"`)} LIKE ${containsTerm}
        OR ${normalizedSql(Prisma.sql`c."address"`)} LIKE ${containsTerm}
        OR EXISTS (
          SELECT 1
          FROM "_WorkOrderTags" wt
          JOIN "Tag" t ON t."id" = wt."A"
          WHERE wt."B" = w."id"
            AND ${normalizedSql(Prisma.sql`t."name"`)} LIKE ${containsTerm}
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
