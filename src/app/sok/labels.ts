import type { IconName } from "@/components/icons";
import { HMS_FORM_TYPES } from "@/lib/hms";
import { SEARCH_STATUS_VALUES } from "@/lib/search-filters";

/** Monokrome ikoner for gruppene i søkeresultatet. */
export const GROUP_ICONS: Record<string, IconName> = {
  customer: "building",
  workOrder: "clipboard",
  tag: "flag",
  unit: "wrench",
  contact: "user",
  report: "file",
  comment: "note",
  user: "users",
  template: "list",
  folder: "folder",
  document: "file",
};

/** Oversettelsesnøkler for gruppene i søkeresultatet. */
export const GROUP_KEYS: Record<string, string> = {
  customer: "components.search.groups.customer",
  workOrder: "components.search.groups.workOrder",
  tag: "components.search.groups.tag",
  unit: "components.search.groups.unit",
  contact: "components.search.groups.contact",
  report: "components.search.groups.report",
  comment: "components.search.groups.comment",
  user: "components.search.groups.user",
  template: "components.search.groups.template",
  folder: "components.search.groups.folder",
  document: "components.search.groups.document",
};

/** Gyldige arbeidsstatuser med stabil visningsrekkefølge. */
export const SEARCH_STATUS_OPTIONS = SEARCH_STATUS_VALUES.map((value) => ({
  value,
  labelKey: `components.search.statuses.${value}`,
}));

/** HMS-typer med stabil visningsrekkefølge (samme som backend). */
export const SEARCH_HMS_TYPE_OPTIONS = HMS_FORM_TYPES.map((value) => ({
  value,
  labelKey: `components.search.hmsTypes.${value}`,
}));
