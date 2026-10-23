import { redirect } from "next/navigation";
import { WorkStatus, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import ContactCard from "@/components/ContactCard";
import CustomerAttachments from "@/components/CustomerAttachments";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import CopyButton from "@/components/CopyButton";
import KpiCard from "@/components/KpiCard";
import MarkdownView from "@/components/MarkdownView";
import UnitHistory from "@/components/UnitHistory";
import { markdownToPlainText } from "@/lib/markdown";
import {
  firstOccurrenceOnOrAfter,
  formatDate,
  formatDateTime,
  parseDateOnly,
  toDateOnly,
  todayUtc,
} from "@/lib/dates";
import { buildInviteUrl } from "@/lib/invite";
import {
  CONTRACT_INTERVAL_MONTHS,
  contractIntervalLabel,
  isContractInterval,
} from "@/lib/contracts";
import { generateRecurringWorkOrderForContract } from "@/lib/recurring";
import { LIMITS, cleanEmail, cleanPhone, cleanText } from "@/lib/sanitize";
import { getCurrentUser, requireAdmin, requirePermission } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments, getDefaultDepartmentId } from "@/lib/departments";
import { workOrderScope } from "@/lib/access";
import { parsePage } from "@/lib/pagination";
import {
  createPortalUser,
  setPortalUserActive,
  resendPortalInvite,
} from "./portal-actions";
import { createUnit, updateUnit, deleteUnit } from "./unit-actions";

// Hjelpekomponent for status-etikett
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm">✅ Fullført</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">🔄 Påbegynt</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">❌ Kansellert</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">✨ Åpen</span>;
    default: return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">⏳ Planlagt</span>;
  }
}

// Felles fane-innpakning med tittel og beskrivelse.
function TabPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
      <div>
        <h2 className="font-black text-gray-900 border-b pb-2 text-base">{title}</h2>
        {description ? <p className="text-xs text-gray-500 mt-2">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

const ACTIVE_STATUSES: WorkStatus[] = [
  WorkStatus.PLANNED,
  WorkStatus.IN_PROGRESS,
  WorkStatus.PENDING,
  WorkStatus.OPEN,
  WorkStatus.WAITING,
];

/** Kundekortet viser 25 oppdrag om gangen, ikke hele historikken. */
const ORDER_PAGE_SIZE = 25;

/** Datoen for den nyeste servicen på en enhet (eller null hvis den aldri er kontrollert). */
function lastServiceDate(
  entries: {
    report: { createdAt: Date | null; workOrder: { scheduledFor: Date | null } };
  }[],
) {
  const times = entries
    .map((entry) => entry.report.workOrder.scheduledFor ?? entry.report.createdAt)
    .filter((value): value is Date => Boolean(value))
    .map((value) => new Date(value).getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    invite?: string;
    inviteToken?: string;
    error?: string;
    mail?: string;
    tab?: string;
    side?: string;
  }>;
}) {
  const resolvedParams = await params;
  const customerId = resolvedParams.id;
  const { invite, inviteToken, error, mail, tab, side } = await searchParams;
  const orderPage = parsePage(side);

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  // Kunder, kontakter, enheter, avtaler, dokumenter og rapporter er felles for
  // alle avdelinger. Oppdragene på kundekortet er derimot avdelingssperret.
  const canManageCustomers = hasPermission(user, "customers.manage");
  const canManageEquipment = hasPermission(user, "equipment.manage");
  const canCreateWorkOrders = hasPermission(user, "workorders.create");
  const isAdmin = user.role === "ADMIN";
  const office = canManageCustomers;
  const canSeeCancelled = user.role !== "TECHNICIAN";
  const ownDepartmentId = user.departmentId;

  // Grunndata for kunden. Oppdrag, enheter og servicehistorikk hentes separat
  // og med et fast tak, slik at kundekortet ikke laster hele historikken.
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      department: true,
      responsibleTechnician: true,
      contacts: { orderBy: { name: "asc" }, take: 100 },
      contracts: {
        orderBy: { startDate: "desc" },
        take: 50,
        include: {
          department: true,
          template: true,
          workOrders: {
            where: workOrderScope(user),
            orderBy: { scheduledFor: "desc" },
            take: 1,
            select: { id: true, title: true, scheduledFor: true, status: true },
          },
        },
      },
      attachments: { orderBy: { createdAt: "desc" }, take: 100 },
      _count: {
        select: {
          contacts: true,
          contracts: true,
          products: true,
          attachments: true,
        },
      },
    },
  });

  const customerAuditLogs = await prisma.auditLog.findMany({
    where: {
      entityType: "Customer",
      entityId: customerId,
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  const customerComments = await prisma.comment.findMany({
    where: {
      customerId: customerId,
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  if (!customer) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Kunden finnes ikke</h1>
        <Link href="/kunder" className="text-blue-600 font-bold hover:underline">Gå tilbake til kundearkivet</Link>
      </div>
    );
  }

  // --- KUNDEPORTALBRUKERE ---
  const portalUsers = await prisma.user.findMany({
    where: { customerId, role: "CUSTOMER" },
    orderBy: { name: "asc" },
    include: { contact: true },
    take: 100,
  });

  const templates = office
    ? await prisma.template.findMany({ orderBy: { title: "asc" } })
    : [];
  const departments = isAdmin ? await getActiveDepartments() : [];
  const defaultDepartmentId = office ? await getDefaultDepartmentId() : null;

  // Nøkkelen lagres som hash, så den rå invitasjonslenken kommer i redirecten.
  const inviteUser = invite ? portalUsers.find((u) => u.id === invite) : undefined;
  const inviteUrl = inviteToken ? buildInviteUrl(inviteToken) : null;

  const portalError =
    error === "mangler_felt"
      ? "Fyll ut navn, e-post og velg en kontaktperson."
      : error === "ugyldig_kontakt"
        ? "Kontaktpersonen tilhører ikke denne kunden."
        : error === "epost_finnes"
          ? "Det finnes allerede en bruker med denne e-postadressen."
          : null;

  // --- OVERSIKTSTALL ---
  const tabs = [
    { key: "oversikt", label: "📊 Oversikt" },
    { key: "oppdrag", label: "📂 Oppdrag" },
    { key: "avtaler", label: "📄 Serviceavtaler" },
    { key: "vedlegg", label: "📎 Vedlegg" },
    { key: "enheter", label: "🔧 Enheter" },
    { key: "kontakter", label: "👤 Kontakter" },
    ...(office ? [{ key: "portal", label: "🔐 Kundeportal" }] : []),
    { key: "aktivitet", label: "📋 Aktivitet" },
  ];
  const currentTab = tabs.some((t) => t.key === tab) ? (tab as string) : "oversikt";

  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  // Kontoret ser dem fortsatt i kundekortet.
  const statusFilter: Prisma.WorkOrderWhereInput[] = canSeeCancelled
    ? []
    : [{ status: { not: "CANCELLED" } }];
  const orderWhere: Prisma.WorkOrderWhereInput = {
    customerId,
    AND: [workOrderScope(user), ...statusFilter],
  };

  // Enhetsfanen lastes først når den åpnes. Servicehistorikken per enhet er
  // begrenset til de 25 nyeste kontrollene; totalen kommer fra _count.
  const products =
    currentTab === "enheter"
      ? await prisma.product.findMany({
          where: { customerId },
          orderBy: { model: "asc" },
          take: 100,
          include: {
            reportUnits: {
              orderBy: { createdAt: "desc" },
              take: 25,
              include: {
                report: {
                  select: {
                    id: true,
                    createdAt: true,
                    workOrderId: true,
                    template: { select: { title: true, fieldsJson: true } },
                    workOrder: { select: { id: true, title: true, scheduledFor: true } },
                  },
                },
              },
            },
            _count: { select: { reportUnits: true } },
          },
        })
      : [];

  const loadOrders = currentTab === "oppdrag" || currentTab === "oversikt";

  const [
    totalOrders,
    activeOrders,
    completedOrders,
    reportCount,
    nextOrder,
    orderRows,
  ] = await Promise.all([
    prisma.workOrder.count({ where: orderWhere }),
    prisma.workOrder.count({
      where: { AND: [orderWhere, { status: { in: ACTIVE_STATUSES } }] },
    }),
    prisma.workOrder.count({
      where: { AND: [orderWhere, { status: "COMPLETED" }] },
    }),
    prisma.report.count({ where: { workOrder: orderWhere } }),
    prisma.workOrder.findFirst({
      where: {
        AND: [
          orderWhere,
          { status: { in: ACTIVE_STATUSES } },
          { scheduledFor: { gte: new Date() } },
        ],
      },
      orderBy: { scheduledFor: "asc" },
      select: { id: true, title: true, scheduledFor: true, status: true },
    }),
    loadOrders
      ? prisma.workOrder.findMany({
          where: orderWhere,
          orderBy: { scheduledFor: "desc" },
          take: currentTab === "oppdrag" ? ORDER_PAGE_SIZE : 3,
          skip: currentTab === "oppdrag" ? (orderPage - 1) * ORDER_PAGE_SIZE : 0,
          select: {
            id: true,
            title: true,
            status: true,
            scheduledFor: true,
            description: true,
            technicians: { select: { name: true }, take: 10 },
            _count: { select: { reports: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const visibleWorkOrders = orderRows;
  const orderTotalPages = Math.max(1, Math.ceil(totalOrders / ORDER_PAGE_SIZE));
  const recentOrders = currentTab === "oppdrag" ? [] : visibleWorkOrders.slice(0, 3);
  const recentLogs = customerAuditLogs.slice(0, 5);

  // --- SERVER ACTION: LEGG TIL KONTAKTPERSON ---
  async function addContact(formData: FormData) {
    "use server";
    if (!(await requirePermission("customers.manage"))) return;

    const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
    const email = cleanEmail(formData.get("email"));
    const phone = cleanPhone(formData.get("phone"));
    const role = cleanText(formData.get("role"), { maxLength: LIMITS.short });

    if (!name) return;

    try {
      await prisma.contact.create({
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: role || null,
          customerId,
        },
      });
      await prisma.auditLog.create({
        data: {
          entityType: "Contact",
          entityId: customerId,
          action: `La til kontaktperson: ${name}`,
          userName: user?.name || "Ukjent"
        }
      });
      revalidatePath(`/kunder/${customerId}`);
    } catch (error) {
      console.error("Feil ved opprettelse av kontaktperson:", error);
    }
  }

  // --- SERVER ACTION: OPPRETT KONTAKTPERSON ---
  async function updateContact(formData: FormData) {
    "use server";
    if (!(await requirePermission("customers.manage"))) return;

    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
    const email = cleanEmail(formData.get("email"));
    const phone = cleanPhone(formData.get("phone"));
    const role = cleanText(formData.get("role"), { maxLength: LIMITS.short });

    if (!id || !name) return;

    const existing = await prisma.contact.findFirst({
      where: { id, customerId },
      select: { id: true },
    });
    if (!existing) return;

    try {
      await prisma.contact.update({
        where: { id },
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: role || null,
        },
      });
      await prisma.auditLog.create({
        data: {
          entityType: "Contact",
          entityId: id,
          action: `Endret kontaktperson: ${name}`,
          userName: user?.name || "Ukjent"
        }
      });
      revalidatePath(`/kunder/${customerId}`);
    } catch (error) {
      console.error("Feil ved oppdatering av kontaktperson:", error);
    }
  }

  // --- SERVER ACTION: SLETT KONTAKTPERSON ---
  async function deleteContact(formData: FormData) {
    "use server";
    if (!(await requireAdmin())) return;

    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    if (!id) return;

    try {
      const contactToDelete = await prisma.contact.findFirst({
        where: { id, customerId },
      });
      if (!contactToDelete) return;
      await prisma.contact.delete({
        where: { id },
      });
      await prisma.auditLog.create({
        data: {
          entityType: "Contact",
          entityId: id,
          action: `Slettet kontaktperson: ${contactToDelete?.name || "Ukjent"}`,
          userName: user?.name || "Ukjent"
        }
      });
      revalidatePath(`/kunder/${customerId}`);
    } catch (error) {
      console.error("Feil ved sletting av kontaktperson:", error);
    }
  }

  // --- SERVER ACTIONS: SERVICEAVTALER ---
  async function createContract(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor || !hasPermission(actor, "customers.manage")) return;

    // Administrator kan velge avdeling. Andre oppretter avtaler i egen avdeling.
    let departmentId: string | null = null;
    if (actor.role === "ADMIN") {
      const requested = cleanText(formData.get("departmentId"), { maxLength: LIMITS.line });
      if (requested) {
        const department = await prisma.department.findFirst({
          where: { id: requested, isActive: true },
          select: { id: true },
        });
        departmentId = department?.id ?? null;
      }
      departmentId = departmentId ?? (await getDefaultDepartmentId());
    } else {
      departmentId = actor.departmentId;
    }
    if (!departmentId) return;

    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    const startDate = parseDateOnly(
      cleanText(formData.get("startDate"), { maxLength: LIMITS.line }),
    );
    const intervalMonths = Number(
      cleanText(formData.get("intervalMonths"), { maxLength: LIMITS.short }),
    );
    const contactId = cleanText(formData.get("contactId"), {
      maxLength: LIMITS.line,
    });
    const templateId = cleanText(formData.get("templateId"), {
      maxLength: LIMITS.line,
    });

    if (!title || !startDate || !isContractInterval(intervalMonths)) return;

    const customerExists = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customerExists) return;

    // Kontaktpersonen og malen må faktisk finnes og høre til denne kunden.
    let validContactId: string | null = null;
    if (contactId) {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (contact?.customerId === customerId) validContactId = contactId;
    }

    let validTemplateId: string | null = null;
    if (templateId) {
      const template = await prisma.template.findUnique({
        where: { id: templateId },
        select: { id: true },
      });
      if (template) validTemplateId = templateId;
    }

    const nextServiceDate = firstOccurrenceOnOrAfter(
      startDate,
      intervalMonths,
      todayUtc(),
    );

    const contract = await prisma.contract.create({
      data: {
        title,
        startDate,
        intervalMonths,
        nextServiceDate,
        isActive: true,
        customerId,
        departmentId,
        contactId: validContactId,
        templateId: validTemplateId,
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "Customer",
        entityId: customerId,
        action: `Opprettet serviceavtale: ${title} (${contractIntervalLabel(intervalMonths)})`,
        userName: actor.name || actor.email || "Ukjent",
      },
    });

    // Starter avtalen i dag, skal første oppdrag lages med en gang. Ellers tar
    // bakgrunnsjobben det når neste service forfaller.
    if (nextServiceDate <= new Date()) {
      try {
        await generateRecurringWorkOrderForContract(contract.id);
      } catch (error) {
        console.error("Kunne ikke opprette første serviceavtale-oppdrag:", error);
      }
    }

    revalidatePath(`/kunder/${customerId}`);
    revalidatePath("/kalender");
    revalidatePath("/oppdrag");
    revalidatePath("/mine-oppdrag");
    revalidatePath("/");
  }

  async function toggleContract(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor || !hasPermission(actor, "customers.manage")) return;

    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    const active = formData.get("active") === "true";
    if (!id) return;

    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { id: true, customerId: true, departmentId: true, title: true },
    });
    if (!contract || contract.customerId !== customerId) return;
    if (actor.role !== "ADMIN" && contract.departmentId !== actor.departmentId) return;

    await prisma.contract.update({
      where: { id },
      data: { isActive: active },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "Customer",
        entityId: customerId,
        action: `${active ? "Aktiverte" : "Pauset"} serviceavtale: ${contract.title}`,
        userName: actor.name || actor.email || "Ukjent",
      },
    });

    // Ved gjenaktivering kan neste service allerede ha forfalt. Da lages det
    // nyeste forfalte oppdraget med en gang i stedet for å vente på jobben.
    if (active) {
      try {
        await generateRecurringWorkOrderForContract(id);
      } catch (error) {
        console.error("Kunne ikke gjenoppta serviceavtale:", error);
      }
    }

    revalidatePath(`/kunder/${customerId}`);
    revalidatePath("/kalender");
    revalidatePath("/oppdrag");
    revalidatePath("/mine-oppdrag");
    revalidatePath("/");
  }

  async function deleteContract(formData: FormData) {
    "use server";
    // Sletting er alltid forbeholdt administrator.
    if (!(await requireAdmin())) return;
    const actor = await getCurrentUser();
    if (!actor) return;

    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    if (!id) return;

    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { id: true, customerId: true, title: true },
    });
    if (!contract || contract.customerId !== customerId) return;

    await prisma.contract.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        entityType: "Customer",
        entityId: customerId,
        action: `Slettet serviceavtale: ${contract.title}`,
        userName: actor.name || actor.email || "Ukjent",
      },
    });

    revalidatePath(`/kunder/${customerId}`);
    revalidatePath("/kalender");
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-black text-gray-900">{customer.name}</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              Kundenummer: {customer.customerNumber || "–"}
              {customer.orgNumber ? ` • Org.nr: ${customer.orgNumber}` : ""}
            </p>
          </div>
          <div className="flex gap-2 sm:gap-3">
            {canCreateWorkOrders && (
              <Link href={`/oppdrag/ny?customerId=${customer.id}`} className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition shadow-sm flex items-center gap-2 whitespace-nowrap">
                ➕ Nytt oppdrag
              </Link>
            )}
            {office && (
              <Link href={`/kunder/${customerId}/rediger`} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-200 transition shadow-sm flex items-center gap-2 whitespace-nowrap">
                ✏️ Rediger
              </Link>
            )}
            <Link href="/kunder" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
              &larr; Kunder
            </Link>
          </div>
        </div>

        {/* FANER (TABS) */}
        <nav className="flex gap-1 bg-white border-2 border-gray-200 rounded-2xl p-1 shadow-sm overflow-x-auto">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`?tab=${t.key}`}
              scroll={false}
              className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition ${
                currentTab === t.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {/* --- FANE: OVERSIKT --- */}
        {currentTab === "oversikt" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard icon="📂" label="Oppdrag totalt" value={totalOrders} tone="gray" href="?tab=oppdrag" />
              <KpiCard icon="🔄" label="Aktive oppdrag" value={activeOrders} tone="blue" href="?tab=oppdrag" />
              <KpiCard icon="✅" label="Fullførte" value={completedOrders} tone="green" href="?tab=oppdrag" />
              <KpiCard icon="📋" label="Utfylte sjekklister" value={reportCount} tone="amber" href="?tab=oppdrag" />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard icon="🔧" label="Enheter" value={customer._count.products} tone="gray" href="?tab=enheter" />
              <KpiCard icon="👤" label="Kontaktpersoner" value={customer._count.contacts} tone="gray" href="?tab=kontakter" />
              <KpiCard icon="📄" label="Serviceavtaler" value={customer._count.contracts} tone="blue" href="?tab=avtaler" />
              <KpiCard icon="📎" label="Vedlegg" value={customer._count.attachments} tone="gray" href="?tab=vedlegg" />
              {office && (
                <KpiCard icon="🔐" label="Portalbrukere" value={portalUsers.length} tone="gray" href="?tab=portal" />
              )}
              <KpiCard
                icon="🗓️"
                label="Neste oppdrag"
                value={nextOrder ? formatDate(nextOrder.scheduledFor, "Ingen dato") : "Ingen"}
                sub={nextOrder?.title}
                tone="blue"
                href="?tab=oppdrag"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Bedriftsinformasjon */}
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4 lg:col-span-1">
                <div className="flex items-center justify-between border-b pb-2">
                  <h2 className="font-black text-gray-900 text-base">🏢 Bedriftsinformasjon</h2>
                  {office && (
                    <Link href={`/kunder/${customerId}/rediger`} className="text-[11px] font-bold text-blue-600 hover:underline">
                      Endre
                    </Link>
                  )}
                </div>
                <div className="text-sm space-y-3 text-gray-800">
                  <p><strong>Adresse:</strong><br />
                    <GoogleMapsLink
                      address={customer.address}
                      postalCode={customer.postalCode}
                      city={customer.city}
                      label={customer.address || "Ikke oppgitt"}
                    />
                    <br />
                    {customer.postalCode || ""} {customer.city || ""}
                  </p>
                  <p><strong>Telefon:</strong><br />{customer.phone ? <a href={`tel:${customer.phone}`} className="text-blue-600 font-bold hover:underline">{customer.phone}</a> : "Ikke oppgitt"}</p>
                  <p><strong>E-post:</strong><br />{customer.email ? <a href={`mailto:${customer.email}`} className="text-blue-600 font-bold hover:underline">{customer.email}</a> : "Ikke oppgitt"}</p>
                  <p><strong>Avdeling:</strong><br />{customer.department?.name || "Ikke tilknyttet"}</p>
                  <p><strong>Ansvarlig montør:</strong><br />{customer.responsibleTechnician?.name || "Ikke satt"}</p>
                  {customer.notes && (
                    <div>
                      <strong>Notat:</strong>
                      <div className="text-gray-600 mt-0.5">
                        <MarkdownView value={customer.notes} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Siste oppdrag */}
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3 lg:col-span-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h2 className="font-black text-gray-900 text-base">📂 Siste oppdrag</h2>
                  <Link href="?tab=oppdrag" className="text-[11px] font-bold text-blue-600 hover:underline">
                    Se alle ({totalOrders})
                  </Link>
                </div>

                {recentOrders.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">Ingen oppdrag registrert ennå.</p>
                ) : (
                  <div className="space-y-2">
                    {recentOrders.map((wo) => (
                      <Link
                        key={wo.id}
                        href={`/oppdrag/${wo.id}`}
                        className="block bg-gray-50 hover:bg-blue-50/60 border border-gray-200 hover:border-blue-300 p-3 rounded-xl transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-gray-900 text-sm truncate">{wo.title}</span>
                          <StatusBadge status={wo.status} />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {formatDate(wo.scheduledFor, "Ingen dato")}
                          {wo._count.reports > 0 ? ` • 📋 ${wo._count.reports} sjekkliste(r)` : ""}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Siste aktivitet */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <h2 className="font-black text-gray-900 text-base">📋 Siste aktivitet</h2>
                <Link href="?tab=aktivitet" className="text-[11px] font-bold text-blue-600 hover:underline">
                  Se all aktivitet
                </Link>
              </div>
              {recentLogs.length === 0 ? (
                <p className="text-xs text-gray-500 italic">Ingen aktivitet registrert.</p>
              ) : (
                <ol className="space-y-2">
                  {recentLogs.map((log) => (
                    <li key={log.id} className="flex items-start gap-3 text-sm">
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-gray-800 font-medium">{log.action}</p>
                        <p className="text-[10px] text-gray-500">
                          {log.userName || "Ukjent"} • {formatDateTime(log.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* --- FANE: OPPDRAG --- */}
        {currentTab === "oppdrag" && (
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <div>
                <h2 className="text-lg font-black text-gray-900">📂 Oppdragshistorikk</h2>
                <p className="text-xs text-gray-500 mt-0.5">Viser alle tidligere og aktive oppdrag for denne kunden.</p>
              </div>
              {canCreateWorkOrders && (
                <Link
                  href={`/oppdrag/ny?customerId=${customer.id}`}
                  className="bg-blue-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm font-black hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                >
                  ➕ Nytt oppdrag
                </Link>
              )}
            </div>

            {totalOrders === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-200 p-6 rounded-2xl text-center">
                <p className="text-gray-600 font-bold mb-1">Ingen oppdrag registrert på kunden ennå.</p>
                <p className="text-xs text-gray-500">Opprett et oppdrag for å komme i gang med historikken.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleWorkOrders.map(wo => (
                  <Link
                    key={wo.id}
                    href={`/oppdrag/${wo.id}`}
                    className="block bg-gray-50 hover:bg-blue-50/50 border-2 border-gray-200 hover:border-blue-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div>
                        <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                        <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                          Planlagt: {formatDate(wo.scheduledFor, "Ingen dato")}
                          {wo._count.reports > 0 ? ` • 📋 ${wo._count.reports} sjekkliste(r) utfylt` : ""}
                        </p>
                      </div>
                      <StatusBadge status={wo.status} />
                    </div>

                    {wo.description && (
                      <p className="text-sm text-gray-700 bg-white p-3 rounded-xl border border-gray-200 line-clamp-2 font-medium">
                        {markdownToPlainText(wo.description)}
                      </p>
                    )}

                    <div className="mt-2 flex justify-between items-center text-[10px] pt-2 border-t border-gray-200 text-gray-600">
                      <span>
                        <strong>Montør(er):</strong> {wo.technicians.length > 0 ? wo.technicians.map(t => t.name).join(", ") : "Ikke tildelt"}
                      </span>
                      <span className="font-black text-blue-600 hover:underline">
                        Se detaljer &rarr;
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {orderTotalPages > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-gray-100 text-xs font-bold">
                {orderPage > 1 && (
                  <Link
                    href={`?tab=oppdrag&side=${orderPage - 1}`}
                    className="text-blue-600 hover:underline"
                  >
                    &larr; Forrige
                  </Link>
                )}
                <span className="text-gray-500">
                  Viser {(orderPage - 1) * ORDER_PAGE_SIZE + 1}–
                  {Math.min(orderPage * ORDER_PAGE_SIZE, totalOrders)} av {totalOrders}
                </span>
                {orderPage < orderTotalPages && (
                  <Link
                    href={`?tab=oppdrag&side=${orderPage + 1}`}
                    className="text-blue-600 hover:underline"
                  >
                    Neste &rarr;
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* --- FANE: SERVICEAVTALER --- */}
        {currentTab === "avtaler" && (
          <TabPanel
            title="📄 Serviceavtaler"
            description="Gjentagende service med fast intervall. Ved hvert intervall opprettes et nytt oppdrag med kundedata og en ny, tom sjekkliste. Forrige rapport legges ved som PDF."
          >
            {office && (isAdmin || ownDepartmentId) && (
              <form
                action={createContract}
                className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Tittel *
                    </label>
                    <input
                      type="text"
                      name="title"
                      required
                      placeholder="F.eks. Årlig service på portanlegg"
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Avdeling *
                    </label>
                    {isAdmin ? (
                      <select
                        name="departmentId"
                        required
                        defaultValue={defaultDepartmentId ?? ""}
                        className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                      >
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                            {department.isDefault ? " (standard)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="w-full border border-gray-200 bg-white p-2 rounded-xl text-sm text-gray-800 font-bold">
                        {user.department?.name || "Ingen avdeling"}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Startdato *
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      required
                      defaultValue={toDateOnly(new Date())}
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Intervall *
                    </label>
                    <select
                      name="intervalMonths"
                      required
                      defaultValue="12"
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    >
                      {CONTRACT_INTERVAL_MONTHS.map((months) => (
                        <option key={months} value={months}>
                          {contractIntervalLabel(months)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Kontaktperson (valgfritt)
                    </label>
                    <select
                      name="contactId"
                      defaultValue=""
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    >
                      <option value="">Bruk kundens første kontaktperson</option>
                      {customer.contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                          {contact.role ? ` (${contact.role})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Sjekkliste (valgfritt)
                    </label>
                    <select
                      name="templateId"
                      defaultValue=""
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    >
                      <option value="">Ingen sjekkliste</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  Sjekklisten festes til hvert nye oppdrag, men rapporten er alltid
                  ny og tom. Er startdatoen i dag, opprettes første oppdrag med en
                  gang. Er den i fortiden, brukes neste framtidige intervall.
                </p>
                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm"
                >
                  Opprett serviceavtale
                </button>
              </form>
            )}

            {office && !isAdmin && !ownDepartmentId && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 font-bold">
                Du må være knyttet til en avdeling for å opprette serviceavtaler.
              </p>
            )}

            {customer._count.contracts === 0 ? (
              <p className="text-xs text-gray-500 italic">
                Ingen serviceavtaler registrert på denne kunden.
              </p>
            ) : (
              <div className="space-y-3">
                {customer.contracts.map((contract) => {
                  const latestOrder = contract.workOrders[0];
                  return (
                    <div
                      key={contract.id}
                      className="bg-gray-50 rounded-xl border border-gray-200 p-3 sm:p-4 space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div>
                          <p className="font-black text-gray-900 text-sm">
                            {contract.title}
                          </p>
                          <p className="text-[11px] text-gray-600 mt-0.5">
                            Startdato: {formatDate(contract.startDate, "–")} • Intervall:{" "}
                            {contractIntervalLabel(contract.intervalMonths)} • Neste
                            service: {formatDate(contract.nextServiceDate, "–")}
                          </p>
                          <p className="text-[11px] text-gray-600">
                            Sjekkliste:{" "}
                            <span className="font-bold text-blue-800">
                              {contract.template?.title || "Ingen"}
                            </span>
                          </p>
                          <p className="text-[11px] text-gray-600">
                            🏷️ Avdeling:{" "}
                            <span className="font-bold">{contract.department.name}</span>
                          </p>
                        </div>
                        <span
                          className={`self-start text-[10px] font-bold px-2 py-1 rounded-full border uppercase ${
                            contract.isActive
                              ? "bg-green-100 text-green-800 border-green-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }`}
                        >
                          {contract.isActive ? "Aktiv" : "Pauset"}
                        </span>
                      </div>

                      {latestOrder && (
                        <Link
                          href={`/oppdrag/${latestOrder.id}`}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline"
                        >
                          Siste oppdrag: {latestOrder.title} •{" "}
                          {formatDate(latestOrder.scheduledFor, "Ingen dato")} →
                        </Link>
                      )}

                      {office && (isAdmin || contract.departmentId === ownDepartmentId) && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                          <form action={toggleContract}>
                            <input type="hidden" name="id" value={contract.id} />
                            <input
                              type="hidden"
                              name="active"
                              value={contract.isActive ? "false" : "true"}
                            />
                            <button
                              type="submit"
                              className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                                contract.isActive
                                  ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                                  : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                              }`}
                            >
                              {contract.isActive ? "Pause" : "Aktiver"}
                            </button>
                          </form>
                          {isAdmin && (
                            <ConfirmSubmitForm
                              action={deleteContract}
                              confirmMessage={`Slette serviceavtalen «${contract.title}»? Oppdrag som allerede er opprettet blir liggende.`}
                            >
                              <input type="hidden" name="id" value={contract.id} />
                              <button
                                type="submit"
                                className="text-[10px] font-bold px-3 py-1.5 rounded-lg border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition"
                              >
                                Slett
                              </button>
                            </ConfirmSubmitForm>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabPanel>
        )}

        {/* --- FANE: VEDLEGG --- */}
        {currentTab === "vedlegg" && (
          <CustomerAttachments
            customerId={customerId}
            attachments={customer.attachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              dataUrl: attachment.dataUrl,
            }))}
            canUpload={canManageCustomers}
            canDelete={isAdmin}
          />
        )}

        {/* --- FANE: ENHETER --- */}
        {currentTab === "enheter" && (
          <TabPanel
            title="🔧 Utstyr / enheter"
            description="Maskinene og utstyret kunden har. Enhetene kan velges når montøren fyller ut en servicerapport, og rapporten husker hvilke enheter som ble kontrollert."
          >
            {/* Skjema for ny enhet – krever equipment.manage */}
            {canManageEquipment && (
              <form action={createUnit} className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
                <input type="hidden" name="customerId" value={customerId} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Betegnelse *</label>
                    <input type="text" name="model" required placeholder="F.eks. Port Nord" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Serienummer</label>
                    <input type="text" name="serialNumber" placeholder="F.eks. 12-3456" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Plassering</label>
                    <input type="text" name="location" placeholder="F.eks. Bygg A, plan 2" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm whitespace-nowrap">
                  Legg til enhet
                </button>
              </form>
            )}

            {products.length === 0 ? (
              <p className="text-xs text-gray-500 italic">Ingen registrerte enheter på denne kunden.</p>
            ) : (
              <div className="space-y-2">
                {products.map((unit) => (
                  <div key={unit.id} className="bg-gray-50 rounded-xl border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <details className="flex-1 min-w-0">
                        <summary className="cursor-pointer list-none">
                          <span className="font-bold text-gray-900 text-sm">{unit.model}</span>
                          <span className="block text-[11px] text-gray-500 mt-0.5">
                            {unit.serialNumber ? `SN: ${unit.serialNumber}` : "Uten serienummer"}
                            {unit.location ? ` • ${unit.location}` : ""}
                          </span>
                          <span className="block text-[11px] mt-1">
                            {unit._count.reportUnits === 0 ? (
                              <span className="text-gray-400">🕓 Aldri kontrollert</span>
                            ) : (
                              <span className="text-blue-800 font-bold">
                                🕓 {unit._count.reportUnits}{" "}
                                {unit._count.reportUnits === 1 ? "service" : "servicer"} • siste{" "}
                                {formatDate(lastServiceDate(unit.reportUnits), "Ingen dato")}
                              </span>
                            )}
                            <span className="ml-2 text-blue-600 font-bold">
                              ▾ Vis historikk og redigering
                            </span>
                          </span>
                        </summary>

                        <div className="mt-3 border-t border-gray-200 pt-3">
                          <p className="text-[11px] font-black text-gray-600 uppercase tracking-wider mb-2">
                            🕓 Servicehistorikk ({unit._count.reportUnits})
                          </p>
                          {unit._count.reportUnits > unit.reportUnits.length && (
                            <p className="text-[10px] text-gray-500 mb-2">
                              Viser de {unit.reportUnits.length} nyeste av {unit._count.reportUnits} kontroller.
                            </p>
                          )}
                          <UnitHistory entries={unit.reportUnits} />
                        </div>

                        {canManageEquipment && (
                          <details className="mt-3 border-t border-gray-200 pt-3">
                            <summary className="cursor-pointer text-[11px] font-black text-gray-600 uppercase tracking-wider">
                              ✏️ Endre enhet
                            </summary>

                            <form action={updateUnit} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                              <input type="hidden" name="customerId" value={customerId} />
                              <input type="hidden" name="id" value={unit.id} />
                              <div>
                                <label className="block text-[10px] font-bold text-gray-600 mb-1">Betegnelse *</label>
                                <input type="text" name="model" required defaultValue={unit.model} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-gray-600 mb-1">Serienummer</label>
                                <input type="text" name="serialNumber" defaultValue={unit.serialNumber || ""} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-gray-600 mb-1">Plassering</label>
                                <input type="text" name="location" defaultValue={unit.location || ""} className="w-full border border-gray-300 p-2 rounded-lg text-xs text-gray-900 bg-white" />
                              </div>
                              <div className="sm:col-span-3 flex justify-end">
                                <button type="submit" className="bg-gray-900 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-800 transition">
                                  Lagre endringer
                                </button>
                              </div>
                            </form>
                          </details>
                        )}
                      </details>

                      {isAdmin && (
                        <form action={deleteUnit}>
                          <input type="hidden" name="customerId" value={customerId} />
                          <input type="hidden" name="id" value={unit.id} />
                          <button type="submit" title="Slett enhet" className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition">
                            🗑️
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabPanel>
        )}

        {/* --- FANE: KONTAKTER --- */}
        {currentTab === "kontakter" && (
          <TabPanel
            title="👤 Kontaktpersoner"
            description="Personer hos kunden vi forholder oss til. Kundeportalbrukere kobles til en kontaktperson."
          >
            {/* Skjema for ny kontaktperson – kun kontor/admin */}
            {office && (
              <form action={addContact} className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Navn *</label>
                    <input type="text" name="name" required placeholder="F.eks. Kari Nordmann" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Rolle (valgfritt)</label>
                    <input type="text" name="role" placeholder="F.eks. Driftssjef" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">E-post (valgfritt)</label>
                    <input type="email" name="email" placeholder="kari@bedriften.no" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Telefon (valgfritt)</label>
                    <input type="tel" name="phone" placeholder="+47 900 00 000" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm whitespace-nowrap">
                  Legg til kontaktperson
                </button>
              </form>
            )}

            {customer._count.contacts === 0 ? (
              <p className="text-xs text-gray-500 italic">Ingen registrerte kontaktpersoner.</p>
            ) : (
              <div className="space-y-4">
                {customer.contacts.map((c) => (
                  <ContactCard
                    key={c.id}
                    contact={c}
                    customerId={customerId}
                    onUpdate={updateContact}
                    onDelete={deleteContact}
                    readOnly={!office}
                    canDelete={isAdmin}
                  />
                ))}
              </div>
            )}
          </TabPanel>
        )}

        {/* --- FANE: KUNDEPORTAL --- */}
        {currentTab === "portal" && office && (
          <TabPanel
            title="🔐 Kundeportalbrukere"
            description="Brukere som kan logge inn i kundeportalen og se denne kundens data og teknikertilgjengelighet."
          >
            {portalError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-xs font-bold">
                {portalError}
              </div>
            )}

            {inviteUser && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-sm font-bold text-green-900 mb-1">
                  ✅ Invitasjon klar for {inviteUser.name || inviteUser.email}
                </p>
                <p className="text-xs text-green-800 mb-3">
                  {mail === "sent"
                    ? "Invitasjons-e-posten er sendt til brukeren."
                    : "E-posten kunne ikke sendes (sjekk SMTP-innstillingene i .env) – kopier lenken og send den til brukeren manuelt."}
                </p>
                {inviteUrl ? (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                      readOnly
                      value={inviteUrl}
                      className="flex-1 bg-white border border-green-300 rounded-lg px-3 py-2 text-xs text-gray-700 font-mono"
                    />
                    <CopyButton value={inviteUrl} label="Kopier lenke" />
                  </div>
                ) : (
                  <p className="text-xs text-red-700 font-bold">
                    Ingen gyldig lenke. Trykk «Ny lenke» for å lage en ny.
                  </p>
                )}
              </div>
            )}

            {customer._count.contacts === 0 ? (
              <p className="text-xs text-gray-500 italic bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3">
                Legg til en kontaktperson først – kundeportalbrukere må kobles til en kontaktperson.
              </p>
            ) : (
              <form action={createPortalUser} className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
                <input type="hidden" name="customerId" value={customerId} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Navn *</label>
                    <input
                      type="text"
                      name="name"
                      required
                      placeholder="F.eks. Kari Nordmann"
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">E-post *</label>
                    <input
                      type="email"
                      name="email"
                      required
                      placeholder="kari@bedriften.no"
                      className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Kontaktperson *</label>
                  <select
                    name="contactId"
                    required
                    defaultValue=""
                    className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                  >
                    <option value="">-- Velg kontaktperson --</option>
                    {customer.contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.role ? ` (${c.role})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm"
                >
                  Opprett og send invitasjon
                </button>
              </form>
            )}

            {portalUsers.length > 0 && (
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                {portalUsers.map((u) => {
                  const hasPendingInvite =
                    !!u.resetToken && !!u.resetTokenExpiry && u.resetTokenExpiry > new Date();
                  return (
                    <div
                      key={u.id}
                      className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50"
                    >
                      <div>
                        <p className="text-sm font-bold text-gray-900">{u.name || "Uten navn"}</p>
                        <p className="text-xs text-gray-500">
                          {u.email}
                          {u.contact ? ` • ${u.contact.name}` : ""}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              u.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {u.isActive ? "Aktiv" : "Inaktiv"}
                          </span>
                          {!u.password && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-gray-200 text-gray-600">
                              Mangler passord
                            </span>
                          )}
                          {hasPendingInvite && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-800">
                              Invitert
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={resendPortalInvite}>
                          <input type="hidden" name="customerId" value={customerId} />
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition"
                          >
                            🔗 Ny lenke
                          </button>
                        </form>
                        <form action={setPortalUserActive}>
                          <input type="hidden" name="customerId" value={customerId} />
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="active" value={u.isActive ? "false" : "true"} />
                          <button
                            type="submit"
                            className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                              u.isActive
                                ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                                : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                            }`}
                          >
                            {u.isActive ? "Deaktiver" : "Aktiver"}
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabPanel>
        )}

        {/* --- FANE: AKTIVITET --- */}
        {currentTab === "aktivitet" && (
          <div className="space-y-6">
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
              <h2 className="font-black text-gray-900 mb-3 border-b pb-2">📋 Aktivitetslogg</h2>
              <AuditLogTable logs={customerAuditLogs} />
            </div>

            <CommentSection
              entityType="customer"
              entityId={customerId}
              existingComments={customerComments.map(c => ({
                id: c.id,
                content: c.content,
                authorName: c.authorName,
                createdAt: c.createdAt.toISOString(),
              }))}
              currentUserName={user?.name || null}
              canWrite={canManageCustomers}
            />
          </div>
        )}

      </div>
    </div>
  );
}
