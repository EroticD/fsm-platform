import commonNb from "../../messages/nb.json";
import commonEn from "../../messages/en.json";
import commonPl from "../../messages/pl.json";
import commonDe from "../../messages/de.json";

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
import portalExpansionNb from "../../messages/fragments/portal-expansion.nb.json";
import portalExpansionEn from "../../messages/fragments/portal-expansion.en.json";
import portalExpansionPl from "../../messages/fragments/portal-expansion.pl.json";
import portalExpansionDe from "../../messages/fragments/portal-expansion.de.json";
import dashboardNb from "../../messages/fragments/dashboard.nb.json";
import dashboardEn from "../../messages/fragments/dashboard.en.json";
import equipmentNb from "../../messages/fragments/equipment.nb.json";
import equipmentEn from "../../messages/fragments/equipment.en.json";
import hmsNb from "../../messages/fragments/hms.nb.json";
import hmsEn from "../../messages/fragments/hms.en.json";
import errorsNb from "../../messages/fragments/errors.nb.json";
import p3Nb from "../../messages/fragments/p3.nb.json";
import errorsEn from "../../messages/fragments/errors.en.json";
import p3En from "../../messages/fragments/p3.en.json";
import searchAdminNb from "../../messages/fragments/search-admin.nb.json";
import searchAdminEn from "../../messages/fragments/search-admin.en.json";
import visitsNb from "../../messages/fragments/visits.nb.json";
import visitsEn from "../../messages/fragments/visits.en.json";
import p4Nb from "../../messages/fragments/p4.nb.json";
import p4En from "../../messages/fragments/p4.en.json";
import p4Pl from "../../messages/fragments/p4.pl.json";
import p4De from "../../messages/fragments/p4.de.json";
import dispatchNb from "../../messages/fragments/dispatch.nb.json";
import dispatchEn from "../../messages/fragments/dispatch.en.json";
import dispatchPl from "../../messages/fragments/dispatch.pl.json";
import dispatchDe from "../../messages/fragments/dispatch.de.json";
import bookingNb from "../../messages/fragments/booking.nb.json";
import bookingEn from "../../messages/fragments/booking.en.json";
import bookingPl from "../../messages/fragments/booking.pl.json";
import bookingDe from "../../messages/fragments/booking.de.json";
import trackingNb from "../../messages/fragments/tracking.nb.json";
import trackingEn from "../../messages/fragments/tracking.en.json";
import trackingPl from "../../messages/fragments/tracking.pl.json";
import trackingDe from "../../messages/fragments/tracking.de.json";
import smsNb from "../../messages/fragments/sms.nb.json";
import smsEn from "../../messages/fragments/sms.en.json";
import smsPl from "../../messages/fragments/sms.pl.json";
import smsDe from "../../messages/fragments/sms.de.json";
import reviewsNb from "../../messages/fragments/reviews.nb.json";
import reviewsEn from "../../messages/fragments/reviews.en.json";
import reviewsPl from "../../messages/fragments/reviews.pl.json";
import reviewsDe from "../../messages/fragments/reviews.de.json";
import offlineLockNb from "../../messages/fragments/offline-lock.nb.json";
import offlineLockEn from "../../messages/fragments/offline-lock.en.json";
import offlineLockPl from "../../messages/fragments/offline-lock.pl.json";
import offlineLockDe from "../../messages/fragments/offline-lock.de.json";
import workforceNb from "../../messages/fragments/workforce.nb.json";
import workforceEn from "../../messages/fragments/workforce.en.json";
import workforcePl from "../../messages/fragments/workforce.pl.json";
import workforceDe from "../../messages/fragments/workforce.de.json";
import customerTransferNb from "../../messages/fragments/customer-transfer.nb.json";
import customerTransferEn from "../../messages/fragments/customer-transfer.en.json";
import customerTransferPl from "../../messages/fragments/customer-transfer.pl.json";
import customerTransferDe from "../../messages/fragments/customer-transfer.de.json";
import fieldAppNb from "../../messages/fragments/field-app.nb.json";
import fieldAppEn from "../../messages/fragments/field-app.en.json";
import fieldAppPl from "../../messages/fragments/field-app.pl.json";
import fieldAppDe from "../../messages/fragments/field-app.de.json";

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
  portalExpansionNb,
  dashboardNb,
  equipmentNb,
  hmsNb,
  errorsNb,
  p3Nb,
  searchAdminNb,
  visitsNb,
  p4Nb,
  dispatchNb,
  bookingNb,
  trackingNb,
  smsNb,
  reviewsNb,
  offlineLockNb,
  workforceNb,
  customerTransferNb,
  fieldAppNb,
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
  portalExpansionEn,
  dashboardEn,
  equipmentEn,
  hmsEn,
  errorsEn,
  p3En,
  searchAdminEn,
  visitsEn,
  p4En,
  dispatchEn,
  bookingEn,
  trackingEn,
  smsEn,
  reviewsEn,
  offlineLockEn,
  workforceEn,
  customerTransferEn,
  fieldAppEn,
]);

/**
 * Alle oversettelser ligger under `common`-navnerommet. Områdefilene i
 * `messages/fragments/` flettes inn her, slik at flere arbeidsstrømmer kan
 * oversette hver sin del uten å redigere samme JSON-fil.
 */
const plFragments = mergeAll([
  p4Pl,
  dispatchPl,
  bookingPl,
  trackingPl,
  smsPl,
  portalExpansionPl,
  reviewsPl,
  offlineLockPl,
  workforcePl,
  customerTransferPl,
  fieldAppPl,
]);
const deFragments = mergeAll([
  p4De,
  dispatchDe,
  bookingDe,
  trackingDe,
  smsDe,
  portalExpansionDe,
  reviewsDe,
  offlineLockDe,
  workforceDe,
  customerTransferDe,
  fieldAppDe,
]);

export const messages = {
  nb: { common: merge(commonNb.common, nbFragments) },
  en: { common: merge(commonEn.common, enFragments) },
  pl: { common: merge(commonPl.common, plFragments) },
  de: { common: merge(commonDe.common, deFragments) },
};
