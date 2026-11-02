/**
 * Break-glass: nullstiller to-trinns verifisering for én bruker.
 *
 * Dette er den dokumenterte nødprosedyren når en privilegert bruker har mistet
 * både autentiseringsappen og gjenopprettingskodene, og `REQUIRE_2FA_ROLES`
 * ellers ville låst kontoen ute. Skriptet krever shell-tilgang til serveren og
 * databasepassordet. Hver kjøring skriver en revisjonsrad.
 *
 * Bruk:
 *   DATABASE_URL=... node scripts/break-glass-2fa.mjs --email admin@example.com --confirm
 *
 * Etterpå må brukeren logge inn med passordet og fullføre påkrevd 2FA-oppsett.
 * Skriptet endrer ikke passord, rolle eller andre rettigheter.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? "";
}

const email = (arg("email") || "").trim().toLowerCase();
const reason = (arg("reason") || "break-glass").slice(0, 200);
const confirmed = process.argv.includes("--confirm");

if (!email || !confirmed) {
  console.error(
    "Bruk: node scripts/break-glass-2fa.mjs --email <bruker> --confirm [--reason \"...\"]",
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
    await tx.auditLog.create({
      data: {
        entityType: "User",
        entityId: user.id,
        action: "2FA: break-glass nullstilte to-trinns verifisering",
        userName: user.name || user.email || "Ukjent",
        actorId: null,
        metadata: { reason, method: "scripts/break-glass-2fa.mjs" },
      },
    });
  });

  console.log(
    `✔ 2FA er nullstilt for ${user.email} (${user.role}). Alle økter er ugyldige.`,
  );
  console.log("  Brukeren må logge inn med passordet og fullføre påkrevd oppsett.");
} finally {
  await prisma.$disconnect();
}
