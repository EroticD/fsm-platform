#!/usr/bin/env node
/**
 * Kansellerer SLA-klokker som ikke har dekning i en aktiv avtale.
 *
 * Appens scheduler kjører oppryddingen automatisk. Dette skriptet er et
 * diagnose-/engangsverktøy og skriver derfor ikke `SlaCleanupRun`.
 *
 *   npm run sla:cleanup            # tørrkjøring (standard)
 *   npm run sla:cleanup -- --apply # skriv kanselleringene
 *
 * Klokker som allerede har samme gyldige policy beholdes. Hver kansellering
 * revisjonslogges. Kjør mot en kopi/testdatabase og ta backup før `--apply`
 * i produksjon.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { cancelUncontractedSlaClocks } from "../src/server/sla-cleanup";

const connectionString =
  process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? "";
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
  const result = await cancelUncontractedSlaClocks(prisma, {
    dryRun,
    take: 10_000,
  });
  const verb = result.dryRun ? "Vil kansellere" : "Kansellerte";
  console.log(
    `${verb} ${result.candidates.length} av ${result.scanned} vurderte SLA-klokker ` +
      `(${result.kept} med gyldig aktiv avtale beholdes).`,
  );

  for (const candidate of result.candidates) {
    const reason =
      candidate.reason === "no-active-contract"
        ? "ingen aktiv avtale"
        : `avtalen gir policy ${candidate.applicablePolicyId ?? "ukjent"}`;
    console.log(
      `- ${candidate.workOrderTitle} [${candidate.clockId}]: ` +
        `${candidate.previousState} → CANCELLED (${reason}; ` +
        `klokken peker på ${candidate.policyName})`,
    );
  }

  if (result.dryRun) {
    console.log("Tørrkjøring. Bruk --apply for å skrive endringene.");
  } else {
    console.log(`Skrev ${result.cancelled} kansellering(er) med revisjonslogg.`);
  }
} catch (error) {
  console.error("Opprydding av SLA-klokker feilet:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
