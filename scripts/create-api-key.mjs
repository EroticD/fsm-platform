/**
 * Oppretter en API-nøkkel uten å gå gjennom appen eller en innlogget økt.
 *
 *   DATABASE_URL=... \
 *   API_KEY_USER_EMAIL=... \
 *   API_KEY_NAME="Integrasjon" \
 *   node scripts/create-api-key.mjs
 *
 * Klarteksttokenet skrives til terminalen én gang. Databasen lagrer bare
 * SHA-256-hashen og et kort prefix. Skriptet nekter å opprette en nøkkel for
 * en bruker som mangler eller er deaktivert.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const TOKEN_PREFIX = "fsm_";
const KEY_PREFIX_LENGTH = 12;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exitCode = 1;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail("DATABASE_URL må være satt.");
  process.exit();
}

const email = (process.env.API_KEY_USER_EMAIL || "").trim();
const name = (process.env.API_KEY_NAME || "").trim();
const expiresAtRaw = (process.env.API_KEY_EXPIRES_AT || "").trim();

if (!email || !name) {
  fail("API_KEY_USER_EMAIL og API_KEY_NAME må være satt.");
  process.exit();
}
if (name.length > 80) {
  fail("API_KEY_NAME kan være maks 80 tegn.");
  process.exit();
}

let expiresAt = null;
if (expiresAtRaw) {
  const parsed = new Date(expiresAtRaw);
  if (Number.isNaN(parsed.getTime())) {
    fail("API_KEY_EXPIRES_AT må være en gyldig ISO-dato.");
    process.exit();
  }
  if (parsed.getTime() <= Date.now()) {
    fail("API_KEY_EXPIRES_AT må ligge i fremtiden.");
    process.exit();
  }
  expiresAt = parsed;
}

const url = new URL(connectionString);
const schema = url.searchParams.get("schema") ?? undefined;
url.searchParams.delete("schema");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

try {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, name: true, isActive: true },
  });

  if (!user) {
    fail(`Fant ingen bruker med e-postadressen ${email}.`);
  } else if (!user.isActive) {
    fail(`Brukeren ${email} er deaktivert. Aktiver kontoen først.`);
  } else {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const prefix = token.slice(0, KEY_PREFIX_LENGTH);

    await prisma.apiKey.create({
      data: {
        name,
        keyHash: createHash("sha256").update(token).digest("hex"),
        prefix,
        userId: user.id,
        expiresAt,
      },
    });

    console.log(`✔ Opprettet API-nøkkel «${name}» for ${user.email}.`);
    console.log(`  Prefix: ${prefix}`);
    console.log(`  Token (vises bare én gang): ${token}`);
    if (expiresAt) console.log(`  Utløper: ${expiresAt.toISOString()}`);
  }
} catch (error) {
  // Ikke skriv rå Prisma-feil: de kan inneholde kolonneverdier fra databasen.
  fail(error?.code ? `Databasefeil (${error.code}).` : "Ukjent feil.");
} finally {
  await prisma.$disconnect();
}
