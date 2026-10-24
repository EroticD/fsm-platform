import prisma from "@/lib/prisma";
import { markdownToPlainText } from "@/lib/markdown";
import { fuzzyScore, normalizeSearchText } from "@/lib/fuzzy";
import { formatDate } from "@/lib/dates";
import { WorkStatus } from "@prisma/client";
import { departmentUsersScope, workOrderScope, type AccessUser } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";
import { reportSearchWhere } from "@/lib/search-filters";
import {
  searchBySubstring,
  searchByName,
  searchDocuments,
  type NameSearchRow,
} from "@/lib/search-sql";

export type SearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type SearchGroup = {
  kind: string;
  label: string;
  icon: string;
  items: SearchItem[];
};

export type SearchResults = {
  query: string;
  total: number;
  groups: SearchGroup[];
};

const LIMIT = 5;
// Hent et begrenset antall kandidater fra databasen og ranger dem deretter
// fuzzy i JS. Databasen bruker indeksene (GIN/trigram), så vi laster aldri
// hele tabeller eller store tekstfelt inn i Node.
const CANDIDATES = 60;

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planlagt",
  IN_PROGRESS: "Påbegynt",
  WAITING: "Venter",
  COMPLETED: "Fullført",
  PENDING: "Venter",
  CANCELLED: "Kansellert",
  OPEN: "Åpen",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  OFFICE: "Kontor",
  TECHNICIAN: "Montør",
  CUSTOMER: "Kundeportal",
};

function joinInfo(parts: (string | null | undefined | false)[]) {
  return parts.filter(Boolean).join(" • ");
}

/** Bygger et OR-filter for en liste med tekstfelter. */
function textOr(fields: string[], q: string) {
  return {
    OR: fields.map((f) => ({ [f]: { contains: q, mode: "insensitive" as const } })),
  };
}

/** Fjerner ts_headline-markeringene (<b> … </b>) før teksten vises som ren tekst. */
function snippetText(snippet: string | null | undefined): string | null {
  if (!snippet) return null;
  return snippet
    .replace(/<\/?b>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

type MergedHits = {
  ids: string[];
  /** Posisjon fra databasen, brukt som tie-breaker etter fuzzy-scoren. */
  rank: Map<string, number>;
};

/** Slår sammen treff fra flere trigram-kolonner og beholder høyeste score. */
function mergeNameHits(...lists: NameSearchRow[][]): MergedHits {
  const best = new Map<string, number>();
  for (const list of lists) {
    for (const hit of list) {
      const score = Number(hit.score) || 0;
      if (score > (best.get(hit.id) ?? -1)) best.set(hit.id, score);
    }
  }

  const sorted = [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATES);

  return {
    ids: sorted.map(([id]) => id),
    rank: new Map(sorted.map(([id], index) => [id, index])),
  };
}

type SearchOptions = {
  /** Brukeren som søker. Styrer avdelingssynlige oppdrag, kommentarer og ansatte. */
  user: AccessUser;
  /** Kontoret kan søke i kansellerte oppdrag; montørene skal ikke se dem. */
  includeCancelled?: boolean;
};

/**
 * Kjernesøkelogikken — brukes av både det globale hurtigsøket (/api/search)
 * og søkeresultatsiden (/sok). Henter først kandidater fra databasen (raskt,
 * via fulltekst- og trigram-indekser), og rangerer dem deretter fuzzy.
 */
export async function performSearch(
  query: string,
  options: SearchOptions
): Promise<SearchResults> {
  const originalQuery = query.trim();
  // All matching skjer på normalisert form. Det gjør «arlig-service» lik
  // «Årlig service» og «2026-1042» lik «NO-2026-1042».
  const q = normalizeSearchText(originalQuery);
  if (q.length < 2) {
    return { query: originalQuery, total: 0, groups: [] };
  }

  const includeCancelled = options.includeCancelled ?? false;
  const user = options.user;

  // Søket skal bare vise kategorier brukeren faktisk har tilgang til.
  // Kunder, enheter, rapporter, dokumenter og maler er felles for alle
  // avdelinger, men fortsatt avhengige av rettighetene.
  const canCustomers = hasPermission(user, "customers.view");
  const canWorkOrders = hasPermission(user, "workorders.view");
  const canEquipment = hasPermission(user, "equipment.view");
  const canReports = hasPermission(user, "reports.view");
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
    return { query: originalQuery, total: 0, groups: [] };
  }

  const contains = { contains: q, mode: "insensitive" as const };
  const noRows = { id: { in: [] } };

  const commentAccess = canWorkOrders || canCustomers
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
          ...(canCustomers ? [{ workOrderId: null }] : []),
        ],
      }
    : noRows;

  // Første runde: indekserte kandidatsøk. Ingen av disse leser store
  // tekstfelt (contentText/pageTexts) eller hele tabeller.
  const [
    customerNameHits,
    customerCityHits,
    productHits,
    workOrderTitleHits,
    workOrderTitleSubstringHits,
    workOrderNumberHits,
    tagHits,
    documentHits,
  ] = await Promise.all([
    canCustomers
      ? searchByName("Customer", "name", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canCustomers
      ? searchByName("Customer", "city", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canEquipment
      ? searchByName("Product", "model", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canWorkOrders
      ? searchByName("WorkOrder", "title", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canWorkOrders
      ? searchBySubstring("WorkOrder", "title", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canWorkOrders
      ? searchBySubstring("WorkOrder", "orderNumber", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canWorkOrders
      ? searchBySubstring("Tag", "name", q, CANDIDATES)
      : Promise.resolve([] as NameSearchRow[]),
    canDocuments
      ? searchDocuments(originalQuery, CANDIDATES)
      : Promise.resolve([]),
  ]);

  const customerHits = mergeNameHits(customerNameHits, customerCityHits);
  const productHitIds = mergeNameHits(productHits);
  const workOrderHitIds = mergeNameHits(
    workOrderTitleHits,
    workOrderTitleSubstringHits,
    workOrderNumberHits,
  );
  const tagHitIds = mergeNameHits(tagHits);

  // Andre runde: hent bare feltene vi trenger for visning og rangering.
  const [customers, contacts, units, workOrders, tags, reports, comments, users, templates, folders] =
    await Promise.all([
      prisma.customer.findMany({
        where: canCustomers ? { id: { in: customerHits.ids }, deletedAt: null } : noRows,
        select: {
          id: true,
          name: true,
          customerNumber: true,
          orgNumber: true,
          city: true,
          phone: true,
          email: true,
        },
        take: CANDIDATES,
      }),
      prisma.contact.findMany({
        where: canCustomers
          ? {
              AND: [
                textOr(["name", "email", "phone", "role"], q),
                { customer: { deletedAt: null } },
              ],
            }
          : noRows,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          customerId: true,
          customer: { select: { name: true } },
        },
        orderBy: { name: "asc" }, take: CANDIDATES,
      }),
      prisma.product.findMany({
        where: canEquipment
          ? {
              id: { in: productHitIds.ids },
              customer: { deletedAt: null },
            }
          : noRows,
        select: {
          id: true,
          model: true,
          serialNumber: true,
          location: true,
          customerId: true,
          customer: { select: { id: true, name: true } },
        },
        take: CANDIDATES,
      }),
      prisma.workOrder.findMany({
        where: canWorkOrders
          ? {
              AND: [
                workOrderScope(user),
                ...(includeCancelled ? [] : [{ status: { not: WorkStatus.CANCELLED } }]),
                {
                  OR: [
                    { id: { in: workOrderHitIds.ids } },
                    ...(tagHitIds.ids.length > 0
                      ? [{ tags: { some: { id: { in: tagHitIds.ids } } } }]
                      : []),
                  ],
                },
              ],
            }
          : noRows,
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
        },
        take: CANDIDATES,
      }),
      prisma.tag.findMany({
        where: canWorkOrders ? { id: { in: tagHitIds.ids } } : noRows,
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
        take: CANDIDATES,
      }),
      prisma.report.findMany({
        // Rapporter deles på tvers av regioner for ansatte med rapporttilgang.
        // Bevisst uten workOrderScope; oppdrag og kommentarer er fortsatt
        // avdelingsbegrenset.
        where: canReports ? reportSearchWhere(q, includeCancelled) : noRows,
        include: { template: { select: { title: true } }, workOrder: { select: { id: true, title: true, customer: { select: { name: true } } } } }, orderBy: { completedAt: "desc" }, take: CANDIDATES,
      }),
      prisma.comment.findMany({
        where: {
          AND: [textOr(["content", "authorName"], q), commentAccess],
        },
        include: { workOrder: { select: { id: true, title: true } }, customer: { select: { id: true, name: true } }, contact: { select: { id: true, name: true, customerId: true } } }, orderBy: { createdAt: "desc" }, take: CANDIDATES,
      }),
      prisma.user.findMany({
        where: canUsers
          ? { AND: [textOr(["name", "email"], q), departmentUsersScope(user)] }
          : noRows,
        include: { roleDefinition: { select: { label: true } } },
        orderBy: { name: "asc" }, take: CANDIDATES,
      }),
      prisma.template.findMany({
        where: canTemplates ? { title: contains } : noRows,
        orderBy: { title: "asc" }, take: CANDIDATES,
      }),
      prisma.documentFolder.findMany({
        where: canDocuments ? { name: contains } : noRows,
        orderBy: { name: "asc" }, take: CANDIDATES,
      }),
    ]);

  /** Fuzzy-rangering av en liten, allerede avgrenset kandidatliste. */
  function rank<T>(items: T[], getFields: (item: T) => (string | null | undefined)[]) {
    return items
      .map((item) => ({ item, score: fuzzyScore(q, ...getFields(item)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT)
      .map((s) => s.item);
  }

  /**
   * Som `rank`, men beholder alle kandidatene databasen fant (trigram/fulltekst
   * kan gi treff som den rent tekstlige fuzzy-scoren ikke fanger, f.eks. bøyning
   * eller skrivefeil). Databasens rekkefølge brukes som tie-breaker.
   */
  function rankIndexed<T>(
    items: T[],
    getId: (item: T) => string,
    getFields: (item: T) => (string | null | undefined)[],
    order?: Map<string, number>,
  ) {
    return items
      .map((item) => ({
        item,
        score: fuzzyScore(q, ...getFields(item)),
        rank: order?.get(getId(item)) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => b.score - a.score || a.rank - b.rank)
      .slice(0, LIMIT)
      .map((s) => s.item);
  }

  const fuzzyCustomers = rankIndexed(
    customers,
    (c) => c.id,
    (c) => [c.name, c.customerNumber, c.orgNumber, c.city, c.phone, c.email],
    customerHits.rank,
  );
  const fuzzyContacts = rank(contacts, (c) => [c.name, c.email, c.phone, c.role, c.customer?.name]);
  const fuzzyUnits = rankIndexed(
    units,
    (p) => p.id,
    (p) => [p.model, p.serialNumber, p.location, p.customer?.name],
    productHitIds.rank,
  );
  const fuzzyWorkOrders = rankIndexed(
    workOrders,
    (wo) => wo.id,
    (wo) => [
      wo.title,
      wo.orderNumber,
      wo.description,
      wo.creatorName,
      wo.customer?.name,
      ...wo.tags.map((tag) => tag.name),
    ],
    workOrderHitIds.rank,
  );
  const fuzzyTags = rankIndexed(
    tags,
    (tag) => tag.id,
    (tag) => [tag.name],
    tagHitIds.rank,
  );
  const fuzzyReports = rank(reports, (r) => [r.template?.title, r.workOrder.title, r.workOrder.customer?.name, r.comments]);
  const fuzzyComments = rank(comments, (c) => [c.content, c.authorName, c.workOrder?.title, c.customer?.name, c.contact?.name]);
  const fuzzyUsers = rank(users, (u) => [u.name, u.email]);
  const fuzzyTemplates = rank(templates, (t) => [t.title]);
  // Fulltekstsøket har allerede rangert dokumentene med ts_rank. fuzzyScore
  // brukes bare til å løfte eksakte treff i tittel/filnavn øverst.
  const fuzzyDocuments = rankIndexed(
    documentHits,
    (d) => d.id,
    (d) => [d.title, d.description, d.fileName, d.snippet],
  );
  const fuzzyFolders = rank(folders, (f) => [f.name]);

  // Tags er bare nødvendig for de få dokumentene som faktisk vises.
  const documentTags = fuzzyDocuments.length > 0
    ? await prisma.document.findMany({
        where: {
          id: { in: fuzzyDocuments.map((d) => d.id) },
          deletedAt: null,
        },
        select: { id: true, tags: { select: { name: true } } },
        take: LIMIT,
      })
    : [];
  const documentTagNames = new Map(
    documentTags.map((d) => [d.id, d.tags.map((t) => t.name).join(", ")]),
  );

  const groups: SearchGroup[] = [
    {
      kind: "customer",
      label: "Kunder",
      icon: "🏢",
      items: fuzzyCustomers.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: joinInfo([c.customerNumber && `#${c.customerNumber}`, c.orgNumber && `Org.nr ${c.orgNumber}`, c.city, c.phone, c.email]),
        href: `/kunder/${c.id}`,
      })),
    },
    {
      kind: "workOrder",
      label: "Oppdrag",
      icon: "📂",
      items: fuzzyWorkOrders.map((wo) => ({
        id: wo.id,
        title: wo.orderNumber ? `${wo.orderNumber} · ${wo.title}` : wo.title,
        subtitle: joinInfo([
          wo.orderNumber ? `Ordrenr. ${wo.orderNumber}` : null,
          wo.customer?.name ?? "Uten kunde",
          STATUS_LABELS[wo.status] ?? wo.status,
          formatDate(wo.scheduledFor),
          wo.tags.length > 0
            ? `🏷️ ${wo.tags.map((tag) => tag.name).join(", ")}`
            : null,
        ]),
        href: `/oppdrag/${wo.id}`,
      })),
    },
    {
      kind: "tag",
      label: "Tagger",
      icon: "🏷️",
      items: fuzzyTags.map((tag) => ({
        id: tag.id,
        title: tag.name,
        subtitle: "Vis oppdrag med denne taggen",
        href: `/oppdrag?tag=${encodeURIComponent(tag.name)}`,
      })),
    },
    {
      kind: "unit",
      label: "Enheter",
      icon: "🔧",
      items: fuzzyUnits.map((p) => ({
        id: p.id,
        title: p.model,
        subtitle: joinInfo([p.customer?.name, p.serialNumber && `SN ${p.serialNumber}`, p.location]),
        href: `/kunder/${p.customerId}?tab=enheter`,
      })),
    },
    {
      kind: "contact",
      label: "Kontaktpersoner",
      icon: "👤",
      items: fuzzyContacts.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: joinInfo([c.customer?.name, c.role, c.phone, c.email]),
        href: `/kunder/${c.customerId}?tab=kontakter`,
      })),
    },
    {
      kind: "report",
      label: "Rapporter",
      icon: "📋",
      items: fuzzyReports.map((r) => ({
        id: r.id,
        title: `${r.template?.title ?? "Rapport"} – ${r.workOrder.title}`,
        subtitle: joinInfo([r.workOrder.customer?.name, r.comments ? markdownToPlainText(r.comments).slice(0, 80) : null, formatDate(r.completedAt)]),
        href: `/rapporter/${r.workOrderId}`,
      })),
    },
    {
      kind: "comment",
      label: "Kommentarer",
      icon: "💬",
      items: fuzzyComments.map((c) => {
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
          subtitle: joinInfo([c.workOrder?.title ?? c.customer?.name ?? c.contact?.name, c.authorName, formatDate(c.createdAt)]),
          href,
        };
      }),
    },
    {
      kind: "user",
      label: "Brukere",
      icon: "👥",
      items: fuzzyUsers.map((u) => ({
        id: u.id,
        title: u.name || u.email || "Uten navn",
        subtitle: joinInfo([
          u.roleDefinition?.label ?? ROLE_LABELS[u.role] ?? u.role,
          u.email,
        ]),
        href: u.customerId ? `/kunder/${u.customerId}?tab=portal` : "/innstillinger?tab=ansatte",
      })),
    },
    {
      kind: "template",
      label: "Sjekklister",
      icon: "🧾",
      items: fuzzyTemplates.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: "Sjekkliste / mal",
        href: `/innstillinger/maler/${t.id}`,
      })),
    },
    {
      kind: "folder",
      label: "Mapper",
      icon: "📁",
      items: fuzzyFolders.map((f) => ({
        id: f.id,
        title: f.name,
        subtitle: "Mappe i dokumentbiblioteket",
        href: `/dokumenter?folder=${f.id}`,
      })),
    },
    {
      kind: "document",
      label: "Dokumenter",
      icon: "📚",
      items: fuzzyDocuments.map((d) => ({
        id: d.id,
        title: d.title,
        subtitle: joinInfo([
          documentTagNames.get(d.id),
          d.description ? d.description.slice(0, 60) : snippetText(d.snippet)?.slice(0, 80),
        ]),
        href: d.filePath,
      })),
    },
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  return { query: originalQuery, total, groups };
}
