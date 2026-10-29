/**
 * Rettigheter og roller.
 *
 * Rettighetene ligger på rollen og kan redigeres av administrator. En enkelt
 * bruker kan i tillegg få en tilpasset rettighetsliste som overstyrer rollen.
 * Sletting er bevisst ikke en vanlig rettighet: bare administrator kan slette
 * kunder, oppdrag, filer og annet, uavhengig av hvilke rettigheter brukeren har.
 */
export const PERMISSION_KEYS = [
  "workorders.view",
  "workorders.create",
  "workorders.update",
  "workorders.edit",
  "workorders.assign",
  "workorders.delete",
  "customers.view",
  "customers.manage",
  "equipment.view",
  "equipment.manage",
  "reports.view",
  "reports.write",
  "reports.viewAllDepartments",
  "documents.view",
  "documents.manage",
  "templates.view",
  "templates.manage",
  "users.view",
  "users.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSION_KEYS)[number];

export type PermissionDefinition = {
  key: Permission;
  group: string;
  label: string;
  description: string;
  /** i18n-nøkkel for gruppen, f.eks. «settings.permissions.groups.workOrders». */
  groupKey: string;
  /** i18n-nøkkel for menneskelig etikett. */
  labelKey: string;
  /** i18n-nøkkel for beskrivelsen. */
  descriptionKey: string;
};

/** Norsk tekst er fallback når en komponent ikke har oversettelser tilgjengelig. */
const PERMISSION_GROUP_KEYS: Record<string, string> = {
  Oppdrag: "settings.permissions.groups.workOrders",
  "Kunder og utstyr": "settings.permissions.groups.customersEquipment",
  "Rapporter og dokumenter": "settings.permissions.groups.reportsDocuments",
  Administrasjon: "settings.permissions.groups.administration",
};

function permissionMessageKey(key: Permission): string {
  return `settings.permissions.items.${key.replace(/\./g, "_")}`;
}

function withMessageKeys(definition: Omit<PermissionDefinition, "groupKey" | "labelKey" | "descriptionKey">): PermissionDefinition {
  const messageKey = permissionMessageKey(definition.key);
  return {
    ...definition,
    groupKey:
      PERMISSION_GROUP_KEYS[definition.group] ??
      "settings.permissions.groups.administration",
    labelKey: `${messageKey}.label`,
    descriptionKey: `${messageKey}.description`,
  };
}

const PERMISSION_DEFINITIONS: Omit<
  PermissionDefinition,
  "groupKey" | "labelKey" | "descriptionKey"
>[] = [
  {
    key: "workorders.view",
    group: "Oppdrag",
    label: "Se oppdrag",
    description: "Se oppdrag som tilhører egen avdeling.",
  },
  {
    key: "workorders.create",
    group: "Oppdrag",
    label: "Opprette oppdrag",
    description: "Opprette nye oppdrag i egen avdeling.",
  },
  {
    key: "workorders.update",
    group: "Oppdrag",
    label: "Oppdatere oppdrag",
    description: "Endre status, kommentarer, vedlegg og sjekklister på oppdrag i egen avdeling.",
  },
  {
    key: "workorders.edit",
    group: "Oppdrag",
    label: "Redigere oppdrag",
    description: "Endre tittel, kunde, dato, kontaktperson, tags, maler og kansellere oppdrag.",
  },
  {
    key: "workorders.assign",
    group: "Oppdrag",
    label: "Tildele montører",
    description: "Tildele og fjerne montører på oppdrag i egen avdeling.",
  },
  {
    key: "workorders.delete",
    group: "Oppdrag",
    label: "Slette oppdrag",
    description: "Slette oppdrag og alt tilhørende (rapporter, kommentarer, vedlegg). Forbeholdt administrator som standard.",
  },
  {
    key: "customers.view",
    group: "Kunder og utstyr",
    label: "Se kunder",
    description: "Se kundekort, kontakter, avtaler og kundehistorikk.",
  },
  {
    key: "customers.manage",
    group: "Kunder og utstyr",
    label: "Administrere kunder",
    description: "Opprette og endre kunder, kontakter, serviceavtaler og kundeportalbrukere.",
  },
  {
    key: "equipment.view",
    group: "Kunder og utstyr",
    label: "Se enheter",
    description: "Se utstyr og servicehistorikk.",
  },
  {
    key: "equipment.manage",
    group: "Kunder og utstyr",
    label: "Administrere enheter",
    description: "Legge til og endre utstyr på kundekort.",
  },
  {
    key: "reports.view",
    group: "Rapporter og dokumenter",
    label: "Se rapporter",
    description: "Se og laste ned servicerapporter fra egen avdeling.",
  },
  {
    key: "reports.write",
    group: "Rapporter og dokumenter",
    label: "Fylle ut rapporter",
    description: "Fylle ut og lagre sjekklister på oppdrag i egen avdeling.",
  },
  {
    key: "reports.viewAllDepartments",
    group: "Rapporter og dokumenter",
    label: "Se rapporter fra alle avdelinger",
    description:
      "Se og laste ned rapporter fra andre avdelinger enn egen. Administrator har alltid denne tilgangen.",
  },
  {
    key: "documents.view",
    group: "Rapporter og dokumenter",
    label: "Se dokumenter",
    description: "Bruke dokumentbiblioteket og se genererte dokumenter.",
  },
  {
    key: "documents.manage",
    group: "Rapporter og dokumenter",
    label: "Administrere dokumenter",
    description: "Laste opp, redigere og organisere dokumenter og mapper.",
  },
  {
    key: "templates.view",
    group: "Administrasjon",
    label: "Se sjekklister",
    description: "Se tilgjengelige sjekklister og maler.",
  },
  {
    key: "templates.manage",
    group: "Administrasjon",
    label: "Administrere sjekklister",
    description: "Opprette og redigere sjekklister, maler og tags.",
  },
  {
    key: "users.view",
    group: "Administrasjon",
    label: "Se ansatte",
    description: "Se ansatte, roller og avdelingstilhørighet i egen avdeling.",
  },
  {
    key: "users.manage",
    group: "Administrasjon",
    label: "Administrere ansatte",
    description: "Opprette brukere, endre roller og sende invitasjoner i egen avdeling. Bare administrator kan flytte ansatte mellom avdelinger.",
  },
  {
    key: "settings.manage",
    group: "Administrasjon",
    label: "Administrere innstillinger",
    description: "Endre merkevare og systeminnstillinger.",
  },
  {
    key: "audit.view",
    group: "Administrasjon",
    label: "Se aktivitetslogg",
    description: "Se systemets aktivitetslogg.",
  },
];

export const PERMISSIONS: PermissionDefinition[] =
  PERMISSION_DEFINITIONS.map(withMessageKeys);

const ALL_PERMISSIONS: Permission[] = PERMISSION_KEYS.slice();

const OFFICE_PERMISSIONS: Permission[] = [
  "workorders.view",
  "workorders.create",
  "workorders.update",
  "workorders.edit",
  "workorders.assign",
  "customers.view",
  "customers.manage",
  "equipment.view",
  "equipment.manage",
  "reports.view",
  "reports.write",
  "documents.view",
  "documents.manage",
  "templates.view",
  "templates.manage",
  "users.view",
  "users.manage",
  "settings.manage",
];

const TECHNICIAN_PERMISSIONS: Permission[] = [
  "workorders.view",
  "workorders.create",
  "workorders.update",
  "customers.view",
  "equipment.view",
  "reports.view",
  "reports.write",
  "documents.view",
  "templates.view",
];

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  OFFICE: OFFICE_PERMISSIONS,
  TECHNICIAN: TECHNICIAN_PERMISSIONS,
  USER: [],
  CUSTOMER: [],
};

/**
 * i18n-nøkler for de innebygde rollene. Roller som er opprettet av
 * administrator har egne, lagrede etiketter og skal ikke oversettes her.
 */
export const ROLE_LABEL_KEYS: Record<string, string> = {
  ADMIN: "settings.roles.builtIn.admin",
  OFFICE: "settings.roles.builtIn.office",
  TECHNICIAN: "settings.roles.builtIn.technician",
  CUSTOMER: "settings.roles.builtIn.customer",
  USER: "settings.roles.builtIn.user",
};

/** Norsk standardetikett for en innebygd rolle. */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  OFFICE: "Kontor",
  TECHNICIAN: "Montør",
  CUSTOMER: "Kunde",
  USER: "Bruker",
};

/** Oversatt etikett for en innebygd rolle, med norsk fallback. */
export function roleLabel(
  role: string | null | undefined,
  translate?: (key: string) => string,
): string {
  if (!role) return "";
  const key = ROLE_LABEL_KEYS[role];
  if (key && translate) return translate(key);
  return ROLE_LABELS[role] ?? role;
}

type PermissionUser = {
  role?: string | null;
  isActive?: boolean | null;
  permissions?: string[] | null;
  /** True når permissions skal overstyre rollen helt. */
  permissionsCustomized?: boolean | null;
  /** Rollen med rettighetene slik de er lagret i databasen. */
  roleDefinition?: { permissions?: string[] | null } | null;
};

/** Er verdien en kjent rettighet? Ukjente verdier ignoreres alltid. */
export function isPermission(value: string): value is Permission {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** Standardrettighetene som følger med den innebygde rollen. */
export function defaultPermissionsForRole(role?: string | null): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Rettighetene rollen gir, med fallback for eldre objekter uten rolle-data. */
function rolePermissions(user: PermissionUser): Permission[] {
  const configured = user.roleDefinition?.permissions;
  if (Array.isArray(configured)) {
    return configured.filter(isPermission);
  }
  return defaultPermissionsForRole(user.role);
}

/** Alle rettigheter brukeren faktisk har. Administrator har alltid alt. */
export function effectivePermissions(user?: PermissionUser | null): Set<Permission> {
  if (!user || !user.isActive) return new Set<Permission>();
  if (user.role === "ADMIN") return new Set(ALL_PERMISSIONS);

  const result = new Set<Permission>();
  if (user.permissionsCustomized === true) {
    for (const permission of user.permissions ?? []) {
      if (isPermission(permission)) result.add(permission);
    }
    return result;
  }

  for (const permission of rolePermissions(user)) {
    result.add(permission);
  }
  // Bakoverkompatibilitet: eldre kall kan sende permissions uten flagget.
  for (const permission of user.permissions ?? []) {
    if (isPermission(permission)) result.add(permission);
  }
  return result;
}

/**
 * Rettighetene brukeren er tildelt, uavhengig av om kontoen er aktiv.
 * Brukes når man skal vurdere om en aktør kan administrere en annen bruker:
 * en inaktiv konto skal ikke kunne brukes til å eskalere rettigheter.
 */
export function assignedPermissions(user?: PermissionUser | null): Set<Permission> {
  if (!user) return new Set<Permission>();
  if (user.role === "ADMIN") return new Set(ALL_PERMISSIONS);

  const result = new Set<Permission>();
  if (user.permissionsCustomized === true) {
    for (const permission of user.permissions ?? []) {
      if (isPermission(permission)) result.add(permission);
    }
    return result;
  }

  for (const permission of rolePermissions(user)) {
    result.add(permission);
  }
  for (const permission of user.permissions ?? []) {
    if (isPermission(permission)) result.add(permission);
  }
  return result;
}

/** Sjekker en enkelt rettighet. Administrator har alltid alt. */
export function hasPermission(
  user: PermissionUser | null | undefined,
  permission: Permission,
): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === "ADMIN") return true;
  return effectivePermissions(user).has(permission);
}

/** Rydder innsendte rettigheter til kjente verdier uten duplikater. */
export function cleanPermissions(values: string[]): Permission[] {
  return Array.from(new Set(values.filter(isPermission)));
}
