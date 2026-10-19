"use client";

import { useState } from "react";
import Link from "next/link";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";

export default function CreateWorkOrderForm({ customers, templates, tags }: { customers: any[], templates: any[], tags: any[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);

  // Filtrerer kundene i sanntid mens man skriver
  const filteredCustomers = searchTerm.trim() === "" ? [] : customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.city && c.city.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (c.phone && c.phone.includes(searchTerm))
  );

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      <div className="bg-gray-900 text-white p-6 shadow-md rounded-b-3xl">
        <Link href="/mine-oppdrag" className="text-gray-300 hover:text-white text-sm mb-4 inline-block">&larr; Tilbake til mine oppdrag</Link>
        <h1 className="text-2xl font-bold">➕ Opprett nytt oppdrag</h1>
        <p className="text-gray-400 text-sm mt-1">Registrer en ny jobb direkte fra feltet.</p>
      </div>

      <div className="px-4 max-w-md mx-auto mt-6">
        <form action="/api/technician/workorders/create" method="POST" className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Tittel / Oppdragstype</label>
            <input type="text" name="title" placeholder="F.eks. Akutt reparasjon / Ekstra service" required className="w-full border p-3 rounded-xl text-sm text-gray-800" />
          </div>

          {/* SØKEBAR FOR KUNDER */}
          <div className="relative">
            <label className="block text-sm font-semibold text-gray-700 mb-1">Velg Kunde (valgfritt)</label>
            
            {selectedCustomer ? (
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl flex justify-between items-center">
                <div>
                  <p className="font-bold text-blue-900 text-sm">{selectedCustomer.name}</p>
                  <p className="text-xs text-blue-700">
                    <GoogleMapsLink
                      address={selectedCustomer.address}
                      city={selectedCustomer.city}
                      label={selectedCustomer.address || "Ingen adresse"}
                    />
                  </p>
                </div>
                <button 
                  type="button" 
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs text-red-600 font-bold bg-white px-2 py-1 rounded border shadow-sm hover:bg-red-50"
                >
                  Bytt kunde
                </button>
              </div>
            ) : (
              <div>
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Skriv for å søke etter kunde eller by..." 
                  className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input type="hidden" name="customerId" value={selectedCustomer?.id || ""} />

                {/* Dropdown med søkeresultater */}
                {filteredCustomers.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {filteredCustomers.map(c => (
                      <div 
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer(c);
                          setSearchTerm("");
                        }}
                        className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 text-sm"
                      >
                        <p className="font-bold text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-500">
                        <GoogleMapsLink
                          address={c.address}
                          city={c.city}
                          label={c.address || "-"}
                        />
                      </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Dato for utførelse</label>
              <input type="date" name="scheduledFor" defaultValue={new Date().toISOString().split('T')[0]} required className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Til dato (valgfritt)</label>
              <input type="date" name="scheduledTo" className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50" />
              <p className="text-[11px] text-gray-500 mt-1">Tom = éndagsoppdrag.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Sjekklistemal (Valgfritt)</label>
            <select name="templateId" className="w-full border p-3 rounded-xl text-sm text-gray-800 bg-gray-50">
              <option value="">-- Ingen sjekkliste --</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Tags</label>
            <TagSelector allTags={tags} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Beskrivelse / Instruks</label>
            <MarkdownEditor name="description" rows={3} placeholder="Hva skal gjøres?" />
          </div>

          <button type="submit" className="w-full bg-[var(--primary-color)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            Opprett oppdrag
          </button>
        </form>
      </div>
    </div>
  );
}
