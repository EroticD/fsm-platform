/**
 * Oppretter den første administratoren i en tom database.
 *
 * Kjøres manuelt (`npm run seed`) eller automatisk av Docker-oppstarten når
 * SEED_DATABASE=true. Skriptet er idempotent: en bruker som allerede finnes
 * blir ikke endret.
 *
 * Alle verdier kan styres med miljøvariabler:
 *   SEED_ADMIN_EMAIL     (standard: admin@example.com)
 *   SEED_ADMIN_PASSWORD  (standard: admin123 – nektes i produksjon)
 *   SEED_ADMIN_NAME      (standard: Administrator)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✖ DATABASE_URL må være satt for å kjøre seed.");
  process.exit(1);
}

const url = new URL(connectionString);
const schema = url.searchParams.get("schema") ?? undefined;
url.searchParams.delete("schema");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const name = process.env.SEED_ADMIN_NAME || "Administrator";
// Standardpassordet brukes bare når SEED_ADMIN_PASSWORD ikke er satt. Da nekter
// vi å opprette brukeren i produksjon, slik at et svakt passord ikke sniker seg inn.
const configuredPassword = process.env.SEED_ADMIN_PASSWORD;
if (process.env.NODE_ENV === "production" && !configuredPassword) {
  console.error("✖ SEED_ADMIN_PASSWORD må settes for å opprette administrator i produksjon.");
  process.exit(1);
}
const password = configuredPassword ?? "admin123";

try {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`→ Brukeren ${email} finnes allerede, hopper over.`);
  } else {
    const admin = await prisma.user.create({
      data: {
        email,
        name,
        password: await bcrypt.hash(password, 10),
        role: "ADMIN",
        // Kontoer må aktiveres manuelt før innlogging er tillatt.
        isActive: true,
      },
    });
    console.log(`✔ Opprettet administrator ${admin.email}`);
    if (!configuredPassword) {
      console.log("  Husk å bytte passordet etter første innlogging.");
    }
  }
} finally {
  await prisma.$disconnect();
}
