import prisma from "@/lib/prisma";

/** Kanalen som både mutasjonene og SSE-endepunktet bruker. */
export const REALTIME_CHANNEL = "fsm_realtime";

export type RealtimeKind =
  | "workorders"
  | "customers"
  | "documents"
  | "reports"
  | "notifications"
  | "settings"
  | "all";

/** Alle gyldige kategorier. SSE-endepunktet slipper bare disse gjennom. */
export const REALTIME_KINDS: readonly RealtimeKind[] = [
  "workorders",
  "customers",
  "documents",
  "reports",
  "notifications",
  "settings",
  "all",
];

export function isRealtimeKind(value: string): value is RealtimeKind {
  return (REALTIME_KINDS as readonly string[]).includes(value);
}

/**
 * Bare klienter som faktisk kan kjøre SQL skal varsle. Transaksjonsklienter i
 * enhetstester er ofte enkle objekter uten `$executeRaw`, og da hopper vi
 * stille over varselet i stedet for å velte forretningslogikken.
 */
export type RealtimeSqlClient = {
  $executeRaw?: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

const ENTITY_KINDS: Record<string, RealtimeKind> = {
  workorder: "workorders",
  customer: "customers",
  document: "documents",
  documentfolder: "documents",
  report: "reports",
  notification: "notifications",
  user: "settings",
  department: "settings",
  role: "settings",
  template: "settings",
  branding: "settings",
};

/**
 * Oversetter en revisjonslogg-`entityType` til en grov sanntidskategori.
 * Klienten bruker kategorien til å reagere målrettet, men oppdaterer uansett
 * hele siden – derfor er ukjente typer trygt mappet til «all».
 */
export function realtimeKindForEntity(entityType: string): RealtimeKind {
  const normalized = entityType.trim().toLowerCase();
  return ENTITY_KINDS[normalized] ?? "all";
}

/**
 * Sender et sanntidsvarsel på PostgreSQL-kanalen. Varselet er beste-forsøk:
 * manglende database, manglende `pg_notify` eller en mock i en enhetstest skal
 * aldri få selve mutasjonen til å feile. Vi logger bare en fast, kort melding
 * uten data om entiteten.
 */
export async function publishRealtime(
  kind: RealtimeKind,
  client: RealtimeSqlClient = prisma,
): Promise<void> {
  try {
    if (typeof client?.$executeRaw !== "function") return;
    await client.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${kind})`;
  } catch {
    console.error("Realtime-varsel kunne ikke sendes");
  }
}
