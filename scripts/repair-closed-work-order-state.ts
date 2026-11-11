#!/usr/bin/env node
/**
 * Retter hengende tilstand på oppdrag som allerede er lukket.
 *
 * Rapporter som fullførte oppdraget på stedet (standardvalget i felt) skrev
 * status COMPLETED uten å lukke visiter, returkjøring, sporingslenker og
 * SLA-klokker. Koden er rettet, men radene som allerede ble skrevet ligger
 * fortsatt igjen. Dette skriptet bruker nøyaktig samme ryddefunksjon som
 * koden, slik at reparasjonen ikke blir en ny variant av feilen.
 *
 * Skriptet er idempotent: det plukker bare oppdrag som faktisk har hengende
 * tilstand, og rører ingenting annet.
 *
 *   npm run repair:closed-work-orders            # tørrkjøring
 *   npm run repair:closed-work-orders -- --apply # skriv til databasen
 *
 * Kjør mot en kopi først, og ta backup før `--apply` i produksjon.
 *
 * Merk: lukkestatusene leses fra `WorkOrderStatusSetting` i samme database, med
 * standardoppsettet som fallback. Da treffer skriptet også installasjoner der
 * administratoren har konfigurert andre statuser som lukket.
 */
import "dotenv/config";
import { PrismaClient, type WorkStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { closeWorkOrderState } from "../src/lib/work-order-status-action";
import { audit } from "../src/lib/audit";

const REPAIR_ACTOR = { id: "", name: "Reparasjon", email: null };
const DEFAULT_CLOSED_STATUSES = ["COMPLETED", "CANCELLED"] as const;
const ACTIVE_VISIT_STATUSES = ["EN_ROUTE", "ON_SITE"] as const;

const connectionString =
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("Mangler DATABASE_URL eller DATABASE_MIGRATION_URL.");
  process.exit(1);
}

const databaseUrl = new URL(connectionString);
const schema = databaseUrl.searchParams.get("schema") ?? undefined;
databaseUrl.searchParams.delete("schema");

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: databaseUrl.toString() },
    { schema },
  ),
});

const dryRun = !process.argv.includes("--apply");

/**
 * Lukkestatusene kan være konfigurert av administrator. Skriptet leser dem fra
 * databasen og faller tilbake til standardoppsettet når tabellen er tom.
 */
async function loadClosedStatuses(): Promise<WorkStatus[]> {
  const rows = await prisma.workOrderStatusSetting.findMany({
    where: { category: "CLOSED", isActive: true },
    select: { status: true },
  });
  const configured = rows.map((row) => row.status);
  return configured.length > 0
    ? configured
    : [...DEFAULT_CLOSED_STATUSES];
}

try {
  const closedStatuses = await loadClosedStatuses();
  const rows = await prisma.workOrder.findMany({
    where: {
      status: { in: closedStatuses },
      OR: [
        { visits: { some: { status: { in: [...ACTIVE_VISIT_STATUSES] } } } },
        { visits: { some: { status: "DONE", travelFromEndedAt: null } } },
        { trackingLinks: { some: { revokedAt: null } } },
        {
          slaClocks: {
            some: { resolvedAt: null, state: { notIn: ["MET", "CANCELLED"] } },
          },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      visits: { select: { status: true, travelFromEndedAt: true } },
      trackingLinks: { where: { revokedAt: null }, select: { id: true } },
      slaClocks: {
        where: { resolvedAt: null, state: { notIn: ["MET", "CANCELLED"] } },
        select: { id: true },
      },
    },
    orderBy: { id: "asc" },
  });

  const summary = rows.map((row) => {
    const activeVisits = row.visits.filter((visit) =>
      (ACTIVE_VISIT_STATUSES as readonly string[]).includes(visit.status),
    ).length;
    const openTravel = row.visits.filter(
      (visit) => visit.status === "DONE" && !visit.travelFromEndedAt,
    ).length;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      updatedAt: row.updatedAt,
      activeVisits,
      openTravel,
      liveTrackingLinks: row.trackingLinks.length,
      openSlaClocks: row.slaClocks.length,
    };
  });

  const totals = summary.reduce(
    (acc, row) => ({
      activeVisits: acc.activeVisits + row.activeVisits,
      openTravel: acc.openTravel + row.openTravel,
      liveTrackingLinks: acc.liveTrackingLinks + row.liveTrackingLinks,
      openSlaClocks: acc.openSlaClocks + row.openSlaClocks,
    }),
    { activeVisits: 0, openTravel: 0, liveTrackingLinks: 0, openSlaClocks: 0 },
  );

  console.log(
    `Fant ${rows.length} lukket(e) oppdrag med hengende tilstand: ` +
      `${totals.activeVisits} aktive visit(er), ${totals.openTravel} uavsluttet returkjøring, ` +
      `${totals.liveTrackingLinks} levende sporingslenke(r), ${totals.openSlaClocks} åpen SLA-klokke.`,
  );
  for (const row of summary.slice(0, 20)) {
    console.log(
      `  - ${row.id} (${row.status}) «${row.title}»: ` +
        `${row.activeVisits} aktiv, ${row.openTravel} retur, ` +
        `${row.liveTrackingLinks} sporing, ${row.openSlaClocks} SLA`,
    );
  }
  if (summary.length > 20) {
    console.log(`  … og ${summary.length - 20} til.`);
  }

  if (dryRun) {
    console.log("Tørrkjøring. Bruk --apply for å skrive endringene.");
  } else {
    let repaired = 0;
    for (const row of summary) {
      await prisma.$transaction(async (tx) => {
        // Lukketidspunktet er oppdragets siste endring, ikke tidspunktet
        // reparasjonen kjører. Ellers ville en visitt som har hengt siden i
        // vår fått «arbeidstid» på flere måneder og SLA-brudd på dagen.
        await closeWorkOrderState(tx, {
          workOrderId: row.id,
          cancelled: row.status === "CANCELLED",
          closedAt: row.updatedAt,
        });
        await audit(tx, {
          entityType: "WorkOrder",
          entityId: row.id,
          action: "Reparerer hengende tilstand etter lukking",
          actor: REPAIR_ACTOR,
          metadata: {
            activeVisits: row.activeVisits,
            openTravel: row.openTravel,
            liveTrackingLinks: row.liveTrackingLinks,
            openSlaClocks: row.openSlaClocks,
            closedAt: row.updatedAt.toISOString(),
            repairedAt: new Date().toISOString(),
          },
        });
      });
      repaired += 1;
    }
    console.log(`Reparerte ${repaired} oppdrag.`);
  }
} catch (error) {
  console.error("Reparasjon av lukkede oppdrag feilet:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
