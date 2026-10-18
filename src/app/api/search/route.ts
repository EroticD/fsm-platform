import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";

// Hvor mange treff vi viser per kategori i hurtigsøket.
const LIMIT = 5;
const MIN_QUERY_LENGTH = 2;

type SearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

type SearchGroup = {
  kind: string;
  label: string;
  icon: string;
  items: SearchItem[];
};

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

function formatDay(value: Date | null | undefined) {
  return value ? new Date(value).toLocaleDateString("no-NO") : null;
}

/** Slår sammen felter til en lesbar undertekst, og hopper over tomme verdier. */
function joinInfo(parts: (string | null | undefined | false)[]) {
  return parts.filter(Boolean).join(" • ");
}

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!currentUser || currentUser.role === "CUSTOMER") {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ query: q, total: 0, groups: [] });
  }

  const contains = { contains: q, mode: "insensitive" as const };

  const [customers, contacts, units, workOrders, reports, comments, users, templates] =
    await Promise.all([
      // Kunder
      prisma.customer.findMany({
        where: {
          OR: [
            { name: contains },
            { customerNumber: contains },
            { orgNumber: contains },
            { address: contains },
            { postalCode: contains },
            { city: contains },
            { phone: contains },
            { email: contains },
            { notes: contains },
          ],
        },
        orderBy: { name: "asc" },
        take: LIMIT,
      }),
      // Kontaktpersoner
      prisma.contact.findMany({
        where: {
          OR: [{ name: contains }, { email: contains }, { phone: contains }, { role: contains }],
        },
        include: { customer: { select: { name: true } } },
        orderBy: { name: "asc" },
        take: LIMIT,
      }),
      // Enheter / utstyr
      prisma.product.findMany({
        where: {
          OR: [{ model: contains }, { serialNumber: contains }, { location: contains }],
        },
        include: { customer: { select: { id: true, name: true } } },
        orderBy: { model: "asc" },
        take: LIMIT,
      }),
      // Oppdrag
      prisma.workOrder.findMany({
        where: {
          OR: [{ title: contains }, { description: contains }, { creatorName: contains }],
        },
        include: { customer: { select: { name: true } } },
        orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }],
        take: LIMIT,
      }),
      // Rapporter (kommentarfeltet)
      prisma.report.findMany({
        where: { comments: contains },
        include: {
          template: { select: { title: true } },
          workOrder: { select: { id: true, title: true, customer: { select: { name: true } } } },
        },
        orderBy: { completedAt: "desc" },
        take: LIMIT,
      }),
      // Kommentarer (kunde, oppdrag og kontakt)
      prisma.comment.findMany({
        where: { OR: [{ content: contains }, { authorName: contains }] },
        include: {
          workOrder: { select: { id: true, title: true } },
          customer: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true, customerId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      }),
      // Brukere (ansatte og kundeportalbrukere)
      prisma.user.findMany({
        where: { OR: [{ name: contains }, { email: contains }] },
        orderBy: { name: "asc" },
        take: LIMIT,
      }),
      // Sjekklister / maler
      prisma.template.findMany({
        where: { title: contains },
        orderBy: { title: "asc" },
        take: LIMIT,
      }),
    ]);

  const groups: SearchGroup[] = [
    {
      kind: "customer",
      label: "Kunder",
      icon: "🏢",
      items: customers.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: joinInfo([
          c.customerNumber && `#${c.customerNumber}`,
          c.orgNumber && `Org.nr ${c.orgNumber}`,
          c.city,
          c.phone,
          c.email,
        ]),
        href: `/kunder/${c.id}`,
      })),
    },
    {
      kind: "workOrder",
      label: "Oppdrag",
      icon: "📂",
      items: workOrders.map((wo) => ({
        id: wo.id,
        title: wo.title,
        subtitle: joinInfo([
          wo.customer?.name ?? "Uten kunde",
          STATUS_LABELS[wo.status] ?? wo.status,
          formatDay(wo.scheduledFor),
        ]),
        href: `/oppdrag/${wo.id}`,
      })),
    },
    {
      kind: "unit",
      label: "Enheter",
      icon: "🔧",
      items: units.map((p) => ({
        id: p.id,
        title: p.model,
        subtitle: joinInfo([
          p.customer?.name,
          p.serialNumber && `SN ${p.serialNumber}`,
          p.location,
        ]),
        href: `/kunder/${p.customerId}?tab=enheter`,
      })),
    },
    {
      kind: "contact",
      label: "Kontaktpersoner",
      icon: "👤",
      items: contacts.map((c) => ({
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
      items: reports.map((r) => ({
        id: r.id,
        title: `${r.template?.title ?? "Rapport"} – ${r.workOrder.title}`,
        subtitle: joinInfo([
          r.workOrder.customer?.name,
          r.comments ? r.comments.slice(0, 80) : null,
          formatDay(r.completedAt),
        ]),
        href: `/oppdrag/${r.workOrderId}`,
      })),
    },
    {
      kind: "comment",
      label: "Kommentarer",
      icon: "💬",
      items: comments.map((c) => {
        const href = c.workOrderId
          ? `/oppdrag/${c.workOrderId}`
          : c.customerId
            ? `/kunder/${c.customerId}?tab=aktivitet`
            : c.contact
              ? `/kunder/${c.contact.customerId}?tab=kontakter`
              : "/";
        return {
          id: c.id,
          title: c.content.length > 90 ? `${c.content.slice(0, 90)}…` : c.content,
          subtitle: joinInfo([
            c.workOrder?.title ?? c.customer?.name ?? c.contact?.name,
            c.authorName,
            formatDay(c.createdAt),
          ]),
          href,
        };
      }),
    },
    {
      kind: "user",
      label: "Brukere",
      icon: "👥",
      items: users.map((u) => ({
        id: u.id,
        title: u.name || u.email || "Uten navn",
        subtitle: joinInfo([ROLE_LABELS[u.role] ?? u.role, u.email]),
        href: u.customerId
          ? `/kunder/${u.customerId}?tab=portal`
          : "/innstillinger?tab=ansatte",
      })),
    },
    {
      kind: "template",
      label: "Sjekklister",
      icon: "🧾",
      items: templates.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: "Sjekkliste / mal",
        href: `/innstillinger/maler/${t.id}`,
      })),
    },
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return NextResponse.json({ query: q, total, groups });
}
