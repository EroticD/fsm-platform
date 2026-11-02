#!/usr/bin/env node
/**
 * Verifiserer revisjonsloggens hash-kjede uten å endre noe.
 *
 *   npm run audit:verify
 *
 * Exit-kode 1 betyr at kjeden er brutt, mangler hash eller ikke stemmer med
 * innholdet. Tombstones fra retensjonsjobben godtas som kontrollerte hull.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { verifyAuditChain } from "../src/lib/audit-chain";

const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("Mangler DATABASE_URL.");
  process.exit(1);
}

const databaseUrl = new URL(connectionString);
const schema = databaseUrl.searchParams.get("schema") ?? undefined;
databaseUrl.searchParams.delete("schema");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl.toString() }, { schema }),
});

try {
  const rows = await prisma.auditLog.findMany({
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      entityType: true,
      entityId: true,
      action: true,
      userName: true,
      actorId: true,
      departmentId: true,
      metadata: true,
      prevHash: true,
      hash: true,
      createdAt: true,
    },
  });
  const purged = await prisma.auditPurgedHash.findMany({ select: { hash: true } });
  const result = verifyAuditChain(rows, {
    purgedHashes: purged.map((row) => row.hash),
  });

  if (!result.ok) {
    console.error(
      `✖ Revisjonskjeden er brutt ved rad ${result.brokenAt?.seq ?? "?"} ` +
        `(${result.brokenAt?.id ?? "ukjent"}): ${result.brokenAt?.reason}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `✓ Revisjonskjeden er intakt: ${result.checked} rader, ` +
        `${result.purgedGaps} kontrollerte hull.`,
    );
  }
} finally {
  await prisma.$disconnect();
}
