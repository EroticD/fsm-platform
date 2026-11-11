#!/usr/bin/env node
/**
 * Backfyller hash-kjeden for revisjonsloggen deterministisk.
 *
 * Kjør etter at migreringen `audit_hash_chain` er anvendt, med en rolle som
 * har UPDATE på AuditLog (migrasjons-/vedlikeholdsrollen, ikke runtime-rollen):
 *
 *   npm run audit:backfill
 *
 * Skriptet er idempotent. Rader som allerede har hash hoppes over, men inngår
 * i kjeden. Stemmer en eksisterende hash ikke med innholdet, avbrytes hele
 * backfillen uten å skrive mer.
 *
 *   npm run audit:backfill -- --rebuild
 *
 * `--rebuild` regner kjeden på nytt for alle rader. Det er bare riktig når en
 * rad er skrevet utenfor `audit()` og har laget en forgrening; eksporterte
 * bevis må da tas på nytt. Ta backup først.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { backfillAuditChain } from "../src/lib/audit-chain";

const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("Mangler DATABASE_URL eller DATABASE_MIGRATION_URL.");
  process.exit(1);
}

const databaseUrl = new URL(connectionString);
const schema = databaseUrl.searchParams.get("schema") ?? undefined;
databaseUrl.searchParams.delete("schema");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl.toString() }, { schema }),
});

try {
  const rebuild = process.argv.includes("--rebuild");
  const result = await backfillAuditChain(prisma, {
    batchSize: 500,
    ...(rebuild ? { mode: "rebuild" as const } : {}),
  });
  if (!result.ok) {
    console.error(`Backfill avbrutt: ${result.reason}`);
    console.error(`Oppdaterte ${result.updated} rader før avbruddet.`);
    process.exitCode = 1;
  } else {
    console.log(
      `Audit hash chain: kontrollerte ${result.checked} rader, ` +
        `oppdaterte ${result.updated}. Siste hash: ${result.lastHash ?? "ingen"}.`,
    );
  }
} finally {
  await prisma.$disconnect();
}
