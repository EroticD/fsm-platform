import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PoolConfig } from 'pg'
import { onShutdown } from './shutdown'

/**
 * Leser en positiv heltallsverdi fra miljøet. Ugyldige verdier (tom streng,
 * tekst, desimaltall, null eller negative tall) faller tilbake til standarden
 * i stedet for å gi en pool som aldri kobler til, eller en timeout på 0 — som
 * betyr "uendelig" i PostgreSQL og dermed motsatt av det vi vil.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Maks antall samtidige PostgreSQL-tilkoblinger per appprosess. Med flere
 * replikaer må denne ganges med replikaantallet og holdes under databasens
 * `max_connections` (med margin til migrasjoner og drift).
 */
function poolMax(): number {
  return positiveIntFromEnv('DATABASE_POOL_MAX', 10)
}

/**
 * Hvor lenge en forespørsel venter på en ledig tilkobling (eller på at
 * TCP/TLS-oppkoblingen blir klar) før den feiler. Uten denne venter
 * forespørsler i det uendelige når poolen er brukt opp, og HTTP-requesten
 * henger til klienten gir opp.
 */
function connectTimeoutMs(): number {
  return positiveIntFromEnv('DATABASE_CONNECT_TIMEOUT_MS', 10_000)
}

/**
 * `statement_timeout` settes som oppstartsparameter på hver tilkobling, så
 * PostgreSQL selv avbryter spørringer som kjører for lenge og frigjør
 * tilkoblingen. Det hindrer at én treg spørring spiser hele poolen.
 */
function statementTimeoutMs(): number {
  return positiveIntFromEnv('DATABASE_STATEMENT_TIMEOUT_MS', 30_000)
}

/**
 * Vises i `pg_stat_activity.application_name`, slik at tilkoblingene våre kan
 * skilles fra migrasjoner, psql og andre tjenester i samme database.
 */
function applicationName(): string {
  return process.env.DATABASE_APP_NAME?.trim() || 'fsm-platform'
}

/**
 * Felles pool-konfigurasjon. `PrismaPg` tar imot en `pg.PoolConfig` direkte,
 * så `connectionTimeoutMillis`, `statement_timeout` og `application_name` går
 * rett til node-postgres uten å måtte bygges inn i connection string.
 */
function poolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: poolMax(),
    connectionTimeoutMillis: connectTimeoutMs(),
    statement_timeout: statementTimeoutMs(),
    application_name: applicationName(),
  }
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL ?? ''

  // Prisma 7 bruker en driver-adapter. `?schema=` er en Prisma-parameter som
  // node-postgres ikke kjenner, så vi tar den ut og sender schemaet separat.
  if (connectionString) {
    const url = new URL(connectionString)
    const schema = url.searchParams.get('schema') ?? undefined
    url.searchParams.delete('schema')

    return new PrismaClient({
      adapter: new PrismaPg(poolConfig(url.toString()), { schema }),
    })
  }

  // Under bygg og statisk analyse kan DATABASE_URL mangle. Klienten kobler seg
  // ikke til før den første spørringen, så det er trygt å opprette den her.
  return new PrismaClient({
    adapter: new PrismaPg(poolConfig('')),
  })
}

const prismaClientSingleton = () => {
  return createPrismaClient()
}

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

/**
 * Lukk poolen kontrollert ved SIGTERM/SIGINT. Prioritet 100 gjør at dette
 * kjører etter scheduler- og job-worker-oppryddingen, uansett hvilken modul
 * som ble importert først: de må få gjøre ferdig spørringene sine før
 * tilkoblingene lukkes.
 */
onShutdown(() => prisma.$disconnect(), { name: "prisma", priority: 100 })

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
