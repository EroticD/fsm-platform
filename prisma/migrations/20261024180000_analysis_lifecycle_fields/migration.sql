-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailLockedAt" TIMESTAMP(3),
ADD COLUMN     "emailLockedBy" TEXT;

-- AlterTable
ALTER TABLE "ReportRevision" ADD COLUMN     "customerAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "customerAcknowledgedBy" TEXT,
ADD COLUMN     "customerAcknowledgedComment" TEXT;

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "Upload_contentHash_idx" ON "Upload"("contentHash");

