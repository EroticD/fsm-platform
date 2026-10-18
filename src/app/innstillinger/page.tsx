import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import AuditLogTable from "@/components/AuditLogTable";
import UsersAdmin from "@/components/UsersAdmin";
import { isOffice, requireOffice } from "@/lib/session";

export default async function SettingsPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ tab?: string; search?: string; dateFrom?: string; dateTo?: string; status?: string; customer?: string; technician?: string; page?: string; invite?: string; error?: string; mail?: string }> 
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) redirect("/");
  // Innstillinger er kontorets verktøy (merkevare, maler, ansatte, statistikk
  // og aktivitetslogg). Montører bruker feltportalen i stedet.
  if (!isOffice(user.role)) redirect("/");

  // Vent på searchParams (kreves i nyere Next.js) og sett standardfane
  const resolvedParams = await searchParams;
  const currentTab = resolvedParams.tab || "branding";
  const searchQuery = resolvedParams.search || "";

  // Hent data for alle fanene
  const branding = await prisma.branding.findFirst();
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });

  // --- AUDIT LOG DATA ---
  const auditDateFrom = resolvedParams.dateFrom || "";
  const auditDateTo = resolvedParams.dateTo || "";
  const page = parseInt(resolvedParams.page?.toString() || "1", 10);
  const pageSize = 50;
  const skip = (page - 1) * pageSize;

  // Build where clause conditionally to avoid TypeScript issues
  const whereClause: any = {};

  if (searchQuery) {
    whereClause.OR = [
      { action: { contains: searchQuery, mode: 'insensitive' } },
      { userName: { contains: searchQuery, mode: 'insensitive' } },
      { entityType: { contains: searchQuery, mode: 'insensitive' } },
    ];
  }

  if (auditDateFrom) {
    whereClause.createdAt = { ...(whereClause.createdAt || {}), gte: new Date(auditDateFrom) };
  }

  if (auditDateTo) {
    whereClause.createdAt = { ...(whereClause.createdAt || {}), lte: new Date(auditDateTo + 'T23:59:59') };
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: pageSize,
    skip: skip,
  });

  const totalAuditLogs = await prisma.auditLog.count({
    where: whereClause,
  });

  // --- STATISTIKK DATA ---
  const dateFrom = resolvedParams.dateFrom || "";
  const dateTo = resolvedParams.dateTo || "";
  const statusFilter = resolvedParams.status || "";
  const customerFilter = resolvedParams.customer || "";
  const technicianFilter = resolvedParams.technician || "";

  // Hent kunder og montører for filtrering
  const statsCustomers = await prisma.customer.findMany({
    orderBy: { name: 'asc' },
    take: 50
  });
  const statsTechnicians = await prisma.user.findMany({
    where: { role: { in: ['TECHNICIAN', 'ADMIN', 'OFFICE'] } },
    orderBy: { name: 'asc' }
  });

  // Bygg where-clause for statistikk
  const statsWhere: any = {};
  if (dateFrom) statsWhere.scheduledFor = { gte: new Date(dateFrom) };
  if (dateTo) {
    statsWhere.scheduledFor = {
      ...statsWhere.scheduledFor,
      lte: new Date(dateTo + 'T23:59:59')
    };
  }
  if (statusFilter) statsWhere.status = statusFilter;
  if (customerFilter) statsWhere.customerId = customerFilter;
  if (technicianFilter) statsWhere.technicians = { some: { id: technicianFilter } };

  const statsWorkOrders = await prisma.workOrder.findMany({
    where: statsWhere,
    include: {
      customer: true,
      technicians: true
    },
    orderBy: { scheduledFor: 'desc' }
  });

  // Beregn statistikk
  const totalWorkOrders = statsWorkOrders.length;
  const byStatus = statsWorkOrders.reduce((acc: any, wo) => {
    acc[wo.status] = (acc[wo.status] || 0) + 1;
    return acc;
  }, {} as any);
  const byTechnician = statsWorkOrders.reduce((acc: any, wo) => {
    wo.technicians.forEach((t: any) => {
      acc[t.name || 'Ukjent'] = (acc[t.name || 'Ukjent'] || 0) + 1;
    });
    return acc;
  }, {} as any);
  const byCustomer = statsWorkOrders.reduce((acc: any, wo) => {
    acc[wo.customer?.name || "Uten kunde"] = (acc[wo.customer?.name || "Uten kunde"] || 0) + 1;
    return acc;
  }, {} as any);

  // Månedlig trend (siste 6 måneder)
  const monthlyTrend: Record<string, number> = statsWorkOrders.reduce((acc: Record<string, number>, wo) => {
    if (!wo.scheduledFor) return acc;
    const month = new Date(wo.scheduledFor).toISOString().slice(0, 7); // YYYY-MM
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {});

  // --- SERVER ACTION: LAGRE BRANDING ---
  async function saveBranding(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const companyName = formData.get("companyName") as string;
    const primaryColor = formData.get("primaryColor") as string;
    const logoUrl = formData.get("logoUrl") as string;
    
    const existing = await prisma.branding.findFirst();
    if (existing) {
      await prisma.branding.update({ where: { id: existing.id }, data: { companyName, primaryColor, logoUrl: logoUrl || null } });
    } else {
      await prisma.branding.create({ data: { companyName, primaryColor, logoUrl: logoUrl || null } });
    }
    await prisma.auditLog.create({
      data: {
        entityType: "Branding",
        entityId: "branding",
        action: `Oppdaterte merkevareinnstillinger: ${companyName}`,
        userName: user?.name || "Ukjent"
      }
    });
    revalidatePath("/innstillinger");
  }

  // --- SERVER ACTION: OPPRETT SJEKKLISTE ---
  async function createTemplate(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const title = formData.get("title") as string;
    if (!title) return;

    await prisma.template.create({
      data: { 
        title,
        fieldsJson: "[]"
      }
    });
    await prisma.auditLog.create({
      data: {
        entityType: "Template",
        entityId: title,
        action: `Opprettet sjekkliste: ${title}`,
        userName: user?.name || "Ukjent"
      }
    });
    revalidatePath("/innstillinger");
  }

  // --- SERVER ACTION: SLETT SJEKKLISTE ---
  async function deleteTemplate(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const id = formData.get("id") as string;
    if (!id) return;

    const templateToDelete = await prisma.template.findUnique({
      where: { id },
    });
    await prisma.template.delete({
      where: { id }
    });
    await prisma.auditLog.create({
      data: {
        entityType: "Template",
        entityId: id,
        action: `Slettet sjekkliste: ${templateToDelete?.title || "Ukjent"}`,
        userName: user?.name || "Ukjent"
      }
    });
    revalidatePath("/innstillinger");
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">⚙️ Innstillinger</h1>
            <p className="text-gray-500 mt-1 text-sm">Administrer systemet, merkevare og skjemaer.</p>
          </div>
          <Link href="/" className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition shadow-sm">
            &larr; Tilbake til Dashbord
          </Link>
        </div>

        {/* FANER (TABS) */}
        <div className="flex space-x-2 border-b border-gray-200">
          <Link 
            href="?tab=branding" 
            className={`px-5 py-3 text-sm font-bold border-b-2 transition-colors ${currentTab === 'branding' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            🎨 Merkevare
          </Link>
          <Link 
            href="?tab=ansatte" 
            className={`px-5 py-3 text-sm font-bold border-b-2 transition-colors ${currentTab === 'ansatte' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            👥 Ansatte & Roller
          </Link>
          <Link 
            href="?tab=maler" 
            className={`px-5 py-3 text-sm font-bold border-b-2 transition-colors ${currentTab === 'maler' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            📋 Sjekklister / Maler
          </Link>
          {user?.role === "ADMIN" && (
            <Link 
              href="?tab=auditlog" 
              className={`px-5 py-3 text-sm font-bold border-b-2 transition-colors ${currentTab === 'auditlog' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              📋 Aktivitetslogg
            </Link>
          )}
          {(user?.role === "ADMIN" || user?.role === "OFFICE") && (
            <Link 
              href="?tab=statistikk" 
              className={`px-5 py-3 text-sm font-bold border-b-2 transition-colors ${currentTab === 'statistikk' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              📊 Statistikk
            </Link>
          )}
        </div>

        {/* INNHOLD BASERT PÅ VALGT FANE */}
        
        {/* FANE 1: BRANDING */}
        {currentTab === 'branding' && (
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-6">White-label Innstillinger</h2>
            <form action={saveBranding} className="space-y-5 max-w-md">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Firmanavn</label>
                <input type="text" name="companyName" defaultValue={branding?.companyName || ""} placeholder="F.eks. Elektro Experten AS" required className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Hovedfarge (Hex-kode)</label>
                <div className="flex gap-3 items-center">
                  <input type="color" name="primaryColor" defaultValue={branding?.primaryColor || "#2563eb"} className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300" />
                  <input type="text" defaultValue={branding?.primaryColor || "#2563eb"} className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium bg-gray-50" readOnly />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Logo URL (valgfritt)</label>
                <input 
                  type="url" 
                  name="logoUrl" 
                  defaultValue={branding?.logoUrl || ""} 
                  placeholder="https://..." 
                  className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                />
                <p className="text-xs text-gray-500 mt-1">Ekstern URL til firmanlogo. Brukes på rapporter, e-post og dashbord-header.</p>
              </div>
              <button type="submit" className="bg-[var(--primary-color)] text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
                Lagre endringer
              </button>
            </form>
          </div>
        )}

        {/* FANE 2: ANSATTE */}
        {currentTab === 'ansatte' && (
          <UsersAdmin
            returnTo="/innstillinger?tab=ansatte"
            currentUserEmail={user.email}
            invite={resolvedParams.invite}
            error={resolvedParams.error}
            mail={resolvedParams.mail}
          />
        )}

        {/* FANE 3: MALER & SJEKKLISTER */}
        {currentTab === 'maler' && (
          <div className="space-y-6">
            
            {/* Opprett ny mal */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Opprett ny sjekkliste</h2>
              <p className="text-sm text-gray-500 mb-5">Lag en ny mal som kan knyttes til fremtidige oppdrag.</p>
              
              <form action={createTemplate} className="flex gap-3 max-w-lg">
                <input 
                  type="text" 
                  name="title" 
                  placeholder="Navn på sjekkliste (f.eks. Årlig Service Varmepumpe)" 
                  required 
                  className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500" 
                />
                <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
                  + Opprett
                </button>
              </form>
            </div>

            {/* Eksisterende maler */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Tilgjengelige Maler ({templates.length})</h2>
              
              {templates.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Du har ikke opprettet noen sjekklistemaler ennå.</p>
              ) : (
                <div className="space-y-3">
                   {templates.map(template => (
                    <div key={template.id} className="flex justify-between items-center p-4 bg-gray-50 border border-gray-100 rounded-xl">
                      <span className="font-bold text-gray-800">{template.title}</span>
                      
                      <div className="flex gap-2">
                        {/* NY KNAPP: Rediger */}
                        <Link 
                          href={`/innstillinger/maler/${template.id}`} 
                          className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-bold text-sm px-3 py-1.5 rounded-lg transition"
                        >
                          Rediger
                        </Link>
                        
                        {/* Eksisterende Slett-knapp */}
                        <form action={deleteTemplate}>
                          <input type="hidden" name="id" value={template.id} />
                          <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">
                            Slett
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* FANE 4: AKTIVITETSLOGG (ADMIN ONLY) */}
        {currentTab === 'auditlog' && (
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-6">📋 Systemaktivitetslogg</h2>
            <p className="text-gray-500 text-sm mb-6">Alle systemhendelser og brukeraktiviteter.</p>
            
            {/* FILTER OG SØK */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
              <form method="GET" className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <input
                  type="text"
                  name="search"
                  placeholder="Søk i aktivitetslogg..."
                  defaultValue={resolvedParams.search || ""}
                  className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                />
                <input
                  type="date"
                  name="dateFrom"
                  placeholder="Fra dato"
                  defaultValue={resolvedParams.dateFrom || ""}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                />
                <input
                  type="date"
                  name="dateTo"
                  placeholder="Til dato"
                  defaultValue={resolvedParams.dateTo || ""}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                />
                <button type="submit" className="bg-gray-900 text-white px-4 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
                  Søk
                </button>
                {(resolvedParams.search || resolvedParams.dateFrom || resolvedParams.dateTo) && (
                  <Link href="?tab=auditlog" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition whitespace-nowrap">
                    Nullstill
                  </Link>
                )}
              </form>
            </div>

            <AuditLogTable 
              logs={auditLogs} 
              showEntityFilter 
              page={page}
              pageSize={pageSize}
              totalCount={totalAuditLogs}
              baseUrl={`/innstillinger?tab=auditlog${resolvedParams.search ? `&search=${resolvedParams.search}` : ''}${auditDateFrom ? `&dateFrom=${auditDateFrom}` : ''}${auditDateTo ? `&dateTo=${auditDateTo}` : ''}`}
            />
          </div>
        )}

        {/* FANE 5: STATISTIKK (ADMIN ONLY) */}
        {currentTab === 'statistikk' && (
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-6">📊 Statistikk</h2>
            <p className="text-gray-500 text-sm mb-6">Oppdragsstatistikk og filtrering.</p>

            {/* FILTER */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
              <form method="GET" className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <input
                  type="date"
                  name="dateFrom"
                  placeholder="Fra dato"
                  defaultValue={dateFrom}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                />
                <input
                  type="date"
                  name="dateTo"
                  placeholder="Til dato"
                  defaultValue={dateTo}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                />
                <select
                  name="status"
                  defaultValue={statusFilter || ""}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                >
                  <option value="">Alle statuser</option>
                  <option value="PLANNED">Planlagt</option>
                  <option value="IN_PROGRESS">Påbegynt</option>
                  <option value="WAITING">Venter</option>
                  <option value="COMPLETED">Fullført</option>
                  <option value="CANCELLED">Kansellert</option>
                  <option value="OPEN">Åpen</option>
                  <option value="PENDING">Planlagt (PENDING)</option>
                </select>
                <select
                  name="customer"
                  defaultValue={customerFilter || ""}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                >
                  <option value="">Alle kunder</option>
                  {statsCustomers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  name="technician"
                  defaultValue={technicianFilter || ""}
                  className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
                >
                  <option value="">Alle montører</option>
                  {statsTechnicians.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button type="submit" className="bg-gray-900 text-white px-4 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
                  Filtrer
                </button>
                {(dateFrom || dateTo || statusFilter || customerFilter || technicianFilter) && (
                  <Link href="?tab=statistikk" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition whitespace-nowrap">
                    Nullstill
                  </Link>
                )}
              </form>
            </div>

            {/* STATISTIKK KORT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Totalt oppdrag</p>
                <p className="text-3xl font-black text-gray-900">{totalWorkOrders}</p>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Planlagt</p>
                <p className="text-3xl font-black text-yellow-600">{byStatus.PLANNED || 0}</p>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Påbegynt</p>
                <p className="text-3xl font-black text-blue-600">{byStatus.IN_PROGRESS || 0}</p>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Fullført</p>
                <p className="text-3xl font-black text-green-600">{byStatus.COMPLETED || 0}</p>
              </div>
            </div>

            {/* MÅNEDLIG TREND */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 mb-6">
              <h3 className="font-bold text-gray-900 mb-4">Månedlig trend</h3>
              <div className="flex items-end gap-2 h-40">
                {Object.entries(monthlyTrend as Record<string, number>)
                  .sort()
                  .slice(-6)
                  .map(([month, count]: [string, number]) => {
                    const maxCount = Math.max(...Object.values(monthlyTrend));
                    const height = maxCount > 0 ? Math.max(10, (count / maxCount) * 100) : 10;
                    return (
                      <div key={month} className="flex flex-col items-center gap-1">
                        <div
                          className="w-full bg-blue-600 rounded-t-sm"
                          style={{ height: `${height}%` }}
                        />
                        <span className="text-[10px] text-gray-500">{month.slice(5)}</span>
                        <span className="text-[10px] font-bold text-gray-900">{count}</span>
                      </div>
                    );
                  })}
              </div>
              <p className="text-[10px] text-gray-500 mt-2 text-right">
                Siste 6 måneder med data
              </p>
            </div>

            {/* PER MONTØR */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 mb-6">
              <h3 className="font-bold text-gray-900 mb-4">Per montør</h3>
              <div className="space-y-2">
                {Object.entries(byTechnician as Record<string, number>)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, count]) => (
                    <div key={name} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-sm font-medium text-gray-900">{name}</span>
                      <span className="text-sm font-bold text-gray-700">{count} oppdrag</span>
                    </div>
                  ))}
                {Object.keys(byTechnician).length === 0 && (
                  <p className="text-sm text-gray-500 italic text-center py-4">Ingen data</p>
                )}
              </div>
            </div>

            {/* PER KUNDE */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="font-bold text-gray-900 mb-4">Per kunde</h3>
              <div className="space-y-2">
                {Object.entries(byCustomer as Record<string, number>)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([name, count]) => (
                    <div key={name} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <span className="text-sm font-medium text-gray-900 truncate max-w-xs">{name}</span>
                      <span className="text-sm font-bold text-gray-700">{count} oppdrag</span>
                    </div>
                  ))}
                {Object.keys(byCustomer).length === 0 && (
                  <p className="text-sm text-gray-500 italic text-center py-4">Ingen data</p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
