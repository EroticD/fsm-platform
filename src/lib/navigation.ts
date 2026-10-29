import { defaultPermissionsForRole, type Permission } from "@/lib/permissions";

/**
 * Navigasjonen. Hvert element har en rettighet som kreves for å se det.
 *
 * Menyen er data, ikke en fast liste per rolle. Da kan egendefinerte roller
 * verken se eller klikke seg inn på sider de ikke har tilgang til, og nye
 * sider (som kartet) blir tilgjengelige for alle som faktisk kan bruke dem.
 *
 * `section` avgjør hvor elementet vises:
 *   - primary: hovedarbeidsområdene i toppmenyen på brede skjermer
 *   - menu:    sekundære sider i den alltid tilgjengelige hamburgermenyen
 *   - settings: pinnet nederst i hamburgermenyen, aldri i hovedmenyen
 *
 * `audience` skiller feltarbeid fra kontorarbeid. Montører får «I dag» som
 * hjem, kontoret beholder dashbordet.
 */
export type NavSection = "primary" | "menu" | "settings";
export type NavAudience = "field" | "office";

export type NavItem = {
  href: string;
  labelKey: string;
  icon: string;
  /** Én eller flere rettigheter. Minst én må være oppfylt. */
  requires?: Permission | Permission[];
  section?: NavSection;
  audience?: NavAudience;
};

/** Hendelsen som åpner den eksisterende menyen fra mobilens bunnlinje. */
export const OPEN_MENU_EVENT = "fsm:open-menu";

/** Sider som skal stå alene uten app-navigasjon. */
const AUTH_ROUTES = [
  "/logg-inn",
  "/glemt-passord",
  "/tilbakestill-passord",
  "/aktiver-konto",
];

export function isAuthPath(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export const STAFF_NAV: NavItem[] = [
  {
    href: "/",
    labelKey: "dashboard",
    icon: "🏠",
    requires: "workorders.view",
    section: "primary",
    audience: "office",
  },
  {
    href: "/mine-oppdrag",
    labelKey: "today",
    icon: "☀️",
    requires: "workorders.view",
    section: "primary",
    audience: "field",
  },
  {
    href: "/oppdrag",
    labelKey: "workOrders",
    icon: "📂",
    requires: "workorders.view",
    section: "primary",
  },
  {
    href: "/kalender",
    labelKey: "calendar",
    icon: "📅",
    requires: "workorders.view",
    section: "primary",
  },
  {
    href: "/kunder",
    labelKey: "customers",
    icon: "🏢",
    requires: "customers.view",
    section: "primary",
  },
  {
    href: "/sok",
    labelKey: "search",
    icon: "🔍",
    section: "menu",
  },
  {
    href: "/rapporter",
    labelKey: "reports",
    icon: "📊",
    requires: "reports.view",
    section: "primary",
  },
  {
    href: "/hms",
    labelKey: "hms",
    icon: "🦺",
    requires: ["templates.view", "reports.view"],
    section: "menu",
  },
  {
    href: "/dokumenter",
    labelKey: "documents",
    icon: "📚",
    requires: "documents.view",
    section: "menu",
  },
  {
    href: "/kart",
    labelKey: "map",
    icon: "🗺️",
    requires: "workorders.view",
    section: "menu",
  },
  {
    href: "/oppdrag/ny",
    labelKey: "newWorkOrder",
    icon: "➕",
    requires: "workorders.create",
    section: "menu",
  },
  {
    href: "/varsler",
    labelKey: "notifications",
    icon: "🔔",
    section: "menu",
  },
  {
    href: "/mine-oppdrag/kunder",
    labelKey: "customersEquipment",
    icon: "🧰",
    requires: "customers.view",
    section: "menu",
    audience: "field",
  },
  {
    href: "/innstillinger",
    labelKey: "settings",
    icon: "⚙️",
    requires: [
      "settings.manage",
      "users.view",
      "templates.view",
      "reports.view",
      "documents.manage",
      "audit.view",
    ],
    section: "settings",
  },
];

/** Kundeportalbrukere har bare sin egen portal og egen kontosikkerhet. */
export const CUSTOMER_NAV: NavItem[] = [
  {
    href: "/kundeportal",
    labelKey: "customerPortal",
    icon: "👤",
    section: "primary",
  },
  {
    href: "/innstillinger?tab=sikkerhet",
    labelKey: "accountSecurity",
    icon: "🔐",
    section: "settings",
  },
];

export function hasAnyPermission(
  permissions: ReadonlySet<string> | readonly string[],
  required?: Permission | Permission[],
): boolean {
  if (!required) return true;
  const list = Array.isArray(required) ? required : [required];
  const set =
    permissions instanceof Set ? permissions : new Set(permissions);
  return list.some((permission) => set.has(permission));
}

/**
 * Hjemmet til en rolle. Montører starter i feltportalen «I dag», kunder i
 * kundeportalen, mens kontor og administrator beholder dashbordet.
 */
export function homePathForRole(role?: string | null): string {
  if (role === "TECHNICIAN") return "/mine-oppdrag";
  if (role === "CUSTOMER") return "/kundeportal";
  return "/";
}

/**
 * Filtrerer menyen for en bruker. `permissions` er de effektive
 * rettighetene; tom liste faller tilbake til rollens standardrettigheter når
 * rollen er kjent (brukes av tester og eldre kall).
 *
 * Montører ser «I dag» i stedet for dashbordet, og rapportene flyttes ned i
 * hamburgermenyen slik at hovedlinjen holder seg på fire arbeidsområder.
 */
export function navItemsFor(
  role?: string | null,
  permissions?: readonly string[] | null,
): NavItem[] {
  if (role === "CUSTOMER") return CUSTOMER_NAV;
  const effective =
    permissions && permissions.length > 0
      ? permissions
      : defaultPermissionsForRole(role);
  // Administrator ser alt, også når rettighetslista av en eller annen grunn
  // skulle være tom.
  const all = role === "ADMIN" ? new Set(["*"]) : new Set(effective);
  const audience: NavAudience = role === "TECHNICIAN" ? "field" : "office";
  const allowed = (item: NavItem) =>
    (!item.audience || item.audience === audience) &&
    (role === "ADMIN" ? true : hasAnyPermission(all, item.requires));
  return STAFF_NAV.filter(allowed).map((item) => {
    if (item.href === "/oppdrag/ny" && role === "TECHNICIAN") {
      return { ...item, href: "/mine-oppdrag/ny" };
    }
    if (item.href === "/rapporter" && role === "TECHNICIAN") {
      return { ...item, section: "menu" as const };
    }
    return item;
  });
}

/** Hovedarbeidsområdene som vises i toppmenyen på brede skjermer. */
export function primaryNavFor(items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => (item.section ?? "primary") === "primary");
}

/** Sekundære sider som alltid bor i hamburgermenyen. */
export function menuNavFor(items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => item.section === "menu");
}

/** Innstillinger som pinnes nederst i hamburgermenyen. */
export function settingsNavItem(
  items: readonly NavItem[],
): NavItem | undefined {
  return items.find((item) => item.section === "settings");
}

/**
 * Fanene i mobilens bunnlinje. «Mer» er ikke et navigasjonselement – den
 * åpner den eksisterende hovedmenyen – så den legges på av komponenten.
 */
export function mobileTabItemsFor(
  role?: string | null,
  permissions?: readonly string[] | null,
): NavItem[] {
  const items = navItemsFor(role, permissions);
  const hrefs =
    role === "TECHNICIAN"
      ? ["/mine-oppdrag", "/oppdrag", "/varsler"]
      : ["/", "/oppdrag", "/kalender"];
  return hrefs
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item));
}

/**
 * Finner elementet som skal markeres som aktivt. Den lengste treffende stien
 * vinner, slik at «/oppdrag/ny» ikke også markerer «/oppdrag».
 */
export function activeNavHref(
  items: readonly NavItem[],
  pathname: string,
): string | null {
  let match: string | null = null;
  for (const item of items) {
    // Elementer kan peke på en fane med query, f.eks. kundens sikkerhetsfane.
    // Aktive markeringen skal fortsatt følge selve siden.
    const itemPath = item.href.split(/[?#]/, 1)[0] || "/";
    const isMatch =
      pathname === itemPath ||
      (itemPath !== "/" && pathname.startsWith(`${itemPath}/`));
    if (isMatch && (!match || itemPath.length > match.split(/[?#]/, 1)[0].length)) {
      match = item.href;
    }
  }
  return match;
}

/** Er en bunnfane aktiv? Rotnivået matcher bare nøyaktig. */
export function isMobileTabActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
