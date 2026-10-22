import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

export default async function TechnicianCustomerLookupPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q ? resolvedParams.q.trim() : "";

  let customers: any[] = [];

  if (searchQuery.length > 0) {
    customers = await prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: searchQuery, mode: 'insensitive' } },
          { customerNumber: { contains: searchQuery, mode: 'insensitive' } },
          { address: { contains: searchQuery, mode: 'insensitive' } },
          { city: { contains: searchQuery, mode: 'insensitive' } },
          { phone: { contains: searchQuery, mode: 'insensitive' } }
        ]
      },
      include: {
        contacts: true,
        products: true,
      },
      take: 20
    });
  } else {
    customers = await prisma.customer.findMany({
      orderBy: { name: 'asc' },
      include: {
        contacts: true,
        products: true,
      },
      take: 10
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* TOPPTEKST OG TILBAKE */}
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🔍 Kunde- og Utstyrsarkiv</h1>
            <p className="text-sm text-gray-500">Søk etter kunder, adresser eller kundenummer i felt.</p>
          </div>
          <Link href="/mine-oppdrag" className="bg-white text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border shadow-sm hover:bg-gray-50">
            &larr; Tilbake til mine oppdrag
          </Link>
        </div>

        {/* SØKEFELT */}
        <form method="GET" action="/mine-oppdrag/kunder" className="flex gap-2">
          <input 
            type="text" 
            name="q" 
            defaultValue={searchQuery}
            placeholder="Søk på kunde, adresse, tlf eller kundenr..." 
            className="w-full border border-gray-300 bg-white px-4 py-3 rounded-xl text-sm text-gray-900 font-medium shadow-sm outline-none focus:border-blue-500"
          />
          <button type="submit" className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-blue-700 shadow-sm transition">
            Søk
          </button>
          {searchQuery && (
            <Link href="/mine-oppdrag/kunder" className="bg-gray-200 text-gray-700 px-4 py-3 rounded-xl font-bold text-sm hover:bg-gray-300 transition flex items-center justify-center">
              ✕
            </Link>
          )}
        </form>

        {/* RESULTATER */}
        <div className="space-y-4">
          {customers.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl text-center border shadow-sm">
              <p className="text-gray-500 text-sm">Ingen kunder funnet.</p>
            </div>
          ) : (
            customers.map((c: any) => (
              <div key={c.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                
                <div className="flex justify-between items-start border-b pb-3">
                  <div>
                    <h2 className="font-bold text-lg text-gray-900">{c.name}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        <GoogleMapsLink
                          address={c.address}
                          postalCode={c.postalCode}
                          city={c.city}
                          label={c.address || "Ingen adresse"}
                        />
                        {c.customerNumber ? ` • Knr: ${c.customerNumber}` : ""}
                      </p>
                  </div>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-200 hover:bg-blue-100 transition">
                      📞 Ring {c.phone}
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  
                  {/* Kontaktpersoner */}
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="font-bold text-gray-700 text-xs uppercase tracking-wider mb-2">Kontaktpersoner</p>
                    {c.contacts.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Ingen registrerte kontakter.</p>
                    ) : (
                      c.contacts.map((contact: any) => (
                        <div key={contact.id} className="text-xs py-1">
                          <span className="font-bold text-gray-800">{contact.name}</span> ({contact.role || "Kontakt"})
                          {contact.phone && <a href={`tel:${contact.phone}`} className="text-blue-600 block mt-0.5">📞 {contact.phone}</a>}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Utstyr / Maskiner */}
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="font-bold text-gray-700 text-xs uppercase tracking-wider mb-2">Utstyr & Maskiner</p>
                    {c.products.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Ingen utstyr registrert.</p>
                    ) : (
                      c.products.map((prod: any) => (
                        <div key={prod.id} className="text-xs py-1">
                          <span className="font-bold text-gray-800">{prod.model}</span> 
                          <span className="text-gray-500 font-mono ml-1">(SN: {prod.serialNumber || "-"})</span>
                        </div>
                      ))
                    )}
                  </div>

                </div>

              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
