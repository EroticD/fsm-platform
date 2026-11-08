import type { ModuleKey } from "@/lib/modules";

export type SettingsTabKey =
  | "branding"
  | "kart"
  | "ansatte"
  | "kompetanse"
  | "maler"
  | "tags"
  | "utstyr"
  | "auditlog"
  | "bevis"
  | "statistikk"
  | "sla"
  | "sms"
  | "email"
  | "push"
  | "dispatch"
  | "roller"
  | "avdelinger"
  | "api"
  | "sso"
  | "sikkerhet"
  | "kundeoverforing"
  | "moduler";

export type SettingsTabPermissions = {
  canBranding: boolean;
  canMap: boolean;
  canUsers: boolean;
  canWorkforce: boolean;
  canTemplates: boolean;
  canDocuments: boolean;
  canEquipment: boolean;
  canAudit: boolean;
  canStats: boolean;
  canSla: boolean;
  canSms: boolean;
  canDispatch: boolean;
  isAdmin: boolean;
  canCustomerTransfer: boolean;
};

/** Fanene i den rekkefølgen de vises, med sikkerhet alltid tilgjengelig. */
const TAB_ORDER: SettingsTabKey[] = [
  "branding",
  "kart",
  "ansatte",
  "kompetanse",
  "maler",
  "tags",
  "utstyr",
  "auditlog",
  "bevis",
  "statistikk",
  "sla",
  "sms",
  "email",
  "push",
  "dispatch",
  "roller",
  "avdelinger",
  "api",
  "sso",
  "sikkerhet",
  "kundeoverforing",
  "moduler",
];

/**
 * Modulene en fane hører til. Tom liste betyr kjernedata som alltid er
 * tilgjengelig. `tags` vises hvis minst én av reports/documents er på.
 */
const TAB_MODULES: Partial<Record<SettingsTabKey, readonly ModuleKey[]>> = {
  kart: ["map"],
  maler: ["reports"],
  tags: ["reports", "documents"],
  utstyr: ["equipment"],
  bevis: ["auditExport"],
  statistikk: ["reports"],
  sla: ["contracts"],
  sms: ["sms"],
  dispatch: ["calendar"],
  api: ["api"],
  sso: ["sso"],
  kundeoverforing: ["transfer"],
};

function hasAnyModule(
  required: readonly ModuleKey[] | undefined,
  enabled: ReadonlySet<ModuleKey> | readonly ModuleKey[] | undefined,
): boolean {
  if (!required || required.length === 0) return true;
  // Eldre kall (og tester) som ikke kjenner modultilstand skal se alle faner.
  if (enabled === undefined) return true;
  const set = enabled instanceof Set ? enabled : new Set(enabled);
  return required.some((key) => key === "core" || set.has(key));
}

/** Er modulen/fanens datagrunnlag slått på? */
export function isSettingsTabModuleEnabled(
  tab: SettingsTabKey,
  enabledModules?: ReadonlySet<ModuleKey> | readonly ModuleKey[],
): boolean {
  return hasAnyModule(TAB_MODULES[tab], enabledModules);
}

export function isSettingsTabAllowed(
  tab: SettingsTabKey,
  permissions: SettingsTabPermissions,
  enabledModules?: ReadonlySet<ModuleKey> | readonly ModuleKey[],
): boolean {
  if (!isSettingsTabModuleEnabled(tab, enabledModules)) return false;
  switch (tab) {
    case "branding":
      return permissions.canBranding;
    case "kart":
      return permissions.canMap;
    case "ansatte":
      return permissions.canUsers;
    case "kompetanse":
      return permissions.canWorkforce;
    case "maler":
      return permissions.canTemplates;
    case "tags":
      return permissions.canTemplates || permissions.canDocuments;
    case "utstyr":
      return permissions.canEquipment;
    case "auditlog":
      return permissions.canAudit;
    case "bevis":
      return permissions.isAdmin;
    case "statistikk":
      return permissions.canStats;
    case "sla":
      return permissions.canSla;
    case "sms":
      return permissions.canSms;
    case "email":
    case "push":
      return permissions.isAdmin;
    case "dispatch":
      return permissions.canDispatch;
    case "roller":
    case "avdelinger":
    case "api":
    case "sso":
      return permissions.isAdmin;
    case "sikkerhet":
      return true;
    case "kundeoverforing":
      return permissions.canCustomerTransfer;
    case "moduler":
      return permissions.isAdmin;
  }
}

/**
 * Velger fanen som faktisk skal vises. En direkte lenke til en fane brukeren
 * ikke har tilgang til skal aldri gi en tom side – vi faller tilbake til første
 * tillatte fane i stedet.
 */
export function chooseSettingsTab(
  requested: string | undefined,
  permissions: SettingsTabPermissions,
  enabledModules?: ReadonlySet<ModuleKey> | readonly ModuleKey[],
): SettingsTabKey {
  if (
    requested &&
    TAB_ORDER.includes(requested as SettingsTabKey) &&
    isSettingsTabAllowed(requested as SettingsTabKey, permissions, enabledModules)
  ) {
    return requested as SettingsTabKey;
  }

  return (
    TAB_ORDER.find((tab) =>
      isSettingsTabAllowed(tab, permissions, enabledModules),
    ) ?? "sikkerhet"
  );
}
