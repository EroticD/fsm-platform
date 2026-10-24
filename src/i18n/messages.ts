import commonNb from "../../messages/nb.json";
import commonEn from "../../messages/en.json";

import authNb from "../../messages/fragments/auth.nb.json";
import authEn from "../../messages/fragments/auth.en.json";
import componentsNb from "../../messages/fragments/components.nb.json";
import componentsEn from "../../messages/fragments/components.en.json";
import ordersNb from "../../messages/fragments/orders.nb.json";
import ordersEn from "../../messages/fragments/orders.en.json";
import customersNb from "../../messages/fragments/customers.nb.json";
import customersEn from "../../messages/fragments/customers.en.json";
import documentsNb from "../../messages/fragments/documents.nb.json";
import documentsEn from "../../messages/fragments/documents.en.json";
import settingsNb from "../../messages/fragments/settings.nb.json";
import settingsEn from "../../messages/fragments/settings.en.json";
import calendarNb from "../../messages/fragments/calendar.nb.json";
import calendarEn from "../../messages/fragments/calendar.en.json";
import portalNb from "../../messages/fragments/portal.nb.json";
import portalEn from "../../messages/fragments/portal.en.json";
import dashboardNb from "../../messages/fragments/dashboard.nb.json";
import dashboardEn from "../../messages/fragments/dashboard.en.json";
import equipmentNb from "../../messages/fragments/equipment.nb.json";
import equipmentEn from "../../messages/fragments/equipment.en.json";
import errorsNb from "../../messages/fragments/errors.nb.json";
import p3Nb from "../../messages/fragments/p3.nb.json";
import errorsEn from "../../messages/fragments/errors.en.json";
import p3En from "../../messages/fragments/p3.en.json";

type Messages = Record<string, unknown>;

function merge(base: Messages, extra: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = result[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      result[key] = merge(existing as Messages, value as Messages);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function mergeAll(fragments: Messages[]): Messages {
  return fragments.reduce((acc, fragment) => merge(acc, fragment), {});
}

const nbFragments = mergeAll([
  authNb,
  componentsNb,
  ordersNb,
  customersNb,
  documentsNb,
  settingsNb,
  calendarNb,
  portalNb,
  dashboardNb,
  equipmentNb,
  errorsNb,
  p3Nb,
]);

const enFragments = mergeAll([
  authEn,
  componentsEn,
  ordersEn,
  customersEn,
  documentsEn,
  settingsEn,
  calendarEn,
  portalEn,
  dashboardEn,
  equipmentEn,
  errorsEn,
  p3En,
]);

/**
 * Alle oversettelser ligger under `common`-navnerommet. Områdefilene i
 * `messages/fragments/` flettes inn her, slik at flere arbeidsstrømmer kan
 * oversette hver sin del uten å redigere samme JSON-fil.
 */
export const messages = {
  nb: { common: merge(commonNb.common, nbFragments) },
  en: { common: merge(commonEn.common, enFragments) },
};
