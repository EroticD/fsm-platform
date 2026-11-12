import Icon from "@/components/icons";
import Link from "next/link";
import NavigateLink from "@/components/NavigateLink";
import CopyAddressButton from "@/components/CopyAddressButton";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { getTranslations } from "next-intl/server";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";
import SubUnitPicker from "./SubUnitPicker";
import {
  CUSTOMER_CONTROL,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_INSET,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_RISK_BUTTON,
  CUSTOMER_SIGNAL_BUTTON,
} from "./customerStyles";

type Site = CustomerDetailData["sites"][number];

type SitesTabProps = {
  sites: Site[];
  siteQuery: string;
  siteTotal: number;
  office: boolean;
  /** Kundens organisasjonsnummer, brukt til oppslag av underenheter. */
  orgNumber: string | null;
  createSite: (formData: FormData) => Promise<void>;
  updateSite: (formData: FormData) => Promise<void>;
  deleteSite: (formData: FormData) => Promise<void>;
  setPrimarySite: (formData: FormData) => Promise<void>;
};

/** Steder (anlegg) på kundekortet, med redigering, sletting og primærvalg. */
export default async function CustomerSitesTab({
  sites,
  siteQuery,
  siteTotal,
  office,
  orgNumber,
  createSite,
  updateSite,
  deleteSite,
  setPrimarySite,
}: SitesTabProps) {
  const t = await getTranslations("common");

  return (
    <CustomerTabPanel
      title={
        <>
          <Icon name="building" className="h-4 w-4 shrink-0" />
          {t("customers.sites.title")}
        </>
      }
      description={t("customers.sites.description")}
    >
      {/* Filtrering skjer på serveren, avgrenset til kundens egne steder. */}
      <form method="GET" action="" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value="mer" />
        <div className="relative min-w-[12rem] flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted,#62685f)]"
          />
          <input
            type="search"
            name="sted"
            defaultValue={siteQuery}
            maxLength={120}
            aria-label={t("customers.sites.searchLabel")}
            placeholder={t("customers.sites.searchPlaceholder")}
            className={`${CUSTOMER_CONTROL} pl-9 text-sm`}
          />
        </div>
        <button type="submit" className={CUSTOMER_INK_BUTTON}>
          {t("customers.sites.search")}
        </button>
        {siteQuery && (
          <Link href="?tab=mer" className={CUSTOMER_INK_BUTTON}>
            {t("customers.sites.resetSearch")}
          </Link>
        )}
        <span className={`text-xs font-bold ${CUSTOMER_MUTED}`}>
          {t("customers.sites.showing", {
            shown: sites.length,
            total: siteTotal,
          })}
        </span>
      </form>

      {office && (
        <form
          action={createSite}
          className={`${CUSTOMER_INSET} space-y-3 p-3 sm:p-4`}
        >
          {/* Underenhetene listes bare når vi har et org.nummer å slå opp. */}
          {orgNumber && <SubUnitPicker orgNumber={orgNumber} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="site-name" className={CUSTOMER_LABEL}>
                {t("customers.sites.name")} *
              </label>
              <input
                id="site-name"
                name="name"
                required
                maxLength={200}
                placeholder={t("customers.sites.namePlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="site-address" className={CUSTOMER_LABEL}>
                {t("customers.sites.address")}
              </label>
              <input
                id="site-address"
                name="address"
                maxLength={200}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="site-postal-code" className={CUSTOMER_LABEL}>
                {t("customers.sites.postalCode")}
              </label>
              <input
                id="site-postal-code"
                name="postalCode"
                maxLength={20}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="site-city" className={CUSTOMER_LABEL}>
                {t("customers.sites.city")}
              </label>
              <input
                id="site-city"
                name="city"
                maxLength={100}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              name="isPrimary"
              value="true"
              className="h-4 w-4 accent-[var(--ink,#101310)]"
            />
            {t("customers.sites.setPrimary")}
          </label>
          <button type="submit" className={`${CUSTOMER_SIGNAL_BUTTON} w-full`}>
            {t("customers.sites.add")}
          </button>
        </form>
      )}

      {sites.length === 0 ? (
        <p className={`text-xs italic ${CUSTOMER_MUTED}`}>
          {siteQuery
            ? t("customers.sites.noMatches", { query: siteQuery })
            : t("customers.sites.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {sites.map((site) => {
            const addressLine = [site.address, site.postalCode, site.city]
              .filter(Boolean)
              .join(", ");
            return (
              <div key={site.id} className={`${CUSTOMER_INSET} p-3 text-sm`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--ink,#101310)]">
                      {site.name}
                      {site.isPrimary && (
                        <span className="ml-2 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-2 py-0.5 text-xs font-bold">
                          {t("customers.sites.primary")}
                        </span>
                      )}
                    </p>
                    <p className={`text-xs ${CUSTOMER_MUTED}`}>
                      {addressLine || t("customers.sites.noAddress")}
                    </p>
                    {(addressLine || site.latitude != null) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <NavigateLink
                          latitude={site.latitude}
                          longitude={site.longitude}
                          address={site.address}
                          postalCode={site.postalCode}
                          city={site.city}
                          label={t("fieldTools.navigate")}
                          newTabLabel={t("fieldTools.newTab")}
                          className={`min-h-11 rounded-lg border border-[var(--line,#dedcd1)] bg-surface px-2.5 text-xs text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]`}
                        />
                        {addressLine && (
                          <CopyAddressButton
                            value={addressLine}
                            label={t("fieldTools.copyAddress")}
                            copiedLabel={t("fieldTools.copied")}
                            failedLabel={t("fieldTools.copyFailed")}
                            className="border-[var(--line,#dedcd1)] bg-surface text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {office && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {!site.isPrimary && (
                        <form action={setPrimarySite}>
                          <input type="hidden" name="id" value={site.id} />
                          <button type="submit" className={CUSTOMER_INK_BUTTON}>
                            {t("customers.sites.makePrimary")}
                          </button>
                        </form>
                      )}
                      <ConfirmSubmitForm
                        action={deleteSite}
                        confirmMessage={t("customers.sites.deleteConfirm", {
                          name: site.name,
                        })}
                        confirmLabel={t("delete")}
                        danger
                        className="inline-flex"
                      >
                        <input type="hidden" name="id" value={site.id} />
                        <button
                          type="submit"
                          aria-label={`${t("customers.sites.delete")}: ${site.name}`}
                          className={`${CUSTOMER_RISK_BUTTON} min-w-11 px-2`}
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </ConfirmSubmitForm>
                    </div>
                  )}
                </div>

                {office && (
                  <details className="mt-2 border-t border-[var(--line,#dedcd1)] pt-2">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em]">
                      <Icon name="edit" className="h-4 w-4" />
                      {t("customers.sites.edit")}
                    </summary>
                    <form action={updateSite} className="mt-2 space-y-3">
                      <input type="hidden" name="id" value={site.id} />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor={`site-${site.id}-name`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.sites.name")} *
                          </label>
                          <input
                            id={`site-${site.id}-name`}
                            name="name"
                            required
                            maxLength={200}
                            defaultValue={site.name}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`site-${site.id}-address`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.sites.address")}
                          </label>
                          <input
                            id={`site-${site.id}-address`}
                            name="address"
                            maxLength={200}
                            defaultValue={site.address ?? ""}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`site-${site.id}-postal`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.sites.postalCode")}
                          </label>
                          <input
                            id={`site-${site.id}-postal`}
                            name="postalCode"
                            maxLength={20}
                            defaultValue={site.postalCode ?? ""}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`site-${site.id}-city`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.sites.city")}
                          </label>
                          <input
                            id={`site-${site.id}-city`}
                            name="city"
                            maxLength={100}
                            defaultValue={site.city ?? ""}
                            className={CUSTOMER_CONTROL}
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        className={`${CUSTOMER_SIGNAL_BUTTON} w-full`}
                      >
                        {t("customers.sites.save")}
                      </button>
                    </form>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CustomerTabPanel>
  );
}
