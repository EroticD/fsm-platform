import { defaultPermissionsForRole, type Permission } from "@/lib/permissions";

/**
 * Toppnavigasjonen. Hvert element har en rettighet som kreves for å se det.
 *
 * Menyen er data, ikke en fast liste per rolle. Da kan egendefinerte roller
 * verken se eller klikke seg inn på sider de ikke har tilgang til, og nye
 * sider (som kartet) blir tilgjengelige for alle som faktisk kan bruke dem.
 *
 * `section` avgjør hvor elementet vises:
 *   - primary: hovedarbeidsområdene i toppmenyen på brede skjermer
 *   - menu:    sekundære sider i den alltid tilgjengelige hamburgermenyen
 *   - settings: pinnet nederst i hamburgermenyen, aldri i hovedmenyen
 */
export type NavSection = "primary" | "menu" | "settings";

export type NavItem = {
  href: string;
  labelKey: string;
  icon: string;
  /** Én eller flere rettigheter. Minst én må være oppfylt. */
  requires?: Permission | Permission[];
  section?: NavSection;
};

export const STAFF_NAV: NavItem[] = [
  {
    href: "/",
    labelKey: "dashboard",
    icon: "🏠",
    requires: "workorders.view",
    section: "primary",
  },
  {
    href: "/mine-oppdrag",
    labelKey: "myWorkOrders",
    icon: "📋",
    requires: "workorders.view",
    section: "primary",
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
    href: "/dokumenter",
    labelKey: "documents",
    icon: "📚",
    requires: "documents.view",
    section: "primary",
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

/** Kundeportalbrukere har bare sin egen portal. */
export const CUSTOMER_NAV: NavItem[] = [
  {
    href: "/kundeportal",
    labelKey: "customerPortal",
    icon: "👤",
    section: "primary",
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
 * Filtrerer menyen for en bruker. `permissions` er de effektive
 * rettighetene; tom liste faller tilbake til rollens standardrettigheter når
 * rollen er kjent (brukes av tester og eldre kall).
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
  const allowed = (item: NavItem) =>
    role === "ADMIN" ? true : hasAnyPermission(all, item.requires);
  return STAFF_NAV.filter(allowed).map((item) =>
    item.href === "/oppdrag/ny" && role === "TECHNICIAN"
      ? { ...item, href: "/mine-oppdrag/ny" }
      : item,
  );
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
 * Finner elementet som skal markeres som aktivt. Den lengste treffende stien
 * vinner, slik at «/oppdrag/ny» ikke også markerer «/oppdrag».
 */
export function activeNavHref(
  items: readonly NavItem[],
  pathname: string,
): string | null {
  let match: string | null = null;
  for (const item of items) {
    const isMatch =
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(`${item.href}/`));
    if (isMatch && (!match || item.href.length > match.length)) {
      match = item.href;
    }
  }
  return match;
}
