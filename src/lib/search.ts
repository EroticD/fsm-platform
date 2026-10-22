import prisma from "@/lib/prisma";
import { markdownToPlainText } from "@/lib/markdown";
import { fuzzyScore } from "@/lib/fuzzy";
import { formatDate } from "@/lib/dates";
import { WorkStatus } from "@prisma/client";
import { departmentUsersScope, workOrderScope, type AccessUser } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";

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
// Hent et begrenset antall kandidater fra databasen (filteret med «contains»),
// og ranger dem deretter fuzzy i JS. Slik blir søket raskt og likevel fleksibelt.
const CANDIDATES = 60;

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planlagt",
  IN_PROGRESS: "Påbegynt",
  WAITING: "Venter",
  COMPLETED: "Fullført",
  PENDING: "Venter / Planlagt",
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

type SearchOptions = {
  /** Brukeren som søker. Styrer avdelingssynlige oppdrag, kommentarer og ansatte. */
  user: AccessUser;
  /** Kontoret kan søke i kansellerte oppdrag; montørene skal ikke se dem. */
  includeCancelled?: boolean;
};

/**
 * Kjernesøkelogikken — brukes av både det globale hurtigsøket (/api/search)
 * og søkeresultatsiden (/sok). Henter først kandidater fra databasen (raskt),
 * og rangerer dem deretter fuzzy.
 */
export async function performSearch(
  query: string,
  options: SearchOptions
): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 2) {
    return { query: q, total: 0, groups: [] };
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
    return { query: q, total: 0, groups: [] };
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

  const [customers, contacts, units, workOrders, reports, comments, users, templates, documents, folders] =
    await Promise.all([
      prisma.customer.findMany({
        where: canCustomers
          ? textOr(["name", "customerNumber", "orgNumber", "address", "postalCode", "city", "phone", "email", "notes"], q)
          : noRows,
        orderBy: { name: "asc" }, take: CANDIDATES,
      }),
      prisma.contact.findMany({
        where: canCustomers
          ? textOr(["name", "email", "phone", "role"], q)
          : noRows,
        include: { customer: { select: { name: true } } }, orderBy: { name: "asc" }, take: CANDIDATES,
      }),
      prisma.product.findMany({
        where: canEquipment
          ? textOr(["model", "serialNumber", "location"], q)
          : noRows,
        include: { customer: { select: { id: true, name: true } } }, orderBy: { model: "asc" }, take: CANDIDATES,
      }),
      prisma.workOrder.findMany({
        where: canWorkOrders
          ? {
              AND: [
                workOrderScope(user),
                textOr(["title", "description", "creatorName"], q),
                ...(includeCancelled ? [] : [{ status: { not: WorkStatus.CANCELLED } }]),
              ],
            }
          : noRows,
        include: { customer: { select: { name: true } } }, orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }], take: CANDIDATES,
      }),
      prisma.report.findMany({
        where: canReports
          ? {
              comments: contains,
              ...(includeCancelled
                ? {}
                : { workOrder: { status: { not: "CANCELLED" } } }),
            }
          : noRows,
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
      prisma.document.findMany({
        where: canDocuments
          ? { OR: [
              { title: contains }, { description: contains }, { fileName: contains },
              { contentText: contains },
              { tags: { some: { name: contains } } },
            ] }
          : noRows,
        include: { tags: { select: { name: true } } }, orderBy: { title: "asc" }, take: CANDIDATES,
      }),
      prisma.documentFolder.findMany({
        where: canDocuments ? { name: contains } : noRows,
        orderBy: { name: "asc" }, take: CANDIDATES,
      }),
    ]);

  function rank<T>(items: T[], getFields: (item: T) => (string | null | undefined)[]) {
    return items
      .map((item) => ({ item, score: fuzzyScore(q, ...getFields(item)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT)
      .map((s) => s.item);
  }

  const fuzzyCustomers = rank(customers, (c) => [c.name, c.customerNumber, c.orgNumber, c.address, c.postalCode, c.city, c.phone, c.email, c.notes]);
  const fuzzyContacts = rank(contacts, (c) => [c.name, c.email, c.phone, c.role, c.customer?.name]);
  const fuzzyUnits = rank(units, (p) => [p.model, p.serialNumber, p.location, p.customer?.name]);
  const fuzzyWorkOrders = rank(workOrders, (wo) => [wo.title, wo.description, wo.creatorName, wo.customer?.name]);
  const fuzzyReports = rank(reports, (r) => [r.template?.title, r.workOrder.title, r.workOrder.customer?.name, r.comments]);
  const fuzzyComments = rank(comments, (c) => [c.content, c.authorName, c.workOrder?.title, c.customer?.name, c.contact?.name]);
  const fuzzyUsers = rank(users, (u) => [u.name, u.email]);
  const fuzzyTemplates = rank(templates, (t) => [t.title]);
  const fuzzyDocuments = rank(documents, (d) => [d.title, d.description, d.fileName, d.contentText, d.tags.map((t) => t.name).join(" ")]);
  const fuzzyFolders = rank(folders, (f) => [f.name]);

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
        title: wo.title,
        subtitle: joinInfo([wo.customer?.name ?? "Uten kunde", STATUS_LABELS[wo.status] ?? wo.status, formatDate(wo.scheduledFor)]),
        href: `/oppdrag/${wo.id}`,
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
      items: fuzzyDocuments.map((d) => {
        let page: number | null = null;
        if (d.pageTexts) {
          try {
            const pages = JSON.parse(d.pageTexts) as { page: number; text: string }[];
            const lower = q.toLowerCase();
            for (const p of pages) {
              if (p.text.toLowerCase().includes(lower)) {
                page = p.page;
                break;
              }
            }
          } catch {}
        }
        const href = page ? `${d.filePath}#page=${page}` : d.filePath;
        return {
          id: d.id,
          title: d.title,
          subtitle: joinInfo([d.tags.map((t) => t.name).join(", "), d.description ? d.description.slice(0, 60) : null, page ? `Side ${page}` : null]),
          href,
        };
      }),
    },
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  return { query: q, total, groups };
}