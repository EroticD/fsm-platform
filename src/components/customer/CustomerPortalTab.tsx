import InviteActionForm from "@/components/InviteActionForm";
import Icon from "@/components/icons";
import { getTranslations } from "next-intl/server";
import type { CustomerDetailData } from "@/server/customers";
import type { InviteActionState } from "@/lib/invite-action-state";
import CustomerTabPanel from "./CustomerTabPanel";
import {
  CUSTOMER_CONTROL,
  CUSTOMER_INSET,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_SIGNAL_BUTTON,
} from "./customerStyles";

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
  savePortalDelegation: (formData: FormData) => Promise<void>;
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
  savePortalDelegation,
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
          <Icon name="shield" className="h-4 w-4 shrink-0" />
          {t("customers.portal.title")}
        </>
      }
      description={t("customers.portal.description")}
    >
      {portalError && (
        <div className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
          {portalError}
        </div>
      )}

      {contacts.length > 0 && (
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-black text-[var(--ink,#101310)]">
              {t("customers.portal.delegation.title")}
            </h3>
            <p className={`mt-1 text-xs leading-5 ${CUSTOMER_MUTED}`}>
              {t("customers.portal.delegation.description")}
            </p>
          </div>
          {contacts.map((contact) => {
            const delegation = contact.portalDelegation;
            const value = (flag: keyof NonNullable<typeof delegation>) =>
              delegation ? Boolean(delegation[flag]) : true;
            return (
              <form
                key={contact.id}
                action={savePortalDelegation}
                className={`${CUSTOMER_INSET} space-y-3 p-3`}
              >
                <input type="hidden" name="contactId" value={contact.id} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--ink,#101310)]">
                    {contact.name}
                    {contact.role ? (
                      <span className={`ml-1 text-xs font-normal ${CUSTOMER_MUTED}`}>
                        ({contact.role})
                      </span>
                    ) : null}
                  </p>
                  {!delegation && (
                    <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 py-0.5 text-xs font-bold text-[var(--muted,#62685f)]">
                      {t("customers.portal.delegation.fullAccessFallback")}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(
                    [
                      "isActive",
                      "canBook",
                      "canViewDocuments",
                      "canViewContracts",
                      "canViewEquipment",
                    ] as const
                  ).map((key) => (
                    <label
                      key={key}
                      className="flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 py-1.5 text-sm font-bold"
                    >
                      <input
                        type="checkbox"
                        name={key}
                        value="true"
                        defaultChecked={value(key)}
                        className="h-4 w-4 shrink-0 accent-[var(--ink,#101310)]"
                      />
                      {t(`customers.portal.delegation.${key}`)}
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  className={`${CUSTOMER_INK_BUTTON} w-full`}
                >
                  {t("customers.portal.delegation.save")}
                </button>
              </form>
            );
          })}
        </div>
      )}

      {contacts.length === 0 ? (
        <p
          className={`rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-xs italic ${CUSTOMER_MUTED}`}
        >
          {t("customers.portal.addContactFirst")}
        </p>
      ) : (
        <InviteActionForm
          action={createPortalUser}
          formClassName={`${CUSTOMER_INSET} space-y-3 p-3 sm:p-4`}
          submitLabel={t("customers.portal.createAndInvite")}
          buttonClassName={`${CUSTOMER_SIGNAL_BUTTON} w-full`}
          labels={inviteLabels}
        >
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="portal-user-name" className={CUSTOMER_LABEL}>
                {t("customers.portal.name")} *
              </label>
              <input
                id="portal-user-name"
                type="text"
                name="name"
                required
                placeholder={t("customers.portal.namePlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="portal-user-email" className={CUSTOMER_LABEL}>
                {t("customers.portal.email")} *
              </label>
              <input
                id="portal-user-email"
                type="email"
                name="email"
                required
                placeholder={t("customers.portal.emailPlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <div>
            <label htmlFor="portal-user-contact" className={CUSTOMER_LABEL}>
              {t("customers.portal.contact")} *
            </label>
            <select
              id="portal-user-contact"
              name="contactId"
              required
              defaultValue=""
              className={CUSTOMER_CONTROL}
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
        <div className="overflow-hidden rounded-xl border border-[var(--line,#dedcd1)]">
          {portalUsers.map((u) => {
            const hasPendingInvite =
              !!u.resetToken &&
              !!u.resetTokenExpiry &&
              u.resetTokenExpiry > new Date();
            return (
              <div
                key={u.id}
                className="flex flex-col justify-between gap-3 border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 last:border-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--ink,#101310)]">
                    {u.name || t("customers.portal.noName")}
                  </p>
                  <p className={`truncate text-xs ${CUSTOMER_MUTED}`}>
                    {u.email}
                    {u.contact ? ` • ${u.contact.name}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                        u.isActive
                          ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                          : "border-[#e4c98f] bg-[var(--warning-surface,#fdf5e4)] text-[#6b4808]"
                      }`}
                    >
                      {u.isActive
                        ? t("customers.portal.active")
                        : t("customers.portal.inactive")}
                    </span>
                    {!u.password && (
                      <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                        {t("customers.portal.missingPassword")}
                      </span>
                    )}
                    {hasPendingInvite && (
                      <span className="rounded-full border border-[var(--ink,#101310)] bg-[var(--surface,#fffdf8)] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[var(--ink,#101310)]">
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
                    buttonClassName={CUSTOMER_INK_BUTTON}
                    bannerClassName="w-full rounded-xl border border-[#b9cdb4] bg-[var(--success-surface,#eef7d6)] p-3 text-xs text-[var(--success-text,#283509)]"
                    labels={inviteLabels}
                  >
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="id" value={u.id} />
                  </InviteActionForm>
                  <form action={setPortalUserActive}>
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="id" value={u.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={u.isActive ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className={
                        u.isActive
                          ? CUSTOMER_INK_BUTTON
                          : CUSTOMER_SIGNAL_BUTTON
                      }
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
