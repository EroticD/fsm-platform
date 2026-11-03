-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "CustomerTransferJob" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "packageChecksum" TEXT,
    "sourceInstanceId" TEXT,
    "schemaVersion" TEXT,
    "customerIdsJson" JSONB,
    "countsJson" JSONB,
    "errorJson" JSONB,
    "resultJson" JSONB,
    "progressStage" TEXT,
    "progressProcessed" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "previewTokenHash" TEXT,
    "previewExpiresAt" TIMESTAMP(3),
    "targetFingerprint" TEXT,
    "stagingPath" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTransferJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTransferRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceInstanceId" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTransferRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerTransferJob_actorId_createdAt_idx" ON "CustomerTransferJob"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerTransferJob_kind_status_idx" ON "CustomerTransferJob"("kind", "status");

-- CreateIndex
CREATE INDEX "CustomerTransferJob_expiresAt_idx" ON "CustomerTransferJob"("expiresAt");

-- CreateIndex
CREATE INDEX "CustomerTransferJob_packageChecksum_idx" ON "CustomerTransferJob"("packageChecksum");

-- CreateIndex
CREATE INDEX "CustomerTransferRecord_sourceInstanceId_sourceEntityType_so_idx" ON "CustomerTransferRecord"("sourceInstanceId", "sourceEntityType", "sourceId");

-- CreateIndex
CREATE INDEX "CustomerTransferRecord_jobId_action_idx" ON "CustomerTransferRecord"("jobId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerTransferRecord_jobId_sourceInstanceId_sourceEntityT_key" ON "CustomerTransferRecord"("jobId", "sourceInstanceId", "sourceEntityType", "sourceId");

-- CreateIndex
CREATE INDEX "Document_customerId_idx" ON "Document"("customerId");

-- CreateIndex
CREATE INDEX "Document_productId_idx" ON "Document"("productId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTransferRecord" ADD CONSTRAINT "CustomerTransferRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CustomerTransferJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

