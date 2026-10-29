import prisma from "@/lib/prisma";
import { markdownToPlainText } from "@/lib/markdown";
import { fuzzyScore, normalizeSearchText } from "@/lib/fuzzy";
import { formatDate } from "@/lib/dates";
import { WorkStatus, type Prisma } from "@prisma/client";
import { departmentUsersScope, workOrderScope, type AccessUser } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";
import { canViewAllDepartmentReports } from "@/lib/report-scope";
import {
  parseSearchFilters,
  workOrderFilterWhere,
  type SearchFilters,
} from "@/lib/search-filters";
import {
  searchBySubstring,
  searchByName,
  searchDocuments,
  searchNormalizedIds,
  searchReports,
  searchWorkOrderIdsWithTotal,
  type DocumentSearchRow,
  type NameSearchRow,
} from "@/lib/search-sql";

export type { SearchFilters } from "@/lib/search-filters";

export type SearchItem = {
  id: string;
  title: string;
  /**
   * Utdatert reservefelt. Nye kallsteder skal bruke `subtitleParts` (eller
   * `subtitleKey`) og oversette ved visning. Feltet beholdes bare for eldre
   * konsumenter i overgangen.
   */
  subtitle?: string;
  /** i18n-nøkkel for en enkel undertittel, relativ til `common`. */
  subtitleKey?: string;
  /** Parametre til `subtitleKey`. */
  subtitleParams?: Record<string, string | number>;
  /**
   * Sammensatt undertittel. Hver del er enten en i18n-nøkkel med parametre
   * eller rå data som allerede er på riktig språk (navn, datoer, fritekst).
   */
  subtitleParts?: SearchSubtitlePart[];
  href: string;
  /**
   * Direkte fil-/PDF-lenke når hovedtreffet peker på en visningsside. Vises
   * som en sekundær handling og åpnes i ny fane.
   */
  directHref?: string;
  /** i18n-nøkkel for den sekundære handlingen. */
  directLabelKey?: string;
  /** Relevans 0–1. Høyere er bedre. */
  score?: number;
};

export type SearchSubtitlePart = {
  /** i18n-nøkkel relativ til `common`. Utelates for rå data. */
  key?: string;
  params?: Record<string, string | number>;
  /** Rå, allerede formatert data (navn, dato, brukerinnhold). */
  text?: string;
};

export type SearchGroup = {
  kind: string;
  /** Utdatert reserveetikett; bruk `labelKey` og oversett ved visning. */
  label: string;
  /** i18n-nøkkel for gruppeetiketten, relativ til `common`. */
  labelKey?: string;
  icon: string;
  /** Antall treff i gruppen. Se `capped` når kandidatgrensen er nådd. */
  total: number;
  /**
   * Sann når det finnes flere treff enn kandidatgrensen. Da er `total` et
   * eksplisitt tak (ikke et løgnaktig nøyaktig tall), og UI kan vise «N+».
   */
  capped?: boolean;
  items: SearchItem[];
};

export type SearchResults = {
  query: string;
  total: number;
  groups: SearchGroup[];
  /** Sann når minst én gruppe er begrenset av kandidatgrensen. */
  capped?: boolean;
  tookMs?: number;
};

export type SearchOptions = {
  /** Brukeren som søker. Styrer avdelingssynlige oppdrag, kommentarer og ansatte. */
  user: AccessUser;
  /** Kontoret kan søke i kansellerte oppdrag; montørene skal ikke se dem. */
  includeCancelled?: boolean;
  /** 1-basert side. */
  page?: number;
  /** Antall treff per gruppe. Nedtrekket bruker 5, /sok bruker 20. */
  pageSize?: number;
  filters?: SearchFilters;
  /** Intern sti som treffene kan bruke som «tilbake»-mål. */
  returnTo?: string;
};

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
/** Hvor mange kandidater vi henter per gruppe før fuzzy-rangering. */
const CANDIDATES = 500;
const MAX_QUERY_LENGTH = 100;

/** Rekkefølgen gruppene vises i når relevansen er lik. */
const GROUP_ORDER = [
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

function joinInfo(parts: (string | null | undefined | false)[]) {
  return parts.filter(Boolean).join(" • ");
}

/** Filtrerer bort tomme undertitteldeler. */
function subtitleParts(
  ...entries: Array<SearchSubtitlePart | null | undefined | false>
): SearchSubtitlePart[] {
  return entries.filter(
    (entry): entry is SearchSubtitlePart =>
      Boolean(entry && (entry.key || entry.text)),
  );
}

function statusPart(status: string): SearchSubtitlePart {
  return { key: `components.search.statuses.${status}` };
}

const ROLE_KEY: Record<string, string> = {
  ADMIN: "roleAdmin",
  OFFICE: "roleOffice",
  TECHNICIAN: "roleTechnician",
  CUSTOMER: "roleCustomer",
};

/** Bare interne stier kan brukes som returmål; aldri en ekstern URL. */
function safeReturnTo(value: string | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 1000) return null;
  if (raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function withReturnTo(href: string, returnTo: string | null): string {
  if (!returnTo) return href;
  return `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
}

/** Fjerner ts_headline-markeringene (<b> … </b>) før teksten vises som ren tekst. */
function snippetText(snippet: string | null | undefined): string | null {
  if (!snippet) return null;
  return snippet
    .replace(/<\/?b>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(Math.max(parsed, min), max);
}

type MergedHits = {
  ids: string[];
  scores: Map<string, number>;
};

/** Slår sammen treff fra flere trigram-/normaliserte søk og beholder høyeste score. */
function mergeHits(...lists: NameSearchRow[][]): MergedHits {
  const best = new Map<string, number>();
  for (const list of lists) {
    for (const hit of list) {
      const score = Number(hit.score) || 0;
      if (score > (best.get(hit.id) ?? -1)) best.set(hit.id, score);
    }
  }

  const sorted = [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CANDIDATES);

  return {
    ids: sorted.map(([id]) => id),
    scores: new Map(sorted),
  };
}

/**
 * Antall treff før LIMIT. SQL-funksjonene returnerer `COUNT(*) OVER()` på
 * hver rad, slik at vi får et ekte totaltall uten en ekstra telling.
 */
function rowsTotal(rows: Array<{ total?: number | bigint | null }>): number {
  return Number(rows[0]?.total ?? 0) || 0;
}

/**
 * Et gruppetotal som aldri påstår mer enn vi faktisk kan paginere til.
 * Er det flere treff enn kandidatgrensen, markeres gruppen som `capped`.
 */
function boundedTotal(
  exact: number,
  sourceTotal = exact,
): { total: number; capped: boolean } {
  const available = Math.max(exact, sourceTotal);
  if (available > CANDIDATES) {
    return { total: CANDIDATES, capped: true };
  }
  return { total: Math.min(exact, CANDIDATES), capped: false };
}

/**
 * Kjernesøkelogikken — brukes av både det globale hurtigsøket (/api/search)
 * og søkeresultatsiden (/sok).
 *
 * Kandidatene hentes via fulltekst- og trigram-indekser. Alle grupper får ekte
 * totaltall og pagineres, og hvert treff har en relevansscore. Tilgangskontroll
 * legges på hver databaseforespørsel, aldri etter at data er hentet.
 */
export async function performSearch(
  query: string,
  options: SearchOptions,
): Promise<SearchResults> {
  const started = Date.now();
  const originalQuery = String(query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  // All matching skjer på normalisert form. Det gjør «arlig-service» lik
  // «Årlig service» og «2026-1042» lik «NO-2026-1042».
  const q = normalizeSearchText(originalQuery);
  const filters = parseSearchFilters(
    (options.filters ?? {}) as Record<string, string | string[] | undefined>,
  );
  const page = clampInt(options.page, 1, 1, 10_000);
  const pageSize = clampInt(options.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  if (q.length < 2) {
    return { query: originalQuery, total: 0, groups: [], tookMs: Date.now() - started };
  }

  const includeCancelled = options.includeCancelled ?? false;
  const user = options.user;
  const returnTo = safeReturnTo(options.returnTo);
  const selectedTypes = filters.types ? new Set(filters.types) : null;
  const wants = (kind: string) => !selectedTypes || selectedTypes.has(kind);

  // Søket skal bare vise kategorier brukeren faktisk har tilgang til.
  const canCustomers = hasPermission(user, "customers.view");
  const canWorkOrders = hasPermission(user, "workorders.view");
  const canEquipment = hasPermission(user, "equipment.view");
  const canReports = hasPermission(user, "reports.view");
  // Uten reports.viewAllDepartments er også rapportsøket avdelingssperret.
  // `undefined` slår av filteret for dem som ser hele organisasjonen.
  const reportDepartmentId = canViewAllDepartmentReports(user)
    ? undefined
    : user.departmentId ?? null;
  const canUsers = hasPermission(user, "users.view");
  // Det finnes ingen egen leservisning for maler; treffene lenker til editoren.
  const canTemplates = hasPermission(user, "templates.manage");
  const canDocuments = hasPermission(user, "documents.view");

  if (
    !canCustomers &&
    !canWorkOrders &&
    !canEquipment &&
    !canReports &&
    !canUsers &&
    !canTemplates &&
    !canDocuments
  ) {
    return { query: originalQuery, total: 0, groups: [], tookMs: Date.now() - started };
  }

  const noRows = { id: { in: [] as string[] } };

  const commentAccess =
    canWorkOrders || canCustomers
      ? {
          OR: [
            ...(canWorkOrders
              ? [
                  {
                    AND: [
                      { workOrderId: { not: null } },
                      {
                        workOrder: {
                          ...workOrderScope(user),
                          ...(includeCancelled
                            ? {}
                            : { status: { not: WorkStatus.CANCELLED } }),
                        },
                      },
                    ],
                  },
                ]
              : []),
            ...(canCustomers
              ? [
                  {
                    workOrderId: null,
                    OR: [
                      { customer: { deletedAt: null } },
                      { contact: { customer: { deletedAt: null } } },
                      { customerId: null, contactId: null },
                    ],
                  },
                ]
              : []),
          ],
        }
      : noRows;

  // Hvor mange kandidater vi trenger for å kunne svare på denne siden.
  const fetchLimit = Math.min(CANDIDATES, Math.max(pageSize * page * 2, 25));

  // Første runde: indekserte kandidatsøk. Ingen av disse leser store
  // tekstfelt eller hele tabeller. Hver gruppe slås bare opp når den er valgt.
  const [
    customerNameHits,
    customerCityHits,
    customerNormalizedHits,
    productModelHits,
    productNormalizedHits,
    contactHits,
    workOrderTitleHits,
    workOrderTitleSubstringHits,
    workOrderNumberHits,
    workOrderNormalizedHits,
    tagHits,
    userHits,
    templateHits,
    folderHits,
    commentHits,
    documentHits,
  ] = await Promise.all([
    wants("customer") && canCustomers
      ? searchByName("Customer", "name", originalQuery, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("customer") && canCustomers
      ? searchByName("Customer", "city", originalQuery, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    // Alle feltene på kundekortet: navn, kundenummer, orgnummer, telefon,
    // e-post, adresse, postnummer, sted og notater. Kontaktpersoner matcher
    // også kunden via `matchContacts` i search-sql.
    wants("customer") && canCustomers
      ? searchNormalizedIds("Customer", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("unit") && canEquipment
      ? searchByName("Product", "model", originalQuery, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("unit") && canEquipment
      ? searchNormalizedIds("Product", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("contact") && canCustomers
      ? searchNormalizedIds("Contact", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("workOrder") && canWorkOrders
      ? searchByName("WorkOrder", "title", originalQuery, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("workOrder") && canWorkOrders
      ? searchBySubstring("WorkOrder", "title", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("workOrder") && canWorkOrders
      ? searchBySubstring("WorkOrder", "orderNumber", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("workOrder") && canWorkOrders
      ? searchWorkOrderIdsWithTotal(q, CANDIDATES).then(({ ids, total }) =>
          ids.map((id, index) => ({
            id,
            score: Math.max(0.3, 1 - index / CANDIDATES),
            total,
          })),
        )
      : Promise.resolve([] as NameSearchRow[]),
    wants("tag") && canWorkOrders
      ? searchBySubstring("Tag", "name", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("user") && canUsers
      ? searchNormalizedIds("User", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("template") && canTemplates
      ? searchNormalizedIds("Template", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("folder") && canDocuments
      ? searchNormalizedIds("DocumentFolder", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("comment") && (canWorkOrders || canCustomers)
      ? searchNormalizedIds("Comment", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    wants("document") && canDocuments
      ? searchDocuments(originalQuery, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
  ]);

  // Rapporter har eget fulltekstsøk som også returnerer ekte totaltall. Her
  // pagineres det i databasen med OFFSET, slik at side 30 ikke blir tom selv
  // om det finnes tusenvis av treff.
  const reportHits =
    wants("report") && canReports
      ? await searchReports(originalQuery, {
          limit: pageSize,
          offset: (page - 1) * pageSize,
          includeCancelled,
          filters,
          departmentId: reportDepartmentId,
        })
      : [];

  // OFFSET forbi siste treff gir ingen rader, og da finnes ikke totalen i
  // radene. Gjør ett billig probe-kall slik at gruppen fortsatt viser riktig
  // total i stedet for å forsvinne på en ugyldig sideside.
  let reportTotal = reportHits[0]?.total ?? 0;
  if (reportHits.length === 0 && page > 1 && wants("report") && canReports) {
    const probe = await searchReports(originalQuery, {
      limit: 1,
      offset: 0,
      includeCancelled,
      filters,
      departmentId: reportDepartmentId,
    });
    reportTotal = probe[0]?.total ?? 0;
  }

  const customerHits = mergeHits(
    customerNameHits,
    customerCityHits,
    customerNormalizedHits,
  );
  const productHits = mergeHits(productModelHits, productNormalizedHits);
  const workOrderHits = mergeHits(
    workOrderTitleHits,
    workOrderTitleSubstringHits,
    workOrderNumberHits,
    workOrderNormalizedHits,
  );
  const tagHitsMerged = mergeHits(tagHits);
  const contactHitsMerged = mergeHits(contactHits);
  const userHitsMerged = mergeHits(userHits);
  const templateHitsMerged = mergeHits(templateHits);
  const folderHitsMerged = mergeHits(folderHits);
  const commentHitsMerged = mergeHits(commentHits);

  const workOrderFilter = workOrderFilterWhere(filters);
  const tagFilter = filters.tag ? { name: filters.tag } : undefined;

  // Andre runde: hent bare feltene vi trenger for visning og rangering.
  // Alle `where`-objektene nedenfor gjenbrukes til telling, slik at totaltallet
  // har nøyaktig samme omfang og filter som listen.
  const customerWhere = canCustomers && wants("customer")
    ? {
        AND: [
          { deletedAt: null },
          { id: { in: customerHits.ids } },
          ...(filters.customer ? [{ id: filters.customer }] : []),
        ],
      }
    : noRows;

  const contactWhere = canCustomers && wants("contact")
    ? {
        AND: [
          { id: { in: contactHitsMerged.ids } },
          {
            customer: {
              deletedAt: null,
              ...(filters.customer ? { id: filters.customer } : {}),
            },
          },
        ],
      }
    : noRows;

  const productWhere = canEquipment && wants("unit")
    ? {
        AND: [
          { id: { in: productHits.ids } },
          {
            customer: {
              deletedAt: null,
              ...(filters.customer ? { id: filters.customer } : {}),
            },
          },
        ],
      }
    : noRows;

  const workOrderWhere = canWorkOrders && wants("workOrder")
    ? {
        AND: [
          workOrderScope(user),
          ...(includeCancelled ? [] : [{ status: { not: WorkStatus.CANCELLED } }]),
          workOrderFilter,
          {
            OR: [
              { id: { in: workOrderHits.ids } },
              ...(tagHitsMerged.ids.length > 0
                ? [{ tags: { some: { id: { in: tagHitsMerged.ids } } } }]
                : []),
            ],
          },
        ],
      }
    : noRows;

  const tagWhere = canWorkOrders && wants("tag")
    ? {
        AND: [
          { id: { in: tagHitsMerged.ids } },
          ...(tagFilter ? [tagFilter] : []),
          {
            workOrders: {
              some: {
                AND: [
                  workOrderScope(user),
                  ...(includeCancelled
                    ? []
                    : [{ status: { not: WorkStatus.CANCELLED } }]),
                  workOrderFilter,
                ],
              },
            },
          },
        ],
      }
    : noRows;

  const userWhere = canUsers && wants("user")
    ? { AND: [{ id: { in: userHitsMerged.ids } }, departmentUsersScope(user)] }
    : noRows;

  const templateWhere = canTemplates && wants("template")
    ? {
        AND: [
          { id: { in: templateHitsMerged.ids } },
          ...(filters.hmsType
            ? [{ hmsType: filters.hmsType as Prisma.TemplateWhereInput["hmsType"] }]
            : []),
        ],
      }
    : noRows;

  const folderWhere = canDocuments && wants("folder")
    ? { id: { in: folderHitsMerged.ids } }
    : noRows;

  const commentCustomerFilter = filters.customer
    ? {
        OR: [
          { customerId: filters.customer },
          { workOrder: { customerId: filters.customer } },
          { contact: { customerId: filters.customer } },
        ],
      }
    : null;

  const commentWhere =
    wants("comment") && (canWorkOrders || canCustomers)
      ? {
          AND: [
            { id: { in: commentHitsMerged.ids } },
            commentAccess,
            ...(commentCustomerFilter ? [commentCustomerFilter] : []),
          ],
        }
      : noRows;

  const documentRows = documentHits as DocumentSearchRow[];
  const documentWhere = canDocuments && wants("document")
    ? { id: { in: documentRows.map((hit) => hit.id) }, deletedAt: null }
    : noRows;

  const reportWhere = canReports && wants("report")
    ? { id: { in: reportHits.map((hit) => hit.id) }, deletedAt: null }
    : noRows;

  const [
    customers,
    contacts,
    units,
    workOrders,
    tags,
    reports,
    comments,
    users,
    templates,
    folders,
    documents,
    customerTotal,
    contactTotal,
    productTotal,
    workOrderTotal,
    tagTotal,
    userTotal,
    templateTotal,
    folderTotal,
    commentTotal,
    documentTotal,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: customerWhere,
      select: {
        id: true,
        name: true,
        customerNumber: true,
        orgNumber: true,
        city: true,
        phone: true,
        email: true,
        address: true,
        postalCode: true,
        // Notater brukes bare til rangering og vises aldri i trefflisten.
        notes: true,
      },
      take: fetchLimit,
    }),
    prisma.contact.findMany({
      where: contactWhere,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        customerId: true,
        customer: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: fetchLimit,
    }),
    prisma.product.findMany({
      where: productWhere,
      select: {
        id: true,
        model: true,
        serialNumber: true,
        location: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
      },
      take: fetchLimit,
    }),
    prisma.workOrder.findMany({
      where: workOrderWhere,
      select: {
        id: true,
        title: true,
        orderNumber: true,
        description: true,
        creatorName: true,
        status: true,
        scheduledFor: true,
        customer: { select: { name: true } },
        tags: { select: { id: true, name: true, color: true } },
        technicians: { select: { id: true, name: true } },
      },
      take: fetchLimit,
    }),
    prisma.tag.findMany({
      where: tagWhere,
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
      take: fetchLimit,
    }),
    canReports && wants("report")
      ? prisma.report.findMany({
          where: reportWhere,
          include: {
            template: { select: { title: true } },
            workOrder: {
              select: {
                id: true,
                title: true,
                customer: { select: { name: true } },
                reports: {
                  where: { deletedAt: null },
                  select: { id: true },
                  // Nok til å avgjøre om oppdraget har én eller flere
                  // sjekklister; selve PDF-en rendres avgrenset senere.
                  take: 50,
                },
              },
            },
          },
          orderBy: { completedAt: "desc" },
          take: fetchLimit,
        })
      : Promise.resolve([]),
    prisma.comment.findMany({
      where: commentWhere,
      include: {
        workOrder: { select: { id: true, title: true } },
        customer: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, customerId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: fetchLimit,
    }),
    prisma.user.findMany({
      where: userWhere,
      include: { roleDefinition: { select: { label: true } } },
      orderBy: { name: "asc" },
      take: fetchLimit,
    }),
    prisma.template.findMany({
      where: templateWhere,
      orderBy: { title: "asc" },
      take: fetchLimit,
    }),
    prisma.documentFolder.findMany({
      where: folderWhere,
      orderBy: { name: "asc" },
      take: fetchLimit,
    }),
    prisma.document.findMany({
      where: documentWhere,
      select: {
        id: true,
        title: true,
        description: true,
        fileName: true,
        filePath: true,
        tags: { select: { name: true } },
      },
      take: fetchLimit,
    }),
    canCustomers && wants("customer")
      ? prisma.customer.count({ where: customerWhere })
      : Promise.resolve(0),
    canCustomers && wants("contact")
      ? prisma.contact.count({ where: contactWhere })
      : Promise.resolve(0),
    canEquipment && wants("unit")
      ? prisma.product.count({ where: productWhere })
      : Promise.resolve(0),
    canWorkOrders && wants("workOrder")
      ? prisma.workOrder.count({ where: workOrderWhere })
      : Promise.resolve(0),
    canWorkOrders && wants("tag")
      ? prisma.tag.count({ where: tagWhere })
      : Promise.resolve(0),
    canUsers && wants("user")
      ? prisma.user.count({ where: userWhere })
      : Promise.resolve(0),
    canTemplates && wants("template")
      ? prisma.template.count({ where: templateWhere })
      : Promise.resolve(0),
    canDocuments && wants("folder")
      ? prisma.documentFolder.count({ where: folderWhere })
      : Promise.resolve(0),
    (canWorkOrders || canCustomers) && wants("comment")
      ? prisma.comment.count({ where: commentWhere })
      : Promise.resolve(0),
    canDocuments && wants("document")
      ? prisma.document.count({ where: documentWhere })
      : Promise.resolve(0),
  ]);

  const documentById = new Map(documentRows.map((hit) => [hit.id, hit]));

  // Ekte kandidattall fra SQL (COUNT(*) OVER()). For grupper som slår sammen
  // flere kilder er unionen aldri større enn summen, men kildetallet er nok
  // til å vite om vi har nådd kandidatgrensen. Da viser vi et eksplisitt tak i
  // stedet for et totaltall brukeren aldri kan paginere til.
  const totals = {
    customer: boundedTotal(
      customerTotal,
      Math.max(
        rowsTotal(customerNameHits),
        rowsTotal(customerCityHits),
        rowsTotal(customerNormalizedHits),
      ),
    ),
    contact: boundedTotal(contactTotal, rowsTotal(contactHits)),
    unit: boundedTotal(
      productTotal,
      Math.max(rowsTotal(productModelHits), rowsTotal(productNormalizedHits)),
    ),
    workOrder: boundedTotal(
      workOrderTotal,
      Math.max(
        rowsTotal(workOrderTitleHits),
        rowsTotal(workOrderTitleSubstringHits),
        rowsTotal(workOrderNumberHits),
        rowsTotal(workOrderNormalizedHits),
      ),
    ),
    tag: boundedTotal(tagTotal, rowsTotal(tagHits)),
    user: boundedTotal(userTotal, rowsTotal(userHits)),
    template: boundedTotal(templateTotal, rowsTotal(templateHits)),
    folder: boundedTotal(folderTotal, rowsTotal(folderHits)),
    comment: boundedTotal(commentTotal, rowsTotal(commentHits)),
    document: boundedTotal(documentTotal, rowsTotal(documentRows)),
    // Rapporter pagineres i databasen og har alltid et ekte totaltall.
    report: { total: reportTotal, capped: false },
  };

  type Scored<T> = { item: T; score: number };

  /** Rangerer en kandidatliste med fuzzy + databasescore. */
  function rank<T>(
    items: T[],
    getId: (item: T) => string,
    getFields: (item: T) => (string | null | undefined)[],
    dbScores?: Map<string, number>,
  ): Scored<T>[] {
    return items
      .map((item) => {
        const id = getId(item);
        const db = dbScores?.get(id) ?? 0;
        const fuzzy = fuzzyScore(q, ...getFields(item));
        // Databasescoren løfter typo-/bøyningstreff som fuzzy-scoren ikke
        // fanger, men et rent teksttreff veier tyngst.
        const score = fuzzy > 0 ? Math.min(1, fuzzy * 0.75 + db * 0.25) : db * 0.5;
        return { item, score, db };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.db - a.db ||
          getId(a.item).localeCompare(getId(b.item)),
      )
      .slice(0, fetchLimit)
      .map(({ item, score }) => ({ item, score }));
  }

  /** Paginerer en allerede rangert liste. */
  function pageItems<T>(entries: Scored<T>[]): Scored<T>[] {
    const start = (page - 1) * pageSize;
    return entries.slice(start, start + pageSize);
  }

  const rankedCustomers = pageItems(
    rank(customers, (c) => c.id, (c) => [c.name, c.customerNumber, c.orgNumber, c.city, c.phone, c.email, c.address, c.postalCode, c.notes], customerHits.scores),
  );
  const rankedContacts = pageItems(
    rank(contacts, (c) => c.id, (c) => [c.name, c.email, c.phone, c.role, c.customer?.name], contactHitsMerged.scores),
  );
  const rankedUnits = pageItems(
    rank(units, (p) => p.id, (p) => [p.model, p.serialNumber, p.location, p.customer?.name], productHits.scores),
  );
  const rankedWorkOrders = pageItems(
    rank(
      workOrders,
      (wo) => wo.id,
      (wo) => [
        wo.title,
        wo.orderNumber,
        wo.description,
        wo.creatorName,
        wo.customer?.name,
        ...wo.technicians.map((technician) => technician.name),
        ...wo.tags.map((tag) => tag.name),
      ],
      workOrderHits.scores,
    ),
  );
  const rankedTags = pageItems(
    rank(tags, (tag) => tag.id, (tag) => [tag.name], tagHitsMerged.scores),
  );
  const reportById = new Map(reports.map((report) => [report.id, report]));
  // Reportsøket er allerede paginert i SQL. Behold SQL-rekkefølgen og ikke
  // paginer på nytt i JS, ellers ville side 2 blitt tom.
  const rankedReports: Scored<(typeof reports)[number]>[] = reportHits.flatMap(
    (hit) => {
      const item = reportById.get(hit.id);
      return item ? [{ item, score: Number(hit.score) || 0 }] : [];
    },
  );
  const rankedComments = pageItems(
    rank(
      comments,
      (c) => c.id,
      (c) => [c.content, c.authorName, c.workOrder?.title, c.customer?.name, c.contact?.name],
      commentHitsMerged.scores,
    ),
  );
  const rankedUsers = pageItems(
    rank(users, (u) => u.id, (u) => [u.name, u.email], userHitsMerged.scores),
  );
  const rankedTemplates = pageItems(
    rank(templates, (t) => t.id, (t) => [t.title, t.reportName, t.description], templateHitsMerged.scores),
  );
  const rankedFolders = pageItems(
    rank(folders, (f) => f.id, (f) => [f.name], folderHitsMerged.scores),
  );
  const rankedDocuments = pageItems(
    rank(
      documents,
      (d) => d.id,
      (d) => [d.title, d.description, d.fileName, documentById.get(d.id)?.snippet],
      new Map(documentRows.map((hit) => [hit.id, Number(hit.score) || 0])),
    ),
  );

  const groups: SearchGroup[] = [
    {
      kind: "customer",
      label: "Kunder",
      labelKey: "components.search.groups.customer",
      icon: "🏢",
      total: totals.customer.total,
      capped: totals.customer.capped,
      items: rankedCustomers.map(({ item: c, score }) => ({
        id: c.id,
        title: c.name,
        subtitleParts: subtitleParts(
          c.customerNumber
            ? {
                key: "components.search.subtitles.customerNumber",
                params: { number: c.customerNumber },
              }
            : null,
          c.orgNumber
            ? {
                key: "components.search.subtitles.orgNumber",
                params: { number: c.orgNumber },
              }
            : null,
          c.city ? { text: c.city } : null,
          c.phone ? { text: c.phone } : null,
          c.email ? { text: c.email } : null,
        ),
        href: `/kunder/${c.id}`,
        score,
      })),
    },
    {
      kind: "workOrder",
      label: "Oppdrag",
      labelKey: "components.search.groups.workOrder",
      icon: "📂",
      total: totals.workOrder.total,
      capped: totals.workOrder.capped,
      items: rankedWorkOrders.map(({ item: wo, score }) => ({
        id: wo.id,
        title: wo.orderNumber ? `${wo.orderNumber} · ${wo.title}` : wo.title,
        // Utdatert reservefelt for eldre konsumenter (bl.a. eksisterende
        // tester). UI-en bruker subtitleParts og oversetter ved visning.
        subtitle: joinInfo([
          wo.orderNumber,
          wo.customer?.name,
          wo.status,
          formatDate(wo.scheduledFor),
          wo.tags.length > 0
            ? `🏷️ ${wo.tags.map((tag) => tag.name).join(", ")}`
            : null,
        ]),
        subtitleParts: subtitleParts(
          wo.orderNumber
            ? {
                key: "components.search.subtitles.workOrderNumber",
                params: { number: wo.orderNumber },
              }
            : null,
          wo.customer?.name
            ? { text: wo.customer.name }
            : { key: "components.search.subtitles.noCustomer" },
          statusPart(wo.status),
          wo.scheduledFor ? { text: formatDate(wo.scheduledFor) } : null,
          wo.tags.length > 0
            ? {
                key: "components.search.subtitles.tags",
                params: { tags: wo.tags.map((tag) => tag.name).join(", ") },
              }
            : null,
        ),
        href: `/oppdrag/${wo.id}`,
        score,
      })),
    },
    {
      kind: "tag",
      label: "Tagger",
      labelKey: "components.search.groups.tag",
      icon: "🏷️",
      total: totals.tag.total,
      capped: totals.tag.capped,
      items: rankedTags.map(({ item: tag, score }) => ({
        id: tag.id,
        title: tag.name,
        subtitleKey: "components.search.subtitles.tagHint",
        href: `/oppdrag?tag=${encodeURIComponent(tag.name)}`,
        score,
      })),
    },
    {
      kind: "unit",
      label: "Enheter",
      labelKey: "components.search.groups.unit",
      icon: "🔧",
      total: totals.unit.total,
      capped: totals.unit.capped,
      items: rankedUnits.map(({ item: p, score }) => ({
        id: p.id,
        title: p.model,
        subtitleParts: subtitleParts(
          p.customer?.name ? { text: p.customer.name } : null,
          p.serialNumber
            ? {
                key: "components.search.subtitles.serialNumber",
                params: { number: p.serialNumber },
              }
            : null,
          p.location ? { text: p.location } : null,
        ),
        href: `/kunder/${p.customerId}?tab=enheter`,
        score,
      })),
    },
    {
      kind: "contact",
      label: "Kontaktpersoner",
      labelKey: "components.search.groups.contact",
      icon: "👤",
      total: totals.contact.total,
      capped: totals.contact.capped,
      items: rankedContacts.map(({ item: c, score }) => ({
        id: c.id,
        title: c.name,
        subtitleParts: subtitleParts(
          c.customer?.name ? { text: c.customer.name } : null,
          c.role ? { text: c.role } : null,
          c.phone ? { text: c.phone } : null,
          c.email ? { text: c.email } : null,
        ),
        href: `/kunder/${c.customerId}?tab=kontakter`,
        score,
      })),
    },
    {
      kind: "report",
      label: "Rapporter",
      labelKey: "components.search.groups.report",
      icon: "📋",
      total: totals.report.total,
      capped: totals.report.capped,
      items: rankedReports.map(({ item: r, score }) => {
        const reportHit = reportHits.find((hit) => hit.id === r.id);
        const snippet = snippetText(reportHit?.snippet);
        // Når oppdraget bare har én rapport, er den kombinerte PDF-en og
        // enkeltrapporten samme dokument. Da beholder vi den korte URL-en.
        const singleReport = r.workOrder.reports.length === 1;
        const reportHref = singleReport
          ? `/rapporter/${r.workOrderId}`
          : `/rapporter/${r.workOrderId}?rapport=${encodeURIComponent(r.id)}`;
        const directHref = singleReport
          ? `/api/rapporter/${r.workOrderId}/pdf`
          : `/api/rapporter/${r.workOrderId}/pdf?rapport=${encodeURIComponent(r.id)}`;
        return {
          id: r.id,
          title: joinInfo([
            r.reportNumber ? `#${r.reportNumber}` : null,
            r.name ?? r.templateTitle ?? r.template?.title,
            r.workOrder.title,
          ]),
          subtitleParts: subtitleParts(
            r.workOrder.customer?.name
              ? { text: r.workOrder.customer.name }
              : null,
            snippet
              ? { text: snippet.slice(0, 100) }
              : r.comments
                ? { text: markdownToPlainText(r.comments).slice(0, 80) }
                : null,
            r.hmsType
              ? {
                  key: "components.search.subtitles.reportHms",
                  params: { type: r.hmsType },
                }
              : null,
            { text: formatDate(r.completedAt) },
          ),
          href: withReturnTo(reportHref, returnTo),
          directHref,
          directLabelKey: "components.search.openPdf",
          score,
        };
      }),
    },
    {
      kind: "comment",
      label: "Kommentarer",
      labelKey: "components.search.groups.comment",
      icon: "💬",
      total: totals.comment.total,
      capped: totals.comment.capped,
      items: rankedComments.map(({ item: c, score }) => {
        const href = c.workOrderId
          ? `/oppdrag/${c.workOrderId}`
          : c.customerId
            ? `/kunder/${c.customerId}?tab=aktivitet`
            : c.contact
              ? `/kunder/${c.contact.customerId}?tab=kontakter`
              : "/";
        const text = markdownToPlainText(c.content);
        return {
          id: c.id,
          title: text.length > 90 ? `${text.slice(0, 90)}…` : text,
          subtitleParts: subtitleParts(
            c.workOrder?.title ?? c.customer?.name ?? c.contact?.name
              ? {
                  text:
                    c.workOrder?.title ??
                    c.customer?.name ??
                    c.contact?.name,
                }
              : null,
            c.authorName ? { text: c.authorName } : null,
            { text: formatDate(c.createdAt) },
          ),
          href,
          score,
        };
      }),
    },
    {
      kind: "user",
      label: "Brukere",
      labelKey: "components.search.groups.user",
      icon: "👥",
      total: totals.user.total,
      capped: totals.user.capped,
      items: rankedUsers.map(({ item: u, score }) => ({
        id: u.id,
        title: u.name || u.email || u.id,
        subtitleParts: subtitleParts(
          u.roleDefinition?.label
            ? { text: u.roleDefinition.label }
            : ROLE_KEY[u.role]
              ? { key: ROLE_KEY[u.role] }
              : { text: u.role },
          u.email ? { text: u.email } : null,
        ),
        href: u.customerId
          ? `/kunder/${u.customerId}?tab=kontakter`
          : "/innstillinger?tab=ansatte",
        score,
      })),
    },
    {
      kind: "template",
      label: "Sjekklister",
      labelKey: "components.search.groups.template",
      icon: "🧾",
      total: totals.template.total,
      capped: totals.template.capped,
      items: rankedTemplates.map(({ item: t, score }) => ({
        id: t.id,
        title: t.title,
        subtitleParts: subtitleParts(
          { key: "components.search.subtitles.templateKind" },
          t.reportName
            ? {
                key: "components.search.subtitles.templateReportName",
                params: { name: t.reportName },
              }
            : null,
          t.hmsType
            ? {
                key: "components.search.subtitles.reportHms",
                params: { type: t.hmsType },
              }
            : null,
        ),
        href: `/innstillinger/maler/${t.id}`,
        score,
      })),
    },
    {
      kind: "folder",
      label: "Mapper",
      labelKey: "components.search.groups.folder",
      icon: "📁",
      total: totals.folder.total,
      capped: totals.folder.capped,
      items: rankedFolders.map(({ item: f, score }) => ({
        id: f.id,
        title: f.name,
        subtitleKey: "components.search.subtitles.folderHint",
        href: `/dokumenter?folder=${f.id}`,
        score,
      })),
    },
    {
      kind: "document",
      label: "Dokumenter",
      labelKey: "components.search.groups.document",
      icon: "📚",
      total: totals.document.total,
      capped: totals.document.capped,
      items: rankedDocuments.map(({ item: d, score }) => {
        const hit = documentById.get(d.id);
        // Bare filer i opplastingsmappen kan åpnes direkte. Dokumenttreffet
        // skal ellers gå til dokumentbiblioteket, ikke til råfilen.
        const directHref = d.filePath.startsWith("/uploads/")
          ? d.filePath
          : undefined;
        const documentSnippet =
          d.description?.slice(0, 60) ??
          snippetText(hit?.snippet)?.slice(0, 80);
        return {
          id: d.id,
          title: d.title,
          subtitleParts: subtitleParts(
            d.tags.length > 0
              ? {
                  key: "components.search.subtitles.tags",
                  params: { tags: d.tags.map((tag) => tag.name).join(", ") },
                }
              : null,
            documentSnippet ? { text: documentSnippet } : null,
          ),
          href: withReturnTo(
            `/dokumenter?doc=${encodeURIComponent(d.id)}`,
            returnTo,
          ),
          ...(directHref
            ? {
                directHref,
                directLabelKey: "components.search.openFile",
              }
            : {}),
          score,
        };
      }),
    },
  ].filter((group) => group.total > 0 || group.items.length > 0);

  groups.sort((a, b) => {
    const bestA = a.items[0]?.score ?? 0;
    const bestB = b.items[0]?.score ?? 0;
    if (bestB !== bestA) return bestB - bestA;
    return GROUP_ORDER.indexOf(a.kind as (typeof GROUP_ORDER)[number]) -
      GROUP_ORDER.indexOf(b.kind as (typeof GROUP_ORDER)[number]);
  });

  const total = groups.reduce((sum, group) => sum + group.total, 0);
  return {
    query: originalQuery,
    total,
    groups,
    capped: groups.some((group) => group.capped),
    tookMs: Date.now() - started,
  };
}
