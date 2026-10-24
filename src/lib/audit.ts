import type { Prisma } from "@prisma/client";

export type AuditActor = {
  id: string;
  name: string | null;
  email: string | null;
};

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  actor: AuditActor;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Skriver en revisjonslogg inni samme transaksjon som mutasjonen.
 *
 * Da kan ikke en vellykket endring stå uten logg, eller en logg føres for en
 * endring som senere rulles tilbake. Bruk alltid den faktiske id-en til
 * entiteten – aldri en tittel – slik at loggen kan følges over tid.
 */
export async function audit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      userName: entry.actor.name || entry.actor.email || "Ukjent",
      actorId: entry.actor.id || null,
      metadata: entry.metadata,
    },
  });
}
