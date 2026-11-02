-- Revisjonslogg: hash-kjede, avdelingstilhørighet, bevaringsplikt og retensjon.
--
-- `seq` gir en monoton rekkefølge som hash-kjeden følger. Den settes av
-- databasen slik at to hendelser i samme millisekund fortsatt får en entydig
-- rekkefølge. `hash` og `prevHash` er nullable i migreringen fordi eksisterende
-- rader må backfylles deterministisk av scripts/backfill-audit-chain.ts.
--
-- Selve revisjonsraden skal aldri endres etter at den er skrevet. Bevaringsplikt
-- ligger derfor i `AuditHold`, og hash-verdier som purres med vilje havner i
-- `AuditPurgedHash`, slik at et kontrollert hull kan skilles fra manipulering.

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "AuditRetentionSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AuditRetentionSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditHold" (
    "id" TEXT NOT NULL,
    "auditLogId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,

    CONSTRAINT "AuditHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPurgedHash" (
    "hash" TEXT NOT NULL,
    "purgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "AuditPurgedHash_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "AuditHold_auditLogId_idx" ON "AuditHold"("auditLogId");

-- CreateIndex
CREATE INDEX "AuditHold_entityType_entityId_idx" ON "AuditHold"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditHold_releasedAt_idx" ON "AuditHold"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE INDEX "AuditLog_departmentId_createdAt_idx" ON "AuditLog"("departmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_hash_idx" ON "AuditLog"("hash");

-- CreateIndex
CREATE INDEX "AuditLog_prevHash_idx" ON "AuditLog"("prevHash");

-- Standardkonfigurasjon. Retensjonsjobben faller tilbake til denne når raden
-- mangler, og administratoren kan endre den i Innstillinger → Aktivitetslogg.
INSERT INTO "AuditRetentionSetting" ("id", "retentionDays", "updatedAt")
VALUES ('default', 365, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
