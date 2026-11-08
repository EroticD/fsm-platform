#!/usr/bin/env node
/**
 * Engangsbackfill for arbeidsdagsmodellen:
 *
 * 1. Deler eldre flerdagers heldagsvisiter i én økt per dag.
 * 2. Normaliserer eldre tidsstyrte enkeltdagsvisiter til én heldagsøkt per dag.
 *
 * Den nye arbeidsdagsmodellen forutsetter nøyaktig én `Visit` per
 * kalenderdag. Skriptet er idempotent og kan kjøres flere ganger. Det rører
 * ikke visiter som allerede følger modellen, og tvetydige rader rapporteres
 * uten å endres.
 *
 *   npm run visits:backfill:daily            # tørrkjøring
 *   npm run visits:backfill:daily -- --apply # skriv til databasen
 *
 * Kjør mot en kopi/testdatabase først, og ta backup før `--apply` i
 * produksjon. Tidsstempler blir liggende på første dag; nye dager er PLANNED.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  normaliseLegacyTimedVisits,
  splitMultiDayAllDayVisits,
  type LegacyTimedBackfillReport,
} from "../src/server/visit-backfill";

const REASON_LABELS: Record<LegacyTimedBackfillReport["reason"], string> = {
  "multi-day": "tidsstyrt visitt over flere dager",
  "invalid-range": "ugyldig tidsrom",
  "timestamp-outside-day": "tidsstempel utenfor dagen",
  "several-same-day": "flere visiter samme dag",
  "work-day-conflict": "dagen er allerede opptatt av en annen økt",
  "changed-during-apply": "raden ble endret under kjøringen",
};

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

try {
  const result = await splitMultiDayAllDayVisits(prisma, { dryRun });
  const verb = result.dryRun ? "Vil dele" : "Delte";
  console.log(
    `${verb} ${result.split} flerdagersvisitt(er) i ${result.created} nye dagsøkter (skannet ${result.scanned}).`,
  );

  // Eldre tidsstyrte enkeltdagsvisiter hører ikke hjemme i modellen med én
  // heldagsøkt per dag. De normaliseres bare når dagen er entydig; alt annet
  // rapporteres uten å endres.
  const legacy = await normaliseLegacyTimedVisits(prisma, { dryRun });
  const legacyVerb = legacy.dryRun ? "Vil normalisere" : "Normaliserte";
  console.log(
    `${legacyVerb} ${legacy.normalised} tidsstyrt(e) enkeltdagsvisitt(er); ` +
      `${legacy.reported} rapport(er) krever manuell vurdering (skannet ${legacy.scanned}).`,
  );
  for (const report of legacy.reports) {
    console.log(
      `  - ${report.id} (oppdrag ${report.workOrderId}, ${report.date ?? "ukjent dato"}): ${REASON_LABELS[report.reason]}`,
    );
  }

  if (result.dryRun) {
    console.log("Tørrkjøring. Bruk --apply for å skrive endringene.");
  }
} catch (error) {
  console.error("Backfill av arbeidsdager feilet:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
