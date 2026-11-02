import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import prisma from "@/lib/prisma";

/**
 * Egen databaseklient for retensjonsjobben når runtime-rollen er låst.
 *
 * Anbefalt produksjonsoppsett gir `fsm_app` INSERT (men ikke UPDATE/DELETE) på
 * revisjonstabellene. Da kan jobben ikke purre med runtime-tilkoblingen. Sett
 * `AUDIT_RETENTION_DATABASE_URL` til en vedlikeholdsrolle med DELETE på
 * AuditLog; uten variabelen brukes den vanlige klienten, slik at enkle
 * installasjoner og tester virker som før.
 */
let maintenanceClient: PrismaClient | null = null;

export function auditMaintenancePrisma(): PrismaClient {
  const connectionString = process.env.AUDIT_RETENTION_DATABASE_URL;
  if (!connectionString) return prisma;

  if (!maintenanceClient) {
    const url = new URL(connectionString);
    const schema = url.searchParams.get("schema") ?? undefined;
    url.searchParams.delete("schema");
    maintenanceClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
    });
  }
  return maintenanceClient;
}
