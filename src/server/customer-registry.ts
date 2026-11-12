/**
 * Registervakten: holder `Customer.registryStatus` oppdatert mot
 * Enhetsregisteret.
 *
 * Kjør som periodisk jobb eller manuelt:
 *
 *   npm run registry:check
 *   npm run registry:check -- --dry-run --limit 50
 *
 * Modulen importerer bare prisma, revisjonsloggen og Brreg-klienten. Den skal
 * kunne kjøres fra et skript med `tsx`, uten NextAuth eller annen
 * forespørselskontekst.
 */
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { lookupCompany } from "@/lib/brreg";
import {
  registryStatusFrom,
  type RegistryStatus,
} from "@/lib/customer-registry-status";

/** Brreg tåler ikke ubegrenset parallellitet; fire samtidige oppslag er nok. */
const MAX_CONCURRENCY = 4;

/** Standard antall kunder per kjøring når `limit` ikke er satt. */
const DEFAULT_LIMIT = 500;

export type CustomerRegistryRefreshOptions = {
  /** Regn ut endringene uten å skrive dem. */
  dryRun?: boolean;
  /** Maks antall kunder å sjekke i denne kjøringen. */
  limit?: number;
  /** Tidsstemplet som skrives i `registryCheckedAt`. */
  now?: Date;
};

export type CustomerRegistryRefreshResult = {
  /** Antall kunder vi faktisk slo opp i registeret. */
  checked: number;
  /** Antall kunder der statusen ble (eller ville blitt) skrevet. */
  changed: number;
  /** Antall oppslag registeret ikke kunne svare på. */
  unavailable: number;
  /** Antall kunder der den kjente statusen fortsatt stemmer. */
  skipped: number;
};

/**
 * Kjører `worker` over `items` med et tak på samtidige oppslag. Vi henter
 * resultatene i samme rekkefølge som inndata, slik at oppsummeringen er stabil.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Oversetter et oppslag til en status vi kan lagre. `removed` (slettet i
 * registeret) behandles som «ikke funnet»: kunden finnes ikke lenger som
 * aktiv enhet, og det er nettopp det saksbehandleren må se.
 */
function statusForLookup(
  lookup: Awaited<ReturnType<typeof lookupCompany>>,
): RegistryStatus | null {
  if (lookup.status === "unavailable") return null;
  if (lookup.status === "found") return registryStatusFrom(lookup.company);
  return "NOT_FOUND";
}

/**
 * Slår opp alle aktive kunder med organisasjonsnummer og oppdaterer
 * registerstatusen der den har endret seg.
 *
 * En kunde uten kjent status får statusen skrevet selv om den er `ACTIVE`,
 * slik at første kjøring fyller feltet. Et oppslag som ikke fikk svar
 * (`unavailable`) overskriver aldri en kjent status: en nettverksfeil skal
 * ikke gjøre en konkurs kunde «aktiv» igjen.
 */
export async function refreshCustomerRegistryStatuses(
  options: CustomerRegistryRefreshOptions = {},
): Promise<CustomerRegistryRefreshResult> {
  const dryRun = options.dryRun ?? false;
  const limit =
    options.limit && options.limit > 0
      ? Math.trunc(options.limit)
      : DEFAULT_LIMIT;
  const now = options.now ?? new Date();

  const customers = await prisma.customer.findMany({
    where: { orgNumber: { not: null }, deletedAt: null },
    // De som aldri er sjekket, og de som ble sjekket for lengst siden, først.
    orderBy: [{ registryCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      orgNumber: true,
      registryStatus: true,
    },
  });

  const result: CustomerRegistryRefreshResult = {
    checked: 0,
    changed: 0,
    unavailable: 0,
    skipped: 0,
  };

  /** Kunder der statusen stemte, men kontrolltidspunktet skal flyttes. */
  const unchanged: string[] = [];

  const outcomes = await mapWithConcurrency(
    customers,
    MAX_CONCURRENCY,
    async (customer) => {
      const lookup = await lookupCompany(customer.orgNumber);
      return { customer, status: statusForLookup(lookup) };
    },
  );

  for (const { customer, status } of outcomes) {
    result.checked += 1;

    if (status === null) {
      // Registeret svarte ikke. Behold det vi vet, tell avviket, og la
      // `registryCheckedAt` stå slik at kunden prøves igjen først i neste
      // kjøring.
      result.unavailable += 1;
      continue;
    }

    if (customer.registryStatus === status) {
      result.skipped += 1;
      unchanged.push(customer.id);
      continue;
    }

    result.changed += 1;
    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { registryStatus: status, registryCheckedAt: now },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customer.id,
        action: `Registerstatus endret til ${status}`,
        actor: { id: "system", name: "Registervakt", email: null },
        actionCode: "customer.registry.changed",
        metadata: { from: customer.registryStatus ?? null, to: status },
        retentionClass: "OPS_90D",
      });
    });
  }

  // Kunder med uendret status får likevel nytt kontrolltidsstempel. Uten det
  // ville «eldste kontroll først» alltid plukket de samme radene når `limit`
  // er mindre enn kundemassen, og resten aldri blitt sjekket. Ingen
  // revisjonsrad: statusen er ikke endret.
  if (!dryRun && unchanged.length > 0) {
    await prisma.customer.updateMany({
      where: { id: { in: unchanged } },
      data: { registryCheckedAt: now },
    });
  }

  return result;
}
