import ContactCard from "@/components/ContactCard";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";

type ContactsTabProps = {
  customerId: string;
  contacts: CustomerDetailData["customer"]["contacts"];
  office: boolean;
  isAdmin: boolean;
  addContact: (formData: FormData) => Promise<void>;
  updateContact: (formData: FormData) => Promise<void>;
  deleteContact: (formData: FormData) => Promise<void>;
};

export default function CustomerContactsTab({
  customerId,
  contacts,
  office,
  isAdmin,
  addContact,
  updateContact,
  deleteContact,
}: ContactsTabProps) {
  return (
    <CustomerTabPanel
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

      {contacts.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Ingen registrerte kontaktpersoner.</p>
      ) : (
        <div className="space-y-4">
          {contacts.map((c) => (
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
    </CustomerTabPanel>
  );
}
