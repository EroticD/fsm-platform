// i18n-ignore-file: katalogfeil er utviklerdiagnostikk, ikke UI-tekst.
/**
 * Modulkatalogen for den modulære monolitten.
 *
 * Kjernen (auth, brukere, avdelinger, kunder, oppdrag, arbeidsdager/tid,
 * revisjon og innstillinger) er alltid på. Resten er installasjonsnivåmoduler
 * som administrator kan slå av og på. Modulene fjerner aldri data: de stenger
 * bare navigasjon, sider, handlinger, API-er og arbeidsjobber.
 *
 * Katalogen er ren data uten databaseavhengigheter, slik at navigasjon,
 * innstillinger og tester kan filtrere uten å spørre databasen.
 */

export const MODULE_KEYS = [
  "core",
  "calendar",
  "reports",
  "equipment",
  "contracts",
  "portal",
  "booking",
  "documents",
  "sms",
  "map",
  "tracking",
  "reviews",
  "transfer",
  "auditExport",
  "api",
  "sso",
  "offline",
  // P2-moduler. De har ingen leverte sider ennå, men følger samme
  // av/på-rammeverk slik at nye produktmoduler ikke må hardkodes senere.
  "quotes",
  "invoicing",
  "inventory",
  "fieldExpenses",
  "bi",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleStatus = "active" | "planned";

export type ModuleDefinition = {
  key: ModuleKey;
  labelKey: string;
  descriptionKey: string;
  /** Moduler som må være på for at denne skal kunne slås på. */
  dependencies: readonly ModuleKey[];
  core: boolean;
  status: ModuleStatus;
  /** Stabile nøkler for dokumentasjon og testing. */
  nav: readonly string[];
  settingsTabs: readonly string[];
  routes: readonly string[];
  apiPrefixes: readonly string[];
  workers: readonly string[];
};

function item(key: ModuleKey) {
  return `settings.modules.items.${key}`;
}

function definition(
  key: ModuleKey,
  options: Omit<ModuleDefinition, "key" | "labelKey" | "descriptionKey">,
): ModuleDefinition {
  return {
    key,
    labelKey: `${item(key)}.label`,
    descriptionKey: `${item(key)}.description`,
    ...options,
  };
}

/**
 * Rekkefølgen er den samme i katalogen, innstillingene og dokumentasjonen.
 * Kjernen står først fordi den aldri kan slås av.
 */
export const MODULES: readonly ModuleDefinition[] = [
  definition("core", {
    dependencies: [],
    core: true,
    status: "active",
    nav: ["dashboard", "workOrders", "customers", "search", "notifications", "settings"],
    settingsTabs: [
      "branding",
      "ansatte",
      "kompetanse",
      "roller",
      "avdelinger",
      "auditlog",
      "sikkerhet",
    ],
    routes: ["/", "/oppdrag", "/kunder", "/mine-oppdrag", "/sok", "/varsler", "/innstillinger", "/brukere"],
    apiPrefixes: ["/api/search", "/api/oppdrag", "/api/kunder", "/api/notifications", "/api/branding"],
    workers: [
      "audit-retention",
      "search-log-cleanup",
      "work-order-retention",
      "notifications",
    ],
  }),
  definition("calendar", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["calendar"],
    settingsTabs: ["dispatch"],
    routes: [
      "/kalender",
      "/kalender/dispatch",
      "/kalender/rute",
      "/kalender/kapasitet",
      "/kalender/maned",
      "/kalender/uke",
      "/kalender/uke-2",
    ],
    apiPrefixes: ["/api/kalender"],
    workers: [],
  }),
  definition("reports", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["reports", "hms"],
    settingsTabs: ["maler", "tags", "statistikk"],
    routes: ["/rapporter", "/hms", "/innstillinger/maler"],
    apiPrefixes: ["/api/rapporter"],
    workers: [],
  }),
  definition("equipment", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["units", "scan"],
    settingsTabs: ["utstyr"],
    routes: ["/enheter", "/skann"],
    apiPrefixes: ["/api/enheter", "/api/kunder/enheter", "/api/v1/equipment", "/api/v1/maintenance-plans"],
    workers: [],
  }),
  definition("contracts", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["contracts"],
    settingsTabs: ["sla"],
    routes: ["/avtaler"],
    apiPrefixes: ["/api/avtaler", "/api/v1/contracts", "/api/v1/sla-policies"],
    workers: ["contract-lifecycle", "recurring-work-orders", "sla-sweep"],
  }),
  definition("portal", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["customerPortal"],
    settingsTabs: [],
    routes: ["/kundeportal"],
    apiPrefixes: ["/api/kundeportal"],
    workers: [],
  }),
  definition("booking", {
    dependencies: ["portal", "calendar"],
    core: false,
    status: "active",
    nav: ["bookings"],
    settingsTabs: [],
    routes: ["/bookinger"],
    apiPrefixes: [],
    workers: ["booking-holds"],
  }),
  definition("documents", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["documents"],
    settingsTabs: ["tags"],
    routes: ["/dokumenter"],
    apiPrefixes: ["/api/upload", "/api/v1/documents"],
    workers: ["pdf-text", "draft-cleanup"],
  }),
  definition("sms", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["sms"],
    settingsTabs: ["sms"],
    routes: ["/meldinger"],
    apiPrefixes: ["/api/webhooks/sms"],
    workers: ["sms-queue", "reminders"],
  }),
  definition("map", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["map"],
    settingsTabs: ["kart"],
    routes: ["/kart"],
    apiPrefixes: [],
    workers: [],
  }),
  definition("tracking", {
    dependencies: ["calendar"],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: [],
    routes: ["/sporing"],
    apiPrefixes: ["/api/tracking"],
    workers: ["location-ping-cleanup"],
  }),
  definition("reviews", {
    dependencies: [],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: [],
    routes: ["/anmeldelser", "/anmeldelse"],
    apiPrefixes: [],
    workers: [],
  }),
  definition("transfer", {
    dependencies: ["equipment", "documents"],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: ["kundeoverforing"],
    routes: [],
    apiPrefixes: ["/api/innstillinger/kunder"],
    workers: ["transfer-cleanup"],
  }),
  definition("auditExport", {
    dependencies: [],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: ["bevis"],
    routes: [],
    apiPrefixes: ["/api/innstillinger/audit/eksport", "/api/innstillinger/bevis"],
    workers: [],
  }),
  definition("api", {
    dependencies: [],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: ["api"],
    routes: [],
    apiPrefixes: ["/api/v1"],
    workers: [],
  }),
  definition("sso", {
    dependencies: [],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: ["sso"],
    routes: [],
    apiPrefixes: ["/api/scim"],
    workers: [],
  }),
  definition("offline", {
    dependencies: [],
    core: false,
    status: "active",
    nav: [],
    settingsTabs: [],
    routes: [],
    apiPrefixes: ["/api/offline"],
    workers: ["offline-draft-cleanup"],
  }),
  definition("quotes", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["quotes"],
    settingsTabs: [],
    routes: ["/tilbud"],
    apiPrefixes: ["/api/tilbud"],
    workers: [],
  }),
  definition("invoicing", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["invoices"],
    settingsTabs: [],
    routes: ["/faktura"],
    apiPrefixes: ["/api/faktura"],
    workers: ["billing-sweep"],
  }),
  definition("inventory", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["inventory"],
    settingsTabs: [],
    routes: ["/lager"],
    apiPrefixes: [],
    workers: [],
  }),
  definition("fieldExpenses", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["expenses"],
    settingsTabs: [],
    routes: ["/utlegg"],
    apiPrefixes: [],
    workers: [],
  }),
  definition("bi", {
    dependencies: [],
    core: false,
    status: "active",
    nav: ["profitability"],
    settingsTabs: [],
    routes: ["/lonnsomhet"],
    apiPrefixes: ["/api/lonnsomhet"],
    workers: [],
  }),
];

export const MODULE_BY_KEY: Readonly<Record<ModuleKey, ModuleDefinition>> =
  Object.fromEntries(MODULES.map((mod) => [mod.key, mod])) as Record<
    ModuleKey,
    ModuleDefinition
  >;

export const CORE_MODULE: ModuleKey = "core";

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

export function moduleDefinition(key: ModuleKey): ModuleDefinition {
  return MODULE_BY_KEY[key];
}

export function isCoreModule(key: ModuleKey): boolean {
  return MODULE_BY_KEY[key].core;
}

/** Alle aktive (leveringsklare) moduler, uten P2-plassholdere. */
export const ACTIVE_MODULE_KEYS: readonly ModuleKey[] = MODULES.filter(
  (mod) => mod.status === "active",
).map((mod) => mod.key);

export type ModulePreset = "core" | "full";

export const MODULE_PRESETS: Readonly<Record<ModulePreset, readonly ModuleKey[]>> = {
  core: ["core"],
  full: ACTIVE_MODULE_KEYS,
};

export function isModulePreset(value: string): value is ModulePreset {
  return value === "core" || value === "full";
}

/** Modulene som er på i en preset. Ukjente/nedlagte moduler er alltid av. */
export function moduleKeysForPreset(preset: ModulePreset): Set<ModuleKey> {
  const keys = new Set<ModuleKey>(MODULE_PRESETS[preset]);
  keys.add("core");
  return keys;
}

/** Leser `MODULE_PRESET` med `full` som bakoverkompatibel standard. */
export function modulePresetFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ModulePreset {
  const value = String(env.MODULE_PRESET ?? "").trim().toLowerCase();
  return isModulePreset(value) ? value : "full";
}

/** Alle moduler som er av i en gitt tilstand. Kjernen er alltid på. */
export function disabledModulesFor(
  states: Readonly<Record<string, boolean>>,
): ModuleKey[] {
  return MODULES.filter(
    (mod) => !mod.core && !(states[mod.key] ?? false),
  ).map((mod) => mod.key);
}

export function enabledModulesFor(
  states: Readonly<Record<string, boolean>>,
): ModuleKey[] {
  return MODULES.filter(
    (mod) => mod.core || (states[mod.key] ?? false),
  ).map((mod) => mod.key);
}

/** Er modulen på i en gitt tilstand? Kjernen er alltid på. */
export function moduleIsOn(
  states: Readonly<Record<string, boolean>>,
  key: ModuleKey,
): boolean {
  if (!MODULE_BY_KEY[key]) return false;
  if (MODULE_BY_KEY[key].core) return true;
  return states[key] ?? false;
}

/** Moduler som peker på `key` som avhengighet. */
export function dependentsOf(key: ModuleKey): ModuleKey[] {
  return MODULES.filter(
    (mod) => !mod.core && mod.dependencies.includes(key),
  ).map((mod) => mod.key);
}

/** Avhengighetene som mangler når `key` skal slås på. */
export function missingDependencies(
  key: ModuleKey,
  states: Readonly<Record<string, boolean>>,
): ModuleKey[] {
  return MODULE_BY_KEY[key].dependencies.filter(
    (dependency) => !moduleIsOn(states, dependency),
  );
}

/** Aktive moduler som blokkerer at `key` slås av. */
export function enabledDependents(
  key: ModuleKey,
  states: Readonly<Record<string, boolean>>,
): ModuleKey[] {
  return dependentsOf(key).filter((dependent) => moduleIsOn(states, dependent));
}

/**
 * Validerer katalogen: kjente avhengigheter, ingen selvreferanse og ingen
 * sirkler. Returnerer en liste med feil, slik at en test kan feile tydelig.
 */
export function validateModuleCatalog(): string[] {
  const errors: string[] = [];
  const keys = new Set<ModuleKey>();

  for (const mod of MODULES) {
    if (keys.has(mod.key)) errors.push(`duplikat modulnøkkel: ${mod.key}`);
    keys.add(mod.key);
    for (const dependency of mod.dependencies) {
      if (!MODULE_BY_KEY[dependency]) {
        errors.push(`${mod.key} avhenger av ukjent modul ${dependency}`);
      }
      if (dependency === mod.key) {
        errors.push(`${mod.key} kan ikke avhenge av seg selv`);
      }
    }
    if (mod.core && mod.dependencies.length > 0) {
      errors.push(`kjeremodulen ${mod.key} kan ikke ha avhengigheter`);
    }
  }

  // Syklusdeteksjon med DFS. Kjernen er alltid på, så den trenger ingen kant.
  const visiting = new Set<ModuleKey>();
  const visited = new Set<ModuleKey>();
  const visit = (key: ModuleKey, trail: ModuleKey[]) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      errors.push(`avhengighetssirkel: ${[...trail, key].join(" → ")}`);
      return;
    }
    visiting.add(key);
    for (const dependency of MODULE_BY_KEY[key]?.dependencies ?? []) {
      if (MODULE_BY_KEY[dependency]) visit(dependency, [...trail, key]);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const mod of MODULES) visit(mod.key, []);

  return [...new Set(errors)];
}

export function assertValidModuleCatalog(): void {
  const errors = validateModuleCatalog();
  if (errors.length > 0) {
    throw new Error(`Ugyldig modulkatalog: ${errors.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
// Sti → modul
// ---------------------------------------------------------------------------

/**
 * Sti-prefikser i prioritert rekkefølge. Lengre og mer spesifikke prefikser
 * står før generelle, slik at f.eks. `/api/v1/contracts` havner på kontrakter
 * og ikke på `api`.
 */
const ROUTE_MODULE_PREFIXES: ReadonlyArray<readonly [string, ModuleKey]> = [
  ["/kalender", "calendar"],
  ["/api/kalender", "calendar"],
  ["/rapporter", "reports"],
  ["/api/rapporter", "reports"],
  ["/hms", "reports"],
  ["/innstillinger/maler", "reports"],
  ["/enheter", "equipment"],
  ["/skann", "equipment"],
  ["/api/enheter", "equipment"],
  ["/api/kunder/enheter", "equipment"],
  ["/api/v1/maintenance-plans", "equipment"],
  ["/api/v1/equipment", "equipment"],
  ["/avtaler", "contracts"],
  ["/api/avtaler", "contracts"],
  ["/api/v1/contracts", "contracts"],
  ["/api/v1/sla-policies", "contracts"],
  ["/kundeportal", "portal"],
  ["/api/kundeportal", "portal"],
  ["/bookinger", "booking"],
  ["/dokumenter", "documents"],
  ["/api/v1/documents", "documents"],
  ["/api/upload", "documents"],
  ["/meldinger", "sms"],
  ["/api/webhooks/sms", "sms"],
  ["/kart", "map"],
  ["/sporing", "tracking"],
  ["/api/tracking", "tracking"],
  ["/anmeldelser", "reviews"],
  ["/anmeldelse", "reviews"],
  ["/api/innstillinger/audit/eksport", "auditExport"],
  ["/api/innstillinger/bevis", "auditExport"],
  ["/api/innstillinger/kunder", "transfer"],
  ["/api/scim", "sso"],
  ["/api/offline", "offline"],
  ["/api/v1", "api"],
];

/** Modulen en sti hører til, eller `null` når stien er kjernedata. */
export function moduleForPath(pathname: string): ModuleKey | null {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  for (const [prefix, key] of ROUTE_MODULE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/** Modulene som eier en gitt innstillingsfane (tomt for kjernedata). */
export function modulesForSettingsTab(tab: string): ModuleKey[] {
  return MODULES.filter((mod) =>
    mod.settingsTabs.includes(tab),
  ).map((mod) => mod.key);
}
