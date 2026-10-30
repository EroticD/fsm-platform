import Icon from "@/components/icons";
import { getTranslations } from "next-intl/server";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";
import CustomerContactCard from "./CustomerContactCard";
import {
  CUSTOMER_CONTROL,
  CUSTOMER_INSET,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_SIGNAL_BUTTON,
} from "./customerStyles";

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
      title={
        <>
          <Icon name="user" className="h-4 w-4 shrink-0" />
          {t("customers.contacts.title")}
        </>
      }
      description={t("customers.contacts.description")}
    >
      {/* Skjema for ny kontaktperson – kun kontor/admin */}
      {office && (
        <form
          action={addContact}
          className={`${CUSTOMER_INSET} space-y-3 p-3 sm:p-4`}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-name" className={CUSTOMER_LABEL}>
                {t("customers.contacts.name")} *
              </label>
              <input
                id="contact-name"
                type="text"
                name="name"
                required
                placeholder={t("customers.contacts.namePlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="contact-role" className={CUSTOMER_LABEL}>
                {t("customers.contacts.role")}
              </label>
              <input
                id="contact-role"
                type="text"
                name="role"
                placeholder={t("customers.contacts.rolePlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-email" className={CUSTOMER_LABEL}>
                {t("customers.contacts.email")}
              </label>
              <input
                id="contact-email"
                type="email"
                name="email"
                placeholder={t("customers.contacts.emailPlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="contact-phone" className={CUSTOMER_LABEL}>
                {t("customers.contacts.phone")}
              </label>
              <input
                id="contact-phone"
                type="tel"
                name="phone"
                placeholder="+47 900 00 000"
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <button type="submit" className={`${CUSTOMER_SIGNAL_BUTTON} w-full`}>
            {t("customers.contacts.add")}
          </button>
        </form>
      )}

      {contacts.length === 0 ? (
        <p className={`text-xs italic ${CUSTOMER_MUTED}`}>
          {t("customers.contacts.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {contacts.map((contact) => (
            <CustomerContactCard
              key={contact.id}
              contact={contact}
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
