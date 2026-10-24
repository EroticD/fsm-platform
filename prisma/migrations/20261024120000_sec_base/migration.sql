-- DropIndex
DROP INDEX "Notification_emailSentAt_idx";

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "hourlyRate" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "hourlyRate" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "activeKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "calendarTokenCreatedAt" TIMESTAMP(3),
ADD COLUMN     "calendarTokenHash" TEXT,
ADD COLUMN     "calendarTokenLastUsedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT;

-- CreateTable
CREATE TABLE "ReportRevision" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "dataJson" TEXT NOT NULL,
    "unitsJson" TEXT NOT NULL,
    "templateSnapshotJson" TEXT,
    "technicianSignatureUrl" TEXT,
    "customerSignatureUrl" TEXT,
    "technicianName" TEXT,
    "customerName" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportRevision_reportId_createdAt_idx" ON "ReportRevision"("reportId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRevision_reportId_revision_key" ON "ReportRevision"("reportId", "revision");

-- CreateIndex
CREATE INDEX "Customer_deletedAt_idx" ON "Customer"("deletedAt");

-- CreateIndex
CREATE INDEX "Document_deletedAt_idx" ON "Document"("deletedAt");

-- CreateIndex
CREATE INDEX "Notification_emailSentAt_emailNextAttemptAt_idx" ON "Notification"("emailSentAt", "emailNextAttemptAt");

-- CreateIndex
CREATE INDEX "Report_deletedAt_idx" ON "Report"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_activeKey_key" ON "TimeEntry"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarTokenHash_key" ON "User"("calendarTokenHash");

-- CreateIndex
CREATE INDEX "WorkOrder_deletedAt_idx" ON "WorkOrder"("deletedAt");

-- AddForeignKey
ALTER TABLE "ReportRevision" ADD CONSTRAINT "ReportRevision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

