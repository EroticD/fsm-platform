import type { Prisma } from "@prisma/client";
import { normalizeSearchText } from "@/lib/fuzzy";
import { HMS_FORM_TYPES } from "@/lib/hms";

/**
 * Søkefiltre som er felles for søkeresultatsiden og oppdragslisten.
 *
 * Filtreringen er bevisst enkel og streng: alle verdier valideres mot en
 * allowlist eller et lengde-/formatkrav før de brukes. Da kan en manipulent
 * URL aldri bli en del av en SQL-streng eller utvide tilgangen.
 */

/** Gruppe-typene det globale søket kan filtrere på. */
export const SEARCH_GROUP_KINDS = [
  "customer",
  "workOrder",
  "tag",
  "unit",
  "contact",
  "report",
  "comment",
  "user",
  "template",
  "folder",
  "document",
] as const;

export type SearchGroupKind = (typeof SEARCH_GROUP_KINDS)[number];

/** Arbeidsstatusene som kan filtreres på (samme verdier som WorkStatus). */
export const SEARCH_STATUS_VALUES = [
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "PENDING",
  "CANCELLED",
  "OPEN",
] as const;

export type SearchFilters = {
  /** Begrenser hvilke grupper som slås opp. */
  types?: string[];
  /** Arbeidsstatus for oppdrag og rapporter. */
  status?: string;
  /** Kunde-id. */
  customer?: string;
  /** Montør-id. */
  technician?: string;
  /** ISO-dato, YYYY-MM-DD (inklusive). */
  dateFrom?: string;
  /** ISO-dato, YYYY-MM-DD (inklusive). */
  dateTo?: string;
  /** Tag-navn. */
  tag?: string;
  /** HmsFormType-verdi. */
  hmsType?: string;
};

export const MAX_FILTER_VALUE_LENGTH = 64;
const MAX_TYPES = 12;

/** Id-er er cuid-er i dag, men vi godtar også tall og bindestrek. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ParamInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function readValues(params: ParamInput, key: string): string[] {
  if (params instanceof URLSearchParams) {
    return params.getAll(key);
  }
  const value = params[key];
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

/** Tar første ikke-tomme verdi. For lange verdier avvises hele verdien. */
function readSingle(params: ParamInput, key: string): string | undefined {
  for (const value of readValues(params, key)) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_FILTER_VALUE_LENGTH) return undefined;
    return trimmed;
  }
  return undefined;
}

function readList(params: ParamInput, key: string): string[] {
  return readValues(params, key)
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isSafeId(value: string | undefined): value is string {
  return Boolean(value && ID_PATTERN.test(value));
}

function isValidDate(value: string | undefined): value is string {
  if (!value || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Leser og validerer søkefiltre fra URL-en (eller et lagret søk).
 *
 * Ugyldige verdier forkastes i stedet for å gi en feil: et søk skal fortsatt
 * kunne vises om en gammel lenke har en statusverdi som er fjernet.
 */
export function parseSearchFilters(params: ParamInput): SearchFilters {
  const filters: SearchFilters = {};

  const types = [
    ...new Set(
      readList(params, "types")
        .map((type) =>
          (SEARCH_GROUP_KINDS as readonly string[]).find(
            (kind) => kind.toLowerCase() === type,
          ),
        )
        .filter((type): type is SearchGroupKind => Boolean(type)),
    ),
  ];
  if (types.length > 0) filters.types = types.slice(0, MAX_TYPES);

  const status = readSingle(params, "status")?.toUpperCase();
  if (status && (SEARCH_STATUS_VALUES as readonly string[]).includes(status)) {
    filters.status = status;
  }

  const customer = readSingle(params, "customer");
  if (isSafeId(customer)) filters.customer = customer;

  const technician = readSingle(params, "technician");
  if (isSafeId(technician)) filters.technician = technician;

  const dateFrom = readSingle(params, "dateFrom");
  if (isValidDate(dateFrom)) filters.dateFrom = dateFrom;

  const dateTo = readSingle(params, "dateTo");
  if (isValidDate(dateTo)) filters.dateTo = dateTo;

  const tag = readSingle(params, "tag");
  if (tag) filters.tag = tag;

  const hmsType = readSingle(params, "hmsType")?.toUpperCase();
  if (hmsType && (HMS_FORM_TYPES as readonly string[]).includes(hmsType)) {
    filters.hmsType = hmsType;
  }

  return filters;
}

/**
 * Serialiserer filtre til en URL-query uten ledende `?`. Brukes av lagrede
 * søk og av «se alle»-lenker, slik at et søk kan gjenopprettes eksakt.
 */
export function serializeSearchFilters(filters: SearchFilters | null | undefined): string {
  const parsed = parseSearchFilters((filters ?? {}) as Record<string, string | string[] | undefined>);
  const params = new URLSearchParams();

  if (parsed.types?.length) params.set("types", parsed.types.join(","));
  if (parsed.status) params.set("status", parsed.status);
  if (parsed.customer) params.set("customer", parsed.customer);
  if (parsed.technician) params.set("technician", parsed.technician);
  if (parsed.dateFrom) params.set("dateFrom", parsed.dateFrom);
  if (parsed.dateTo) params.set("dateTo", parsed.dateTo);
  if (parsed.tag) params.set("tag", parsed.tag);
  if (parsed.hmsType) params.set("hmsType", parsed.hmsType);

  return params.toString();
}

export function hasActiveFilters(filters: SearchFilters | null | undefined): boolean {
  return serializeSearchFilters(filters).length > 0;
}

/** Datointervallet som Prisma-filter. `dateTo` er inklusive hele dagen. */
export function dateRangeWhere(
  filters: Pick<SearchFilters, "dateFrom" | "dateTo">,
): { gte?: Date; lte?: Date } | undefined {
  const range: { gte?: Date; lte?: Date } = {};
  if (filters.dateFrom) range.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) range.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
  return range.gte || range.lte ? range : undefined;
}

/**
 * Felles filter for oppdrag. Tilgangskontroll (`workOrderScope`) legges alltid
 * på av kalleren, så dette filteret kan aldri utvide synligheten.
 */
export function workOrderFilterWhere(
  filters: SearchFilters,
): Prisma.WorkOrderWhereInput {
  const where: Prisma.WorkOrderWhereInput = {};

  if (filters.status) where.status = filters.status as Prisma.WorkOrderWhereInput["status"];
  if (filters.customer) where.customerId = filters.customer;
  if (filters.technician) where.technicians = { some: { id: filters.technician } };
  if (filters.tag) where.tags = { some: { name: filters.tag } };

  const range = dateRangeWhere(filters);
  if (range) where.scheduledFor = range;

  return where;
}

/** Filter for oppdragslistens fritekstsøk. */
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
 *
 * @deprecated Bruk `searchReports` i `search-sql.ts`, som også søker i
 * rapportnummer, malnavn, HMS-type og sjekkpunkt-svar.
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
