-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false;

