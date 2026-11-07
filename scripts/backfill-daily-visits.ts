#!/usr/bin/env node
/**
 * Engangsbackfill: deler eldre flerdagers heldagsvisiter i én økt per dag.
 *
 * Den nye arbeidsdagsmodellen forutsetter nøyaktig én `Visit` per
 * kalenderdag. Skriptet er idempotent og kan kjøres flere ganger. Det rører
 * ikke visiter som allerede dekker én dag.
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
import { splitMultiDayAllDayVisits } from "../src/server/visit-backfill";

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
  if (result.dryRun) {
    console.log("Tørrkjøring. Bruk --apply for å skrive endringene.");
  }
} catch (error) {
  console.error("Backfill av arbeidsdager feilet:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
