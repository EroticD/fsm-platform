export type SettingsTabKey =
  | "branding"
  | "kart"
  | "ansatte"
  | "maler"
  | "tags"
  | "auditlog"
  | "statistikk"
  | "roller"
  | "avdelinger"
  | "sikkerhet";

export type SettingsTabPermissions = {
  canBranding: boolean;
  canMap: boolean;
  canUsers: boolean;
  canTemplates: boolean;
  canDocuments: boolean;
  canAudit: boolean;
  canStats: boolean;
  isAdmin: boolean;
};

/** Fanene i den rekkefølgen de vises, med sikkerhet alltid tilgjengelig. */
const TAB_ORDER: SettingsTabKey[] = [
  "branding",
  "kart",
  "ansatte",
  "maler",
  "tags",
  "auditlog",
  "statistikk",
  "roller",
  "avdelinger",
  "sikkerhet",
];

export function isSettingsTabAllowed(
  tab: SettingsTabKey,
  permissions: SettingsTabPermissions,
): boolean {
  switch (tab) {
    case "branding":
      return permissions.canBranding;
    case "kart":
      return permissions.canMap;
    case "ansatte":
      return permissions.canUsers;
    case "maler":
      return permissions.canTemplates;
    case "tags":
      return permissions.canTemplates || permissions.canDocuments;
    case "auditlog":
      return permissions.canAudit;
    case "statistikk":
      return permissions.canStats;
    case "roller":
    case "avdelinger":
      return permissions.isAdmin;
    case "sikkerhet":
      return true;
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
): SettingsTabKey {
  if (
    requested &&
    TAB_ORDER.includes(requested as SettingsTabKey) &&
    isSettingsTabAllowed(requested as SettingsTabKey, permissions)
  ) {
    return requested as SettingsTabKey;
  }

  return (
    TAB_ORDER.find((tab) => isSettingsTabAllowed(tab, permissions)) ??
    "sikkerhet"
  );
}
