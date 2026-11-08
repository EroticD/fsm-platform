-- Additiv tabell for idempotente ordrer fra eksterne ordresystemer.
-- `(source, externalId)` er primærnøkkelen for idempotens; `workOrderId` er
-- unik fordi hver eksterne ordre mapper til nøyaktig ett oppdrag.

CREATE TABLE "ExternalOrder" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "workOrderId" TEXT NOT NULL,
    "priority" TEXT,
    "requestHash" TEXT NOT NULL,
    "payload" JSONB,
    "lines" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalOrder_source_externalId_key" ON "ExternalOrder"("source", "externalId");
CREATE UNIQUE INDEX "ExternalOrder_source_idempotencyKey_key" ON "ExternalOrder"("source", "idempotencyKey");
CREATE UNIQUE INDEX "ExternalOrder_workOrderId_key" ON "ExternalOrder"("workOrderId");
CREATE INDEX "ExternalOrder_source_receivedAt_idx" ON "ExternalOrder"("source", "receivedAt");

ALTER TABLE "ExternalOrder" ADD CONSTRAINT "ExternalOrder_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
