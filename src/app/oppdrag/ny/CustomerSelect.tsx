"use client";

import { useState } from "react";

export default function CustomerSelect({ customers, contacts = [], optional = false }: { customers: any[]; contacts?: any[]; optional?: boolean }) {
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Filtrer kunder basert på søkeord
  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.customerNumber && c.customerNumber.toLowerCase().includes(search.toLowerCase())) ||
    (c.city && c.city.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="relative">
      <label className={`block text-sm font-bold text-gray-700 mb-1`}>Velg kunde${optional ? " (valgfritt)" : ""}</label>
      
      {/* Skjult felt som sender med customerId i skjemaet */}
      <input type="hidden" name="customerId" value={selectedCustomer?.id || ""} />

      {/* Visningsboks som åpner søk */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium cursor-pointer flex justify-between items-center shadow-sm"
      >
        <span>
          {selectedCustomer ? `${selectedCustomer.name} ${selectedCustomer.city ? `(${selectedCustomer.city})` : ""}` : "-- Velg eller søk etter kunde --"}
        </span>
        <span className="text-gray-400">▼</span>
      </div>

      {/* Nedtrekksmeny med søkefelt */}
      {isOpen && (
        <div className="absolute z-10 w-full mt-2 bg-white border border-gray-300 rounded-2xl shadow-lg p-3 space-y-2">
          <input 
            type="text" 
            placeholder="Søk etter kunde, by eller kundenr..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-gray-50 outline-none focus:border-blue-500 font-medium"
          />

          <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-gray-50">
            {filteredCustomers.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-3">Ingen kunder matchet søket.</p>
            ) : (
              filteredCustomers.map(c => (
                <div 
                  key={c.id}
                  onClick={() => {
                    setSelectedCustomer(c);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  className="p-2.5 rounded-xl hover:bg-blue-50 cursor-pointer transition text-sm flex justify-between items-center"
                >
                  <span className="font-bold text-gray-800">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.city || ""} {c.customerNumber ? `(Knr: ${c.customerNumber})` : ""}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {customers.length === 0 && (
        <p className="text-xs text-red-500 mt-1">Ingen kunder funnet i systemet.</p>
      )}

      {selectedCustomer && (
        <div className="mt-3">
          <label className="block text-sm font-bold text-gray-700 mb-1">Kontaktperson (valgfritt)</label>
          {contacts.filter((c) => c.customerId === selectedCustomer.id).length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              Kunden har ingen registrerte kontaktpersoner. Du kan legge til én når oppdraget er opprettet.
            </p>
          ) : (
            <select
              name="contactId"
              defaultValue=""
              className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium shadow-sm outline-none focus:border-blue-500"
            >
              <option value="">— Ingen kontaktperson —</option>
              {contacts
                .filter((c) => c.customerId === selectedCustomer.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.role ? ` (${c.role})` : ""}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
