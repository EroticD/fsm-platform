import InviteActionForm from "@/components/InviteActionForm";
import Icon from "@/components/icons";
import { getTranslations } from "next-intl/server";
import type { CustomerDetailData } from "@/server/customers";
import type { InviteActionState } from "@/lib/invite-action-state";
import CustomerTabPanel from "./CustomerTabPanel";

type PortalTabProps = {
  customerId: string;
  contacts: CustomerDetailData["customer"]["contacts"];
  portalUsers: CustomerDetailData["portalUsers"];
  office: boolean;
  portalError: string | null;
  createPortalUser: (
    state: InviteActionState,
    formData: FormData,
  ) => Promise<InviteActionState>;
  setPortalUserActive: (formData: FormData) => Promise<void>;
  resendPortalInvite: (
    state: InviteActionState,
    formData: FormData,
  ) => Promise<InviteActionState>;
};

export default async function CustomerPortalTab({
  customerId,
  contacts,
  portalUsers,
  office,
  portalError,
  createPortalUser,
  setPortalUserActive,
  resendPortalInvite,
}: PortalTabProps) {
  const t = await getTranslations("common");
  const inviteLabels = {
    ready: t("customers.portal.inviteReady", { name: "{name}" }),
    sent: t("customers.portal.inviteSent"),
    manual: t("customers.portal.inviteManual"),
    copy: t("customers.portal.copyLink"),
    error: t("customers.portal.inviteFailed"),
  };

  if (!office) return null;

  return (
    <CustomerTabPanel
      title={
        <>
          <Icon name="shield" className="mr-1.5 inline-block h-4 w-4 align-[-0.125em]" />
          {t("customers.portal.title")}
        </>
      }
      description={t("customers.portal.description")}
    >
      {portalError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl text-xs font-bold">
          {portalError}
        </div>
      )}

      {contacts.length === 0 ? (
        <p className="text-xs text-gray-500 italic bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3">
          {t("customers.portal.addContactFirst")}
        </p>
      ) : (
        <InviteActionForm
          action={createPortalUser}
          formClassName="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200"
          submitLabel={t("customers.portal.createAndInvite")}
          buttonClassName="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm"
          labels={inviteLabels}
        >
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="portal-user-name" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.portal.name")} *</label>
              <input
                id="portal-user-name"
                type="text"
                name="name"
                required
                placeholder={t("customers.portal.namePlaceholder")}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div>
              <label htmlFor="portal-user-email" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.portal.email")} *</label>
              <input
                id="portal-user-email"
                type="email"
                name="email"
                required
                placeholder={t("customers.portal.emailPlaceholder")}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
          </div>
          <div>
            <label htmlFor="portal-user-contact" className="block text-xs font-bold text-gray-700 mb-1">{t("customers.portal.contact")} *</label>
            <select
              id="portal-user-contact"
              name="contactId"
              required
              defaultValue=""
              className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
            >
              <option value="">{t("customers.portal.chooseContact")}</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.role ? ` (${contact.role})` : ""}
                </option>
              ))}
            </select>
          </div>
        </InviteActionForm>
      )}

      {portalUsers.length > 0 && (
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
          {portalUsers.map((u) => {
            const hasPendingInvite =
              !!u.resetToken && !!u.resetTokenExpiry && u.resetTokenExpiry > new Date();
            return (
              <div
                key={u.id}
                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50"
              >
                <div>
                  <p className="text-sm font-bold text-gray-900">{u.name || t("customers.portal.noName")}</p>
                  <p className="text-xs text-gray-500">
                    {u.email}
                    {u.contact ? ` • ${u.contact.name}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${
                        u.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {u.isActive
                        ? t("customers.portal.active")
                        : t("customers.portal.inactive")}
                    </span>
                    {!u.password && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full uppercase bg-gray-200 text-gray-600">
                        {t("customers.portal.missingPassword")}
                      </span>
                    )}
                    {hasPendingInvite && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-800">
                        {t("customers.portal.invited")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <InviteActionForm
                    action={resendPortalInvite}
                    wrapperClassName="contents"
                    submitLabel={
                      <>
                        <Icon name="route" className="h-3.5 w-3.5 shrink-0" />
                        {t("customers.portal.newLink")}
                      </>
                    }
                    buttonClassName="inline-flex items-center gap-1.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition"
                    bannerClassName="w-full rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-900"
                    labels={inviteLabels}
                  >
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="id" value={u.id} />
                  </InviteActionForm>
                  <form action={setPortalUserActive}>
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="active" value={u.isActive ? "false" : "true"} />
                    <button
                      type="submit"
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                        u.isActive
                          ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                          : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                      }`}
                    >
                      {u.isActive
                        ? t("customers.portal.deactivate")
                        : t("customers.portal.activate")}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CustomerTabPanel>
  );
}
