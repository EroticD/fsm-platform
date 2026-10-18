import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";

export default async function SearchResultsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  
  // Vi lar kun Admin (og evt montører) gjøre globale søk for sikkerhets skyld
  if (user?.role === "CUSTOMER") redirect("/kundeportal");

  const resolvedParams = await searchParams;
  const query = resolvedParams.q?.trim() || "";

  let customers: any[] = [];
  let workOrders: any[] = [];
  let products: any[] = [];
  let contacts: any[] = [];

  // Kun søk hvis søkefeltet har innhold
  if (query.length > 0) {
    
    // Vi kjører alle 4 søkene PARALLELT med Promise.all for at søket skal være lynraskt!
    [customers, workOrders, products, contacts] = await Promise.all([
      // 1. Søk i Kunder
      prisma.customer.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } },
            { orgNumber: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 10
      }),
      // 2. Søk i Oppdrag
      prisma.workOrder.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: { customer: true },
        take: 10
      }),
      // 3. Søk i Utstyr/Maskiner
      prisma.product.findMany({
        where: {
          OR: [
            { model: { contains: query, mode: 'insensitive' } },
            { serialNumber: { contains: query, mode: 'insensitive' } },
            { location: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: { customer: true },
        take: 10
      }),
      // 4. Søk i Kontaktpersoner
      prisma.contact.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: { customer: true },
        take: 10
      })
    ]);
  }

  const totalResults = customers.length + workOrders.length + products.length + contacts.length;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Tilbake og Søkefelt igjen for raske nye søk */}
        <div className="flex gap-4 items-center">
          <Link href="/" className="bg-white border text-gray-700 px-4 py-3 rounded-xl font-bold hover:bg-gray-50 shadow-sm">&larr; Hjem</Link>
          <form action="/sok" method="GET" className="flex-1 flex gap-2">
            <input type="text" name="q" defaultValue={query} className="w-full border p-3 rounded-xl shadow-sm text-gray-800 text-lg outline-none" required />
            <button type="submit" className="bg-blue-600 text-white px-6 rounded-xl font-bold hover:bg-blue-700 shadow-sm">Søk</button>
          </form>
        </div>

        {query.length === 0 ? (
          <div className="text-center py-20"><p className="text-gray-500 text-lg">Skriv inn noe i søkefeltet for å starte. 👆</p></div>
        ) : (
          <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-6">Søkeresultater for «{query}» <span className="text-gray-400 text-lg">({totalResults} treff)</span></h1>

            {totalResults === 0 && (
              <div className="bg-yellow-50 p-6 rounded-xl border border-yellow-200 text-center">
                <p className="text-yellow-800 font-bold">Ingen treff!</p>
                <p className="text-yellow-700 text-sm mt-1">Sjekk stavingen eller prøv å søke på et annet ord.</p>
              </div>
            )}

            <div className="space-y-6">
              
              {/* Kundetreff */}
              {customers.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">🏢 Kunder ({customers.length})</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {customers.map(c => (
                      <Link key={c.id} href={`/kunder/${c.id}`} className="block p-3 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition">
                        <p className="font-bold text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-500">{c.email || c.phone || "Ingen kontaktinfo"}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Kontaktpersoner */}
              {contacts.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">📞 Kontaktpersoner ({contacts.length})</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {contacts.map(cp => (
                      <Link key={cp.id} href={`/kunder/${cp.customerId}`} className="block p-3 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition">
                        <p className="font-bold text-gray-800">{cp.name} <span className="text-gray-400 font-normal">({cp.customer.name})</span></p>
                        <p className="text-xs text-gray-500">Tlf: {cp.phone || "-"} | E-post: {cp.email || "-"}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Utstyr/Maskiner */}
              {products.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">⚙️ Utstyr / Maskiner ({products.length})</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {products.map(p => (
                      <Link key={p.id} href={`/kunder/${p.customerId}`} className="block p-3 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition">
                        <p className="font-bold text-gray-800">{p.model}</p>
                        <p className="text-xs text-gray-600">SN: <span className="font-mono bg-gray-100 px-1 rounded">{p.serialNumber || "–"}</span></p>
                        <p className="text-xs text-gray-400 mt-1">Tilhører: {p.customer.name}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Oppdrag */}
              {workOrders.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">📋 Oppdrag ({workOrders.length})</h2>
                  <div className="space-y-3">
                    {workOrders.map(wo => (
                      <Link key={wo.id} href={`/oppdrag/${wo.id}`} className="block p-3 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition">
                        <div className="flex justify-between items-start">
                          <p className="font-bold text-gray-800">{wo.title}</p>
                          <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${wo.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {wo.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Kunde: {wo.customer.name}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
