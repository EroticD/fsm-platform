import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { clientIpFrom } from "@/lib/client-ip";
import { auditHashesForRow } from "@/lib/audit-chain";
import {
  publishRealtime,
  realtimeKindForEntity,
  type RealtimeSqlClient,
} from "@/lib/realtime";

export type AuditActor = {
  id: string;
  name: string | null;
  email: string | null;
  /** Avdelingen handlingen skjedde i. Brukes til avdelingssperret visning. */
  departmentId?: string | null;
};

export type AuditOutcome = "SUCCESS" | "DENIED" | "ERROR";

export type AuditRetentionClass = "ACCOUNTING_5Y" | "SECURITY_1Y" | "OPS_90D";

export type AuditRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  actor: AuditActor;
  metadata?: Prisma.InputJsonValue;
  /** Overstyrer aktørens avdeling når hendelsen gjelder en annen avdeling. */
  departmentId?: string | null;
  /** Stabil kode for filtrering, f.eks. `workorder.status.changed`. */
  actionCode?: string;
  /** Avviste og feilede handlinger er også hendelser. Standard: SUCCESS. */
  outcome?: AuditOutcome;
  retentionClass?: AuditRetentionClass | null;
  /** Brukeren handlingen gjaldt, når den er en annen enn aktøren. */
  targetUserId?: string | null;
  /** Hvor forespørselen kom fra. Fylles med `auditRequestContext()`. */
  context?: AuditRequestContext;
};

/** Låsen serialiserer hash-kjedens hale innenfor transaksjonen. */
const AUDIT_CHAIN_LOCK = "fsm.auditlog.chain";

type AuditTx = Prisma.TransactionClient & {
  $queryRaw?: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

/**
 * Tar en transaksjonslås før forrige hash leses. Uten den kan to samtidige
 * transaksjoner lese samme hale og skrive hver sin forgrening. Låsen slippes
 * automatisk ved commit/rollback.
 *
 * Testmocker har ingen `$queryRaw`; da hoppes låsen over. Produksjonskoden
 * bruker alltid en ekte Prisma-transaksjon.
 */
async function lockAuditChain(tx: AuditTx): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${AUDIT_CHAIN_LOCK}))::text AS lock`;
}

/**
 * Skriver en revisjonslogg inni samme transaksjon som mutasjonen.
 *
 * Da kan ikke en vellykket endring stå uten logg, eller en logg føres for en
 * endring som senere rulles tilbake. Bruk alltid den faktiske id-en til
 * entiteten – aldri en tittel – slik at loggen kan følges over tid.
 *
 * Hver rad bindes til forrige rad med SHA-256. `createdAt` settes eksplisitt
 * slik at hashen beskriver nøyaktig den lagrede raden.
 */
export async function audit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  const client = tx as AuditTx;
  await lockAuditChain(client);

  const previous =
    typeof tx.auditLog.findFirst === "function"
      ? await tx.auditLog.findFirst({
          orderBy: { seq: "desc" },
          select: { hash: true },
        })
      : null;

  const createdAt = new Date();
  const fields = {
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    userName: entry.actor.name || entry.actor.email || "Ukjent",
    actorId: entry.actor.id || null,
    departmentId:
      entry.departmentId ?? entry.actor.departmentId ?? null,
    metadata: entry.metadata ?? null,
    actionCode: entry.actionCode ?? null,
    outcome: entry.outcome ?? "SUCCESS",
    retentionClass: entry.retentionClass ?? null,
    targetUserId: entry.targetUserId ?? null,
    ip: entry.context?.ip ?? null,
    userAgent: entry.context?.userAgent ?? null,
    requestId: entry.context?.requestId ?? null,
    createdAt,
  };
  const hashes = auditHashesForRow(fields, previous?.hash ?? null);

  await tx.auditLog.create({
    data: {
      ...fields,
      metadata: entry.metadata,
      ...hashes,
    },
  });

  // Varselet sendes i samme transaksjon. PostgreSQL leverer det først ved
  // commit, så en tilbake rullet endring gir ingen oppdatering i klientene.
  // Testmocker uten `$executeRaw` hoppes over inne i `publishRealtime`.
  await publishRealtime(
    realtimeKindForEntity(entry.entityType),
    tx as RealtimeSqlClient,
  );
}

/**
 * Skriver en revisjonsrad utenfor en eksisterende transaksjon.
 *
 * Brukes der handlingen ikke selv skriver forretningsdata – innlogging,
 * utlogging, avviste kall – men fortsatt skal ligge i den hash-kjedede loggen.
 * Raden skrives i egen transaksjon, så låsen holdes kort.
 */
export async function auditStandalone(entry: AuditEntry): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await audit(tx, entry);
  });
}

/**
 * Henter IP, brukeragent og request-id fra den aktive forespørselen.
 *
 * `next/headers` importeres dynamisk fordi `audit.ts` også brukes av skript og
 * jobber utenfor Next-konteksten. Der returneres et tomt sett i stedet for å
 * kaste, slik at logging aldri velter selve handlingen.
 */
export async function auditRequestContext(): Promise<AuditRequestContext> {
  try {
    const { headers } = await import("next/headers");
    const requestHeaders = await headers();
    return {
      ip: clientIpFrom(requestHeaders),
      userAgent: requestHeaders.get("user-agent")?.slice(0, 512) ?? null,
      requestId: requestHeaders.get("x-request-id")?.slice(0, 128) ?? null,
    };
  } catch {
    return {};
  }
}
