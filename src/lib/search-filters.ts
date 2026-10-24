import type { Prisma } from "@prisma/client";
import { normalizeSearchText } from "@/lib/fuzzy";

/**
 * Søkefiltre som er felles for søkeresultatsiden og oppdragslisten.
 *
 * Funksjonene er rene og kan testes uten database. De bygger bare
 * Prisma-filtere; tilgangskontroll (`workOrderScope`) legges på av kalleren.
 */

/**
 * Filter for oppdragslistens fritekstsøk. Søker i de samme feltene som
 * brukeren forventer: tittel, beskrivelse, ordrenummer, tagger og kunde.
 *
 * `smartIds` kommer fra `searchWorkOrderIds` og fanger opp treff som bare
 * finnes etter normalisering (for eksempel «arlig-service» mot «Årlig
 * service»). Id-ene må være hentet uten tilgangskontroll, men dette filteret
 * brukes alltid sammen med `workOrderScope`, så det kan ikke utvide synligheten.
 */
export function workOrderListSearchWhere(
  search: string,
  smartIds: string[] = [],
): Prisma.WorkOrderWhereInput {
  const raw = search.trim();
  if (!raw) return {};

  const normalized = normalizeSearchText(raw);
  // Prøv både det brukeren skrev og den normaliserte formen. Det gir treff på
  // ordrenummer med bindestrek («2026-1042») og på normaliserte tag-navn.
  const terms = [...new Set([raw, normalized].filter(Boolean))];
  const or: Prisma.WorkOrderWhereInput[] = [];

  for (const term of terms) {
    const contains = { contains: term, mode: "insensitive" as const };
    or.push(
      { title: contains },
      { description: contains },
      { orderNumber: contains },
      { customer: { name: contains } },
      { customer: { city: contains } },
      { customer: { address: contains } },
      { tags: { some: { name: contains } } },
    );
  }

  if (smartIds.length > 0) {
    or.push({ id: { in: smartIds } });
  }

  return { OR: or };
}

/** Filter for «vis alle oppdrag med denne taggen»-lenker fra søket. */
export function workOrderTagWhere(tag?: string | null): Prisma.WorkOrderWhereInput {
  const name = tag?.trim();
  return name ? { tags: { some: { name } } } : {};
}

/**
 * Rapporttreff i det globale søket.
 *
 * Rapporter er bevisst ikke avdelingsbegrenset: de deles på tvers av regioner
 * for ansatte med rapporttilgang. Oppdrag, kommentarer og enheter er fortsatt
 * begrenset med `workOrderScope` i `performSearch`.
 */
export function reportSearchWhere(
  query: string,
  includeCancelled: boolean,
): Prisma.ReportWhereInput {
  return {
    comments: { contains: query, mode: "insensitive" },
    deletedAt: null,
    workOrder: {
      deletedAt: null,
      ...(includeCancelled ? {} : { status: { not: "CANCELLED" } }),
    },
  };
}
