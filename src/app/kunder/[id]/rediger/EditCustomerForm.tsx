"use client";

import { useState } from "react";
import Link from "next/link";

export default function EditCustomerForm({ customer, updateAction }: { customer: any, updateAction: (data: any) => void }) {
  const [formData, setFormData] = useState({
    name: customer.name || "",
    customerNumber: customer.customerNumber || "",
    orgNumber: customer.orgNumber || "",
    email: customer.email || "",
    phone: customer.phone || "",
    address: customer.address || "",
    postalCode: customer.postalCode || "",
    city: customer.city || "",
  });

  const [contacts, setContacts] = useState<any[]>(
    customer.contacts.length > 0 ? customer.contacts : []
  );

  const handleAddContact = () => {
    setContacts([...contacts, { id: `new-${Date.now()}`, name: "", role: "", phone: "", email: "" }]);
  };

  const handleRemoveContact = (idToRemove: string) => {
    setContacts(contacts.filter(c => c.id !== idToRemove));
  };

  const updateContact = (id: string, field: string, value: string) => {
    setContacts(contacts.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateAction({ ...formData, contacts });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto">
      
      {/* KUNDEINFORMASJON */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="font-bold text-lg text-gray-800 border-b pb-2">Firmainformasjon</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Kundenavn / Firmanavn *</label>
            <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Kundenummer (CRM)</label>
            <input type="text" value={formData.customerNumber} onChange={e => setFormData({...formData, customerNumber: e.target.value})} placeholder="F.eks. 10425" className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Organisasjonsnummer</label>
            <input type="text" value={formData.orgNumber} onChange={e => setFormData({...formData, orgNumber: e.target.value})} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Hoved-epost</label>
            <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Hovedtelefon</label>
            <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
          </div>
          <div className="md:col-span-2 grid grid-cols-6 gap-3">
            <div className="col-span-6 md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-1">Gateadresse</label>
              <input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="block text-sm font-bold text-gray-700 mb-1">Postnr</label>
              <input type="text" value={formData.postalCode} onChange={e => setFormData({...formData, postalCode: e.target.value})} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
            </div>
            <div className="col-span-4 md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Poststed</label>
              <input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium" />
            </div>
          </div>
        </div>
      </div>

      {/* KONTAKTPERSONER */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex justify-between items-center border-b pb-2">
          <h2 className="font-bold text-lg text-gray-800">Kontaktpersoner</h2>
          <button type="button" onClick={handleAddContact} className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-700 transition">
            + Legg til person
          </button>
        </div>

        {contacts.length === 0 ? (
          <p className="text-sm text-gray-500 italic text-center py-4">Ingen kontakter lagt til.</p>
        ) : (
          <div className="space-y-4">
            {contacts.map((contact, index) => (
              <div key={contact.id} className="bg-gray-50 p-4 rounded-xl border border-gray-200 relative">
                <button type="button" onClick={() => handleRemoveContact(contact.id)} className="absolute top-3 right-3 text-red-600 hover:bg-red-50 p-1 rounded font-bold text-xs border border-transparent hover:border-red-200 transition">
                  Fjern
                </button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-10">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Navn *</label>
                    <input type="text" required value={contact.name} onChange={e => updateContact(contact.id, "name", e.target.value)} className="w-full border border-gray-300 p-2 rounded text-sm text-gray-900 bg-white font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Rolle/Tittel</label>
                    <input type="text" placeholder="F.eks. Vaktmester" value={contact.role} onChange={e => updateContact(contact.id, "role", e.target.value)} className="w-full border border-gray-300 p-2 rounded text-sm text-gray-900 bg-white font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Telefon</label>
                    <input type="text" value={contact.phone} onChange={e => updateContact(contact.id, "phone", e.target.value)} className="w-full border border-gray-300 p-2 rounded text-sm text-gray-900 bg-white font-medium" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">E-post</label>
                    <input type="email" value={contact.email} onChange={e => updateContact(contact.id, "email", e.target.value)} className="w-full border border-gray-300 p-2 rounded text-sm text-gray-900 bg-white font-medium" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LAGRE-KNAPPER */}
      <div className="flex gap-3 justify-end pt-4">
        <Link href={`/kunder/${customer.id}`} className="px-6 py-3 rounded-xl font-bold text-gray-700 bg-gray-200 hover:bg-gray-300 transition">
          Avbryt
        </Link>
        <button type="submit" className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 shadow-sm transition">
          Lagre endringer
        </button>
      </div>

    </form>
  );
}
