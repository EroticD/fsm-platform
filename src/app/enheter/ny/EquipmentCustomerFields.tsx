"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import CustomerSiteSelect, {
  type CustomerSiteOption,
} from "@/components/CustomerSiteSelect";
import CustomerEquipmentSelect, {
  type CustomerEquipmentOption,
} from "@/components/CustomerEquipmentSelect";

type CustomerOption = { id: string; name: string };

const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";

/**
 * Kunde, sted og overordnet enhet i nytt utstyrs-skjema.
 *
 * Kunden velges først. Steder og enheter hentes deretter fra kundens egne,
 * serveravgrensede endepunkter, slik at skjemaet aldri inneholder en annen
 * kundes rader.
 */
export default function EquipmentCustomerFields({
  customers,
  initialCustomerId = "",
  initialSites = [],
  initialSiteId = null,
  initialEquipment = [],
  initialEquipmentId = null,
  excludeEquipmentId = null,
}: {
  customers: CustomerOption[];
  initialCustomerId?: string;
  initialSites?: CustomerSiteOption[];
  initialSiteId?: string | null;
  initialEquipment?: CustomerEquipmentOption[];
  initialEquipmentId?: string | null;
  excludeEquipmentId?: string | null;
}) {
  const t = useTranslations("common");
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const initialForSelection = Boolean(initialCustomerId) && customerId === initialCustomerId;

  return (
    <>
      <div>
        <label htmlFor="customerId" className={LABEL}>
          {t("assets.form.customer")} *
        </label>
        <select
          id="customerId"
          name="customerId"
          required
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          className={CONTROL}
        >
          <option value="">{t("assets.form.customer")}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </div>

      <CustomerSiteSelect
        key={`site-${customerId}`}
        customerId={customerId}
        initialSites={initialForSelection ? initialSites : []}
        initialSiteId={initialForSelection ? initialSiteId : null}
        id="siteId"
        label={t("assets.form.site")}
        noSiteLabel={t("assets.form.noSite")}
        className={CONTROL}
      />

      <CustomerEquipmentSelect
        key={`equipment-${customerId}`}
        customerId={customerId}
        initialEquipment={initialForSelection ? initialEquipment : []}
        initialEquipmentId={
          initialForSelection ? initialEquipmentId : null
        }
        excludeId={excludeEquipmentId}
        id="parentId"
        label={t("assets.form.parent")}
        noEquipmentLabel={t("assets.detail.noParent")}
        className={CONTROL}
      />
    </>
  );
}
