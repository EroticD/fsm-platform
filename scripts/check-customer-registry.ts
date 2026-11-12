#!/usr/bin/env node
/**
 * Registervakt for kundekatalogen.
 *
 * Slår opp aktive kunder med organisasjonsnummer i Enhetsregisteret og
 * oppdaterer `Customer.registryStatus`. Konkurs og avvikling logges i den
 * hash-kjedede revisjonsloggen med aktør «Registervakt».
 *
 *   npm run registry:check
 *   npm run registry:check -- --dry-run
 *   npm run registry:check -- --limit 50
 *
 * Tørrkjøring regner ut endringene uten å skrive noe. Kunder registeret ikke
 * kunne svare på beholdes med kjent status, og skriptet avslutter med kode 0
 * selv om noen oppslag feilet – men advarer tydelig, slik at en cron-jobb kan
 * skille «ingen kunder endret» fra «registeret svarte ikke».
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { refreshCustomerRegistryStatuses } from "../src/server/customer-registry";

function parseLimit(argv: string[]): number | undefined {
  const inline = argv.find((arg) => arg.startsWith("--limit="));
  const index = argv.indexOf("--limit");
  if (!inline && index === -1) return undefined;

  const raw = inline ? inline.slice("--limit=".length) : argv[index + 1];
  if (!raw || raw.startsWith("--")) {
    console.error("--limit mangler en verdi. Bruk f.eks. --limit 50.");
    process.exit(1);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Ugyldig --limit «${raw}». Bruk et positivt heltall.`);
    process.exit(1);
  }
  return parsed;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const limit = parseLimit(argv);

try {
  const result = await refreshCustomerRegistryStatuses({ dryRun, limit });

  console.log(
    `Registervakt: kontrollerte ${result.checked} kunde(r) ` +
      `(${result.changed} endret, ${result.skipped} uendret, ` +
      `${result.unavailable} utilgjengelig).`,
  );

  if (dryRun) {
    console.log("Tørrkjøring – ingenting er skrevet. Kjør uten --dry-run for å lagre.");
  }

  if (result.unavailable > 0) {
    console.warn(
      `Advarsel: ${result.unavailable} oppslag fikk ikke svar fra Enhetsregisteret. ` +
        "Kjent status er beholdt, og kundene prøves igjen ved neste kjøring.",
    );
  }

  if (result.changed > 0) {
    const verb = dryRun ? "Vil endre" : "Endret";
    console.log(`${verb} registerstatus for ${result.changed} kunde(r).`);
  }

  // Utilgjengelige oppslag er en driftsforstyrrelse, ikke en feil i jobben.
  process.exitCode = 0;
} catch (error) {
  console.error("Registervakten feilet:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
