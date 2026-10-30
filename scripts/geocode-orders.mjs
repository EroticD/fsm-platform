/**
 * Geokoder eksisterende oppdrag som mangler koordinater.
 *
 * Bruk:
 *   DATABASE_URL=... node scripts/geocode-orders.mjs
 *
 * OpenStreetMap Nominatim krever maks én forespørsel per sekund. Skriptet
 * venter derfor mellom hvert oppslag og oppdaterer bare rader som faktisk får
 * et treff. Det er trygt å kjøre flere ganger.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✖ DATABASE_URL mangler.");
  process.exit(1);
}
if (process.env.GEOCODE_ENABLED === "false") {
  console.error("✖ GEOCODE_ENABLED=false. Slå på geokoding først.");
  process.exit(1);
}

const url = new URL(connectionString);
const schema = url.searchParams.get("schema") ?? undefined;
url.searchParams.delete("schema");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

const limit = Math.max(1, Number(process.env.GEOCODE_LIMIT ?? 50));
const endpoint =
  process.env.GEOCODE_ENDPOINT ??
  "https://nominatim.openstreetmap.org/search";
const userAgent =
  process.env.GEOCODE_USER_AGENT ??
  process.env.APP_URL ??
  "FSM-platform/0.8.0";
const timeoutMs = Number(process.env.GEOCODE_TIMEOUT_MS ?? 5000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function effectiveQuery(order) {
  const address =
    order.address?.trim() || order.customer?.address?.trim() || null;
  const postalCode =
    order.postalCode?.trim() || order.customer?.postalCode?.trim() || null;
  const city = order.city?.trim() || order.customer?.city?.trim() || null;
  return [address, postalCode, city].filter(Boolean).join(", ").trim();
}

async function geocode(query) {
  const target = new URL(endpoint);
  target.searchParams.set("format", "jsonv2");
  target.searchParams.set("limit", "1");
  target.searchParams.set("countrycodes", "no");
  target.searchParams.set("q", query);
  const response = await fetch(target, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  const rows = await response.json();
  const first = rows[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

const orders = await prisma.workOrder.findMany({
  where: {
    latitude: null,
    longitude: null,
    deletedAt: null,
    OR: [
      { address: { not: null } },
      { postalCode: { not: null } },
      { city: { not: null } },
      { customer: { address: { not: null } } },
      { customer: { city: { not: null } } },
    ],
  },
  select: {
    id: true,
    title: true,
    address: true,
    postalCode: true,
    city: true,
    customer: { select: { address: true, postalCode: true, city: true } },
  },
  orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
  take: limit,
});

console.log(`→ ${orders.length} oppdrag mangler koordinater (maks ${limit}).`);

let ok = 0;
let failed = 0;
for (const [index, order] of orders.entries()) {
  const query = effectiveQuery(order);
  if (!query) {
    failed += 1;
    continue;
  }
  if (index > 0) await sleep(1_100);
  try {
    const point = await geocode(query);
    if (!point) {
      failed += 1;
      console.log(`  ✖ ${order.title}: fant ikke adressen`);
      continue;
    }
    await prisma.workOrder.update({
      where: { id: order.id },
      data: { latitude: point.lat, longitude: point.lng },
    });
    ok += 1;
    console.log(`  ✔ ${order.title} → ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✖ ${order.title}: ${error.message}`);
  }
}

console.log(`✔ Ferdig: ${ok} geokodet, ${failed} uten treff.`);
await prisma.$disconnect();
