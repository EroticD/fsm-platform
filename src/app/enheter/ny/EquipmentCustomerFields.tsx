"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import CustomerSiteSelect, {
  type CustomerSiteOption,
} from "@/components/CustomerSiteSelect";
import CustomerEquipmentSelect, {
  type CustomerEquipmentOption,
} from "@/components/CustomerEquipmentSelect";
import { Field, Select } from "@/components/ui";
import { controlClassName } from "@/components/ui/controlStyles";

type CustomerOption = { id: string; name: string };

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
      <Field id="customerId" label={t("assets.form.customer")} required>
        <Select
          id="customerId"
          name="customerId"
          required
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
        >
          <option value="">{t("assets.form.customer")}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </Select>
      </Field>

      <CustomerSiteSelect
        key={`site-${customerId}`}
        customerId={customerId}
        initialSites={initialForSelection ? initialSites : []}
        initialSiteId={initialForSelection ? initialSiteId : null}
        id="siteId"
        label={t("assets.form.site")}
        noSiteLabel={t("assets.form.noSite")}
        className={controlClassName()}
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
        className={controlClassName()}
      />
    </>
  );
}
