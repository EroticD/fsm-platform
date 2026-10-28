import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { normalizeSearchText } from "@/lib/fuzzy";

/**
 * Normaliserer en tekstkolonne på samme måte som `normalizeSearchText`:
 * lower case, unaccent (inkludert æ/ø/å), tegnsetting blir mellomrom og
 * mellomrom trimmes/kollapses.
 */
function normalizedSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`btrim(regexp_replace(lower(unaccent(coalesce(${expression}, ''))), '[^a-z0-9]+', ' ', 'g'))`;
}

/** Samme normalisering, men uten mellomrom – for kompakte treff. */
function compactSql(expression: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`replace(${normalizedSql(expression)}, ' ', '')`;
}

/**
 * Finner dokument-ID-er der søket matcher tittel, beskrivelse, filnavn eller
 * et tag-navn – uten at tegnsetting, bindestreker eller æ/ø/å avgjør treffet.
 *
 * Kolonnene er faste, og både søkeord og søkeord uten mellomrom sendes som
 * parametere. `contentText`/`pageTexts` leses aldri, verken i SQL-en eller inn
 * i Node. Kalleren kombinerer ID-ene med sletting og tag-filter i Prisma, slik
 * at tilgangskontroll og papirkurv fortsatt gjelder.
 */
export async function findDocumentIdsBySearch(
  query: string,
): Promise<string[]> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const term = Prisma.sql`${normalizedQuery}`;
  const compactTerm = Prisma.sql`${compactQuery}`;

  // Faste kolonner – aldri brukerstyrt SQL.
  const fields = ["title", "description", "fileName"] as const;
  const conditions: Prisma.Sql[] = [];
  for (const column of fields) {
    const expression = Prisma.raw(`d."${column}"`);
    conditions.push(
      Prisma.sql`strpos(${normalizedSql(expression)}, ${term}) > 0`,
      Prisma.sql`strpos(${compactSql(expression)}, ${compactTerm}) > 0`,
    );
  }

  const normalizedTag = normalizedSql(Prisma.raw('t."name"'));
  const compactTag = compactSql(Prisma.raw('t."name"'));
  conditions.push(Prisma.sql`EXISTS (
    SELECT 1
    FROM "_DocumentTagRelation" dt
    JOIN "DocumentTag" t ON t."id" = dt."B"
    WHERE dt."A" = d."id"
      AND (
        strpos(${normalizedTag}, ${term}) > 0
        OR strpos(${compactTag}, ${compactTerm}) > 0
      )
  )`);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT d."id"
    FROM "Document" d
    WHERE (${Prisma.join(conditions, " OR ")})
    ORDER BY d."id" ASC
  `);

  return rows.map((row) => row.id);
}
