import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import MarkdownEditor from "@/components/MarkdownEditor";
import { markdownToPlainText } from "@/lib/markdown";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { formatDate, parseDateOnly, toDateOnly } from "@/lib/dates";
import { contractIntervalLabel } from "@/lib/contracts";
import { getCurrentUser } from "@/lib/session";
import { getDefaultDepartmentId } from "@/lib/departments";
import { staffForDepartment } from "@/lib/access";
import { sendBookingNotification } from "@/lib/email";

// Formaterer en dato til YYYY-MM-DD i lokal tid (for sammenligning av dager)
function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Hjelpekomponent for status-etikett
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm">✅ Fullført</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">🔄 Påbegynt</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">❌ Kansellert</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">✨ Åpen</span>;
    case 'PENDING': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">⏳ Planlagt</span>;
    case 'PLANNED': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">📅 Planlagt</span>;
    case 'WAITING': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold border border-orange-200 shadow-sm">⏸️ Venter</span>;
    default: return <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-bold border border-gray-200 shadow-sm">{status}</span>;
  }
}

export default async function KundeportalPage() {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { 
      customer: { 
        include: { 
          department: true,
          responsibleTechnician: true,
          products: true, 
          contracts: true, 
          workOrder: { 
            orderBy: { scheduledFor: 'desc' },
            include: {
              technicians: true,
              reports: true
            }
          } 
        } 
      } 
    }
  });

  if (!user?.isActive || user.role !== "CUSTOMER" || !user.customer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow border text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Ingen tilgang</h1>
          <p className="text-gray-600">Brukeren din er ikke koblet til en kundekonto.</p>
        </div>
      </div>
    );
  }

  const customer = user.customer;
  const defaultDepartmentId = await getDefaultDepartmentId();

  // Sorter oppdrag i kategorier
  const upcomingWorkOrders = customer.workOrder.filter(wo => 
    wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED'
  );
  const completedWorkOrders = customer.workOrder.filter(wo => 
    wo.status === 'COMPLETED' || wo.status === 'CANCELLED'
  );

  // --- SERVER ACTION: BOOK NYTT OPPDRAG ---
  async function bookWorkOrder(formData: FormData) {
    "use server";

    // Sjekk økten på nytt i handlingen; ikke stol på sidevisningens closure.
    const current = await getCurrentUser();
    if (!current?.isActive || current.role !== "CUSTOMER" || !current.customerId) {
      return;
    }

    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    const description = cleanMarkdown(formData.get("description"));

    if (!title) return;

    // Kundebestillinger havner i standardavdelingen. Finnes ingen aktiv
    // avdeling, kan bestillingen ikke opprettes.
    const departmentId = await getDefaultDepartmentId();
    if (!departmentId) return;

    try {
      const created = await prisma.workOrder.create({
        data: {
          title,
          description: description || "",
          departmentId,
          customerId: current.customerId,
          contactId: current.contactId || undefined,
          creatorName: current.name || "Kunde",
          status: "OPEN",
          technicians: {
            connect: []
          },
        }
      });

      await prisma.auditLog.create({
        data: {
          entityType: "WorkOrder",
          entityId: created.id,
          action: `Kunde booket nytt oppdrag: ${title}`,
          userName: current.name || "Kunde"
        }
      });

      // Varsle kontoret og send bekreftelse til kunden (best-effort – en
      // feilkonfigurert SMTP skal ikke hindre bestillingen).
      try {
        const officeUsers = await prisma.user.findMany({
          where: { isActive: true, role: { in: ["ADMIN", "OFFICE"] } },
          select: { email: true },
        });
        const contact = current.contactId
          ? await prisma.contact.findUnique({
              where: { id: current.contactId },
              select: { email: true },
            })
          : null;
        await sendBookingNotification(
          officeUsers.map((u) => u.email).filter(Boolean) as string[],
          contact?.email || current.email || null,
          {
            title,
            description,
            customerName: customer.name,
            bookedBy: current.name || current.email || "Kunde",
          },
        );
      } catch (emailError) {
        console.error("Kunne ikke sende bestillingsvarsel:", emailError);
      }

      revalidatePath("/kundeportal");
    } catch (error) {
      console.error("Feil ved booking av oppdrag:", error);
    }
  }

  // --- TEKNIKERTILGJENGELIGHET: ledig/opptatt neste 7 dager ---
  // Kundeportalbrukere skal kun se tilgjengelighet, ikke hva andre kunder har bestilt.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Kunden ser bare montører i sin egen avdeling (faller tilbake til
  // standardavdelingen hvis kunden ikke er knyttet til en avdeling).
  const availabilityDepartmentId = customer.departmentId ?? defaultDepartmentId;

  const technicians = await prisma.user.findMany({
    where: { ...staffForDepartment(availabilityDepartmentId), isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  // Hent oppdrag som overlapper de neste 7 dagene. Flerdagersoppdrag
  // (scheduledFor → scheduledTo) blokkerer alle dagene de varer.
  const scheduledWorkOrders = await prisma.workOrder.findMany({
    where: {
      departmentId: availabilityDepartmentId ?? "__ingen_avdeling__",
      status: { notIn: ["CANCELLED"] },
      OR: [
        { scheduledFor: { gte: today, lt: horizon } },
        { scheduledTo: { gte: today, lt: horizon } },
        {
          AND: [
            { scheduledFor: { lt: today } },
            { scheduledTo: { gte: horizon } },
          ],
        },
      ],
    },
    select: {
      scheduledFor: true,
      scheduledTo: true,
      technicians: { select: { id: true } },
    },
  });

  const busyByTechnician = new Map<string, Set<string>>();
  for (const wo of scheduledWorkOrders) {
    if (!wo.scheduledFor) continue;

    // Blokker alle dager oppdraget varer (inklusiv scheduledTo).
    const start = new Date(wo.scheduledFor);
    start.setHours(0, 0, 0, 0);
    const end = wo.scheduledTo ? new Date(wo.scheduledTo) : new Date(start);
    end.setHours(0, 0, 0, 0);

    // Begrens til vinduet vi viser.
    const firstDay = start < today ? new Date(today) : start;
    const lastDay = end > horizon ? new Date(horizon.getTime() - 1) : end;

    for (const tech of wo.technicians) {
      if (!busyByTechnician.has(tech.id)) busyByTechnician.set(tech.id, new Set());
      const set = busyByTechnician.get(tech.id)!;
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        set.add(dateKey(d));
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4" style={{ borderBottomColor: customer.brandColor || "#2563eb" }}>
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Min Bedrift: {customer.name}</h1>
              <p className="text-gray-500">Velkommen til din kundeportal, {user.name}!</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition text-sm whitespace-nowrap">
              &larr; Hjem
            </Link>
            <Link href="/kundeportal" className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-90 transition whitespace-nowrap text-sm">
              Oppdater
            </Link>
          </div>
        </div>

        {/* KONTAKTINFO: avdeling og ansvarlig montør */}
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 mb-6">
          <h2 className="font-bold text-gray-900 mb-4 border-b pb-2">🏢 Din kontakt</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Avdeling / lokasjon */}
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {customer.department ? "Avdeling / lokasjon" : "Firma"}
              </p>
              <p className="text-sm text-gray-900 font-bold">
                {customer.department?.name || customer.name}
              </p>
              {customer.department ? (
                <>
                  {(customer.department.address || customer.department.city) && (
                    <p className="text-sm text-gray-700 mt-1">
                      {customer.department.address || ""}
                      {customer.department.postalCode ? `, ${customer.department.postalCode}` : ""}
                      {customer.department.city ? ` ${customer.department.city}` : ""}
                    </p>
                  )}
                  {customer.department.phone && (
                    <p className="text-sm mt-1">
                      📞 <a href={`tel:${customer.department.phone}`} className="text-blue-600 font-bold hover:underline">{customer.department.phone}</a>
                    </p>
                  )}
                  {customer.department.email && (
                    <p className="text-sm">
                      ✉️ <a href={`mailto:${customer.department.email}`} className="text-blue-600 font-bold hover:underline">{customer.department.email}</a>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-700 mt-1">
                    {customer.address || "Ikke oppgitt"} {customer.postalCode || ""} {customer.city || ""}
                  </p>
                  {customer.phone && (
                    <p className="text-sm mt-1">
                      📞 <a href={`tel:${customer.phone}`} className="text-blue-600 font-bold hover:underline">{customer.phone}</a>
                    </p>
                  )}
                  {customer.email && (
                    <p className="text-sm">
                      ✉️ <a href={`mailto:${customer.email}`} className="text-blue-600 font-bold hover:underline">{customer.email}</a>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Ansvarlig montør */}
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Ansvarlig montør</p>
              {customer.responsibleTechnician ? (
                <>
                  <p className="text-sm text-gray-900 font-bold">{customer.responsibleTechnician.name}</p>
                  {customer.responsibleTechnician.phone && (
                    <p className="text-sm mt-1">
                      📞 <a href={`tel:${customer.responsibleTechnician.phone}`} className="text-blue-600 font-bold hover:underline">{customer.responsibleTechnician.phone}</a>
                    </p>
                  )}
                  {customer.responsibleTechnician.email && (
                    <p className="text-sm">
                      ✉️ <a href={`mailto:${customer.responsibleTechnician.email}`} className="text-blue-600 font-bold hover:underline">{customer.responsibleTechnician.email}</a>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">Ingen ansvarlig montør er satt ennå.</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* VENSTRE: Utstyr & Avtaler */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Registrert utstyr */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
              <h2 className="font-bold text-lg text-gray-900 border-b pb-2">🔧 Vårt utstyr</h2>
              <div className="space-y-3">
                {customer.products.length === 0 ? (
                  <p className="text-gray-500 italic text-sm">Ingen utstyr registrert.</p>
                ) : (
                  customer.products.map(product => (
                    <div key={product.id} className="bg-gray-50 p-3 rounded border flex justify-between items-center">
                      <div>
                        <p className="font-bold text-gray-800 text-sm">{product.model}</p>
                        <p className="text-xs text-gray-500">SN: {product.serialNumber || "–"}</p>
                      </div>
                      <span className="text-[10px] bg-white px-2 py-1 rounded text-gray-600 border">{product.location || "Ukjent bygg"}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Serviceavtaler */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="font-bold text-lg text-gray-900 border-b pb-2">📄 Serviceavtaler</h2>
              <div className="space-y-3">
                {customer.contracts.length === 0 ? (
                  <p className="text-gray-500 italic text-sm">Ingen aktive avtaler.</p>
                ) : (
                  customer.contracts.map(contract => (
                    <div key={contract.id} className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-blue-900 text-sm">{contract.title}</p>
                        {!contract.isActive && (
                          <span className="text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            Pauset
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-blue-700">
                        Startdato: {formatDate(contract.startDate, "–")} • Intervall:{" "}
                        {contractIntervalLabel(contract.intervalMonths)}
                      </p>
                      <p className="text-[10px] text-blue-700">
                        Neste service: {formatDate(contract.nextServiceDate, "–")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* HOYRE: Oppdrag & Booking */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* BOOK NYTT OPPDRAG */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="font-bold text-lg text-gray-900 border-b border-gray-200 pb-2 mb-4">📅 Book nytt oppdrag</h2>
              <p className="text-gray-500 text-sm mb-4">Bestill service eller vedlikehold for din bedrift.</p>
              <form action={bookWorkOrder} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-700 mb-1 uppercase tracking-wider">Oppdragstittel *</label>
                  <input type="text" name="title" required placeholder="F.eks. Årlig service" className="w-full border border-gray-300 p-2 rounded-xl text-sm bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-700 mb-1 uppercase tracking-wider">Beskrivelse</label>
                  <MarkdownEditor name="description" rows={2} placeholder="Hva trenger du hjelp med?" />
                </div>
                <button type="submit" className="w-full bg-[var(--primary-color)] text-white px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition whitespace-nowrap">
                  Book oppdrag
                </button>
              </form>
            </div>

            {/* KOMMENDE OPPDRAG */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4 border-b pb-2">
                <div>
                  <h2 className="font-bold text-lg text-gray-900">📅 Kommende oppdrag</h2>
                  <p className="text-[10px] text-gray-500 mt-0.5">Oppdrag som er planlagt eller pågår.</p>
                </div>
              </div>

              {upcomingWorkOrders.length === 0 ? (
                <div className="bg-gray-50 p-6 rounded-xl border border-dashed border-gray-200 text-center">
                  <p className="text-gray-500 italic text-sm">Ingen kommende oppdrag.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingWorkOrders.map(wo => (
                    <div key={wo.id} className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{wo.title}</p>
                          <p className="text-[10px] text-gray-500">
                            📅 {formatDate(wo.scheduledFor, "Ingen dato")}
                          </p>
                        </div>
                        <StatusBadge status={wo.status} />
                      </div>
                      <p className="text-[10px] text-gray-600">
                        🏢 {customer.name}
                        {wo.technicians.length > 0 && (
                          <span className="text-blue-600 font-bold ml-1">• {wo.technicians.map(t => t.name).join(", ")}</span>
                        )}
                      </p>
                      {wo.description && (
                        <p className="text-[10px] text-gray-700 italic mt-1">
                          {markdownToPlainText(wo.description)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SERVICEHISTORIKK */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4 border-b pb-2">
                <div>
                  <h2 className="font-bold text-lg text-gray-900">📋 Servicehistorikk & Rapporter</h2>
                  <p className="text-[10px] text-gray-500 mt-0.5">Utførte og kansellerte jobber, med rapporter.</p>
                </div>
              </div>

              {completedWorkOrders.length === 0 ? (
                <p className="text-gray-500 italic text-sm">Ingen historikk enda.</p>
              ) : (
                <div className="space-y-3">
                  {completedWorkOrders.map(wo => (
                    <div key={wo.id} className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{wo.title}</p>
                          <p className="text-[10px] text-gray-500">{formatDate(wo.scheduledFor, "Ingen dato")}</p>
                        </div>
                        <StatusBadge status={wo.status} />
                      </div>
                      {wo.reports.length > 0 ? (
                        <Link href={`/rapporter/${wo.id}`} className="bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm whitespace-nowrap">
                          Last ned PDF
                        </Link>
                      ) : (
                        <span className="text-[10px] text-gray-400 italic bg-gray-200 px-1.5 py-0.5 rounded">Ingen rapport</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* TEKNIKERTILGJENGELIGHET – neste 7 dager */}
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 mt-6">
          <div className="mb-4 border-b pb-2">
            <h2 className="font-bold text-lg text-gray-900">🗓️ Ledige teknikere</h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Oversikt over teknikernes ledige og opptatte dager de neste 7 dagene.
            </p>
          </div>

          {technicians.length === 0 ? (
            <p className="text-gray-500 italic text-sm">Ingen teknikere registrert.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[560px]">
                <thead>
                  <tr>
                    <th className="text-left font-bold text-gray-500 uppercase tracking-wider p-2 border-b">
                      Tekniker
                    </th>
                    {days.map((d) => (
                      <th
                        key={dateKey(d)}
                        className="text-center font-bold text-gray-500 uppercase tracking-wider p-2 border-b"
                      >
                        <span className="block">
                          {d.toLocaleDateString("no-NO", { weekday: "short" })}
                        </span>
                        <span className="block text-[10px] font-medium text-gray-400">
                          {toDateOnly(d)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {technicians.map((tech) => (
                    <tr key={tech.id} className="border-b last:border-0">
                      <td className="p-2 font-bold text-gray-800 whitespace-nowrap">
                        {tech.name || "Uten navn"}
                      </td>
                      {days.map((d) => {
                        const isBusy = busyByTechnician.get(tech.id)?.has(dateKey(d));
                        return (
                          <td key={dateKey(d)} className="p-2 text-center">
                            {isBusy ? (
                              <span className="inline-block bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-[10px] font-bold">
                                Opptatt
                              </span>
                            ) : (
                              <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded-full text-[10px] font-bold">
                                Ledig
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">
            «Opptatt» betyr at teknikeren har et planlagt oppdrag denne dagen. Ta kontakt for å
            avtale et tidspunkt som passer.
          </p>
        </div>

      </div>
    </div>
  );
}
