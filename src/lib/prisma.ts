import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { onShutdown } from './shutdown'

/**
 * Maks antall samtidige PostgreSQL-tilkoblinger per appprosess. Med flere
 * replikaer må denne ganges med replikaantallet og holdes under databasens
 * `max_connections` (med margin til migrasjoner og drift).
 */
function poolMax(): number {
  const parsed = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
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
      adapter: new PrismaPg(
        { connectionString: url.toString(), max: poolMax() },
        { schema },
      ),
    })
  }

  // Under bygg og statisk analyse kan DATABASE_URL mangle. Klienten kobler seg
  // ikke til før den første spørringen, så det er trygt å opprette den her.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: '', max: poolMax() }),
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
