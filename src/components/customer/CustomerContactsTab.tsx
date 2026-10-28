import ContactCard from "@/components/ContactCard";
import { getTranslations } from "next-intl/server";
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

export default async function CustomerContactsTab({
  customerId,
  contacts,
  office,
  isAdmin,
  addContact,
  updateContact,
  deleteContact,
}: ContactsTabProps) {
  const t = await getTranslations("common");

  return (
    <CustomerTabPanel
      title={`👤 ${t("customers.contacts.title")}`}
      description={t("customers.contacts.description")}
    >
      {/* Skjema for ny kontaktperson – kun kontor/admin */}
      {office && (
        <form action={addContact} className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="contact-name" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.contacts.name")} *</label>
              <input id="contact-name" type="text" name="name" required placeholder={t("customers.contacts.namePlaceholder")} className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
            <div>
              <label htmlFor="contact-role" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.contacts.role")}</label>
              <input id="contact-role" type="text" name="role" placeholder={t("customers.contacts.rolePlaceholder")} className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="contact-email" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.contacts.email")}</label>
              <input id="contact-email" type="email" name="email" placeholder={t("customers.contacts.emailPlaceholder")} className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
            <div>
              <label htmlFor="contact-phone" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.contacts.phone")}</label>
              <input id="contact-phone" type="tel" name="phone" placeholder="+47 900 00 000" className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
            </div>
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm whitespace-nowrap">
            {t("customers.contacts.add")}
          </button>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{t("customers.contacts.empty")}</p>
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
