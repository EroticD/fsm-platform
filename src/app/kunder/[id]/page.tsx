import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import ContactCard from "@/components/ContactCard";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import CopyButton from "@/components/CopyButton";
import KpiCard from "@/components/KpiCard";
import UnitHistory from "@/components/UnitHistory";
import { buildInviteUrl } from "@/lib/invite";
import { requireOffice } from "@/lib/session";
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

const ACTIVE_STATUSES = ["PLANNED", "IN_PROGRESS", "PENDING", "OPEN", "WAITING"];

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("no-NO") : "Ingen dato";
}

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

// Finner neste kommende, aktive oppdrag (definert utenfor komponenten for å
// holde render ren).
function pickNextOrder<T extends { scheduledFor: Date | null; status: string }>(orders: T[]) {
  const now = Date.now();
  return orders
    .filter(
      (wo) =>
        wo.scheduledFor &&
        new Date(wo.scheduledFor).getTime() >= now &&
        ACTIVE_STATUSES.includes(wo.status)
    )
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime())[0];
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ invite?: string; error?: string; mail?: string; tab?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const resolvedParams = await params;
  const customerId = resolvedParams.id;
  const { invite, error, mail, tab } = await searchParams;

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) redirect("/api/auth/signin");

  // Montører får lese kundekortet – bedriftsinfo, oppdragshistorikk, enheter og
  // kontakter – men ikke kontorets skriveknapper. Handlingene selv er sperret i
  // unit-actions/portal-actions, uavhengig av hva som vises her.
  const office = user.role === "ADMIN" || user.role === "OFFICE";

  // Hent kunden sammen med tilhørende oppdrag (sortert på dato, nyeste først) og kontaktpersoner
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      contacts: true,
      products: {
        orderBy: { model: 'asc' },
        // Servicehistorikk: alle rapporter der enheten har vært kontrollert.
        include: {
          reportUnits: {
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
        },
      },
      workOrder: {
        orderBy: { scheduledFor: 'desc' },
        include: {
          technicians: true,
          reports: true
        }
      }
    }
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
  });

  const inviteUser = invite ? portalUsers.find((u) => u.id === invite) : undefined;
  const inviteUrl =
    inviteUser?.resetToken && inviteUser.resetTokenExpiry && inviteUser.resetTokenExpiry > new Date()
      ? buildInviteUrl(inviteUser.resetToken)
      : null;

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
    { key: "enheter", label: "🔧 Enheter" },
    { key: "kontakter", label: "👤 Kontakter" },
    ...(office ? [{ key: "portal", label: "🔐 Kundeportal" }] : []),
    { key: "aktivitet", label: "📋 Aktivitet" },
  ];
  const currentTab = tabs.some((t) => t.key === tab) ? (tab as string) : "oversikt";

  const totalOrders = customer.workOrder.length;
  const activeOrders = customer.workOrder.filter((wo) => ACTIVE_STATUSES.includes(wo.status)).length;
  const completedOrders = customer.workOrder.filter((wo) => wo.status === "COMPLETED").length;
  const reportCount = customer.workOrder.reduce((sum, wo) => sum + wo.reports.length, 0);
  const nextOrder = pickNextOrder(customer.workOrder);
  const recentOrders = customer.workOrder.slice(0, 3);
  const recentLogs = customerAuditLogs.slice(0, 5);

  // --- SERVER ACTION: LEGG TIL KONTAKTPERSON ---
  async function addContact(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;

    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const role = formData.get("role") as string;

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
    if (!(await requireOffice())) return;

    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const role = formData.get("role") as string;

    if (!id || !name) return;

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
    if (!(await requireOffice())) return;

    const id = formData.get("id") as string;
    if (!id) return;

    try {
      const contactToDelete = await prisma.contact.findUnique({
        where: { id },
      });
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
            {office && (
              <>
                <Link href={`/oppdrag/ny?customerId=${customer.id}`} className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition shadow-sm flex items-center gap-2 whitespace-nowrap">
                  ➕ Nytt oppdrag
                </Link>
                <Link href={`/kunder/${customerId}/rediger`} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-200 transition shadow-sm flex items-center gap-2 whitespace-nowrap">
                  ✏️ Rediger
                </Link>
              </>
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
              <KpiCard icon="🔧" label="Enheter" value={customer.products.length} tone="gray" href="?tab=enheter" />
              <KpiCard icon="👤" label="Kontaktpersoner" value={customer.contacts.length} tone="gray" href="?tab=kontakter" />
              {office && (
                <KpiCard icon="🔐" label="Portalbrukere" value={portalUsers.length} tone="gray" href="?tab=portal" />
              )}
              <KpiCard
                icon="🗓️"
                label="Neste oppdrag"
                value={nextOrder ? formatDate(nextOrder.scheduledFor) : "Ingen"}
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
                  {customer.notes && (
                    <p><strong>Notat:</strong><br /><span className="text-gray-600">{customer.notes}</span></p>
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
                          {formatDate(wo.scheduledFor)}
                          {wo.reports.length > 0 ? ` • 📋 ${wo.reports.length} sjekkliste(r)` : ""}
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
                          {log.userName || "Ukjent"} • {new Date(log.createdAt).toLocaleString("no-NO")}
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
              <Link
                href={`/oppdrag/ny?customerId=${customer.id}`}
                className="bg-blue-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm font-black hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
              >
                ➕ Nytt oppdrag
              </Link>
            </div>

            {customer.workOrder.length === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-200 p-6 rounded-2xl text-center">
                <p className="text-gray-600 font-bold mb-1">Ingen oppdrag registrert på kunden ennå.</p>
                <p className="text-xs text-gray-500">Opprett et oppdrag for å komme i gang med historikken.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {customer.workOrder.map(wo => (
                  <Link
                    key={wo.id}
                    href={`/oppdrag/${wo.id}`}
                    className="block bg-gray-50 hover:bg-blue-50/50 border-2 border-gray-200 hover:border-blue-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div>
                        <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                        <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                          Planlagt: {formatDate(wo.scheduledFor)}
                          {wo.reports.length > 0 ? ` • 📋 ${wo.reports.length} sjekkliste(r) utfylt` : ""}
                        </p>
                      </div>
                      <StatusBadge status={wo.status} />
                    </div>

                    {wo.description && (
                      <p className="text-sm text-gray-700 bg-white p-3 rounded-xl border border-gray-200 line-clamp-2 font-medium">
                        {wo.description}
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
          </div>
        )}

        {/* --- FANE: ENHETER --- */}
        {currentTab === "enheter" && (
          <TabPanel
            title="🔧 Utstyr / enheter"
            description="Maskinene og utstyret kunden har. Enhetene kan velges når montøren fyller ut en servicerapport, og rapporten husker hvilke enheter som ble kontrollert."
          >
            {/* Skjema for ny enhet – kun kontor/admin */}
            {office && (
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

            {customer.products.length === 0 ? (
              <p className="text-xs text-gray-500 italic">Ingen registrerte enheter på denne kunden.</p>
            ) : (
              <div className="space-y-2">
                {customer.products.map((unit) => (
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
                            {unit.reportUnits.length === 0 ? (
                              <span className="text-gray-400">🕓 Aldri kontrollert</span>
                            ) : (
                              <span className="text-blue-800 font-bold">
                                🕓 {unit.reportUnits.length}{" "}
                                {unit.reportUnits.length === 1 ? "service" : "servicer"} • siste{" "}
                                {formatDate(lastServiceDate(unit.reportUnits))}
                              </span>
                            )}
                            <span className="ml-2 text-blue-600 font-bold">
                              ▾ Vis historikk og redigering
                            </span>
                          </span>
                        </summary>

                        <div className="mt-3 border-t border-gray-200 pt-3">
                          <p className="text-[11px] font-black text-gray-600 uppercase tracking-wider mb-2">
                            🕓 Servicehistorikk ({unit.reportUnits.length})
                          </p>
                          <UnitHistory entries={unit.reportUnits} />
                        </div>

                        {office && (
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

                      {office && (
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

            {customer.contacts.length === 0 ? (
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
                  />
                ))}
              </div>
            )}
          </TabPanel>
        )}

        {/* --- FANE: KUNDEPORTAL --- */}
        {currentTab === "portal" && (
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

            {customer.contacts.length === 0 ? (
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
            />
          </div>
        )}

      </div>
    </div>
  );
}
