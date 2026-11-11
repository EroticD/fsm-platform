/**
 * Break-glass: nullstiller to-trinns verifisering for én bruker.
 *
 * Dette er den dokumenterte nødprosedyren når en privilegert bruker har mistet
 * både autentiseringsappen og gjenopprettingskodene, og `REQUIRE_2FA_ROLES`
 * ellers ville låst kontoen ute. Skriptet krever shell-tilgang til serveren og
 * databasepassordet. Hver kjøring skriver en revisjonsrad.
 *
 * Bruk:
 *   DATABASE_URL=... npx tsx scripts/break-glass-2fa.mjs --email admin@example.com --confirm
 *
 * Skriptet må kjøres med `tsx` fordi revisjonsraden skrives gjennom
 * `audit()` i `src/lib/audit.ts`, slik at den havner i den hash-kjedede
 * loggen. En direkte skriving til AuditLog ville gitt en rad uten hash, og da
 * underkjennes hele beviskjeden av `verifyAuditChain`.
 *
 * Etterpå må brukeren logge inn med passordet og fullføre påkrevd 2FA-oppsett.
 * Skriptet endrer ikke passord, rolle eller andre rettigheter.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { audit } from "../src/lib/audit";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? "";
}

const email = (arg("email") || "").trim().toLowerCase();
const reason = (arg("reason") || "break-glass").slice(0, 200);
const confirmed = process.argv.includes("--confirm");

if (!email || !confirmed) {
  console.error(
    "Bruk: npx tsx scripts/break-glass-2fa.mjs --email <bruker> --confirm [--reason \"...\"]",
  );
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✖ DATABASE_URL må være satt.");
  process.exit(1);
}

const url = new URL(connectionString);
const schema = url.searchParams.get("schema") ?? undefined;
url.searchParams.delete("schema");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

try {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isTwoFactorEnabled: true,
      departmentId: true,
    },
  });

  if (!user) {
    console.error(`✖ Fant ingen bruker med e-post ${email}.`);
    process.exit(2);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorSetupStartedAt: null,
        lastTotpTimeStep: null,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
    // Samme transaksjon som endringen: en vellykket nullstilling kan ikke
    // stå uten revisjonsrad, og raden kan ikke overleve en rollback.
    await audit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "2FA: break-glass nullstilte to-trinns verifisering",
      actionCode: "user.2fa.break_glass",
      outcome: "SUCCESS",
      retentionClass: "SECURITY_1Y",
      actor: { id: "", name: "break-glass", email: null },
      departmentId: user.departmentId,
      targetUserId: user.id,
      metadata: { reason, method: "scripts/break-glass-2fa.mjs" },
    });
  });

  console.log(
    `✔ 2FA er nullstilt for ${user.email} (${user.role}). Alle økter er ugyldige.`,
  );
  console.log("  Brukeren må logge inn med passordet og fullføre påkrevd oppsett.");
} finally {
  await prisma.$disconnect();
}
