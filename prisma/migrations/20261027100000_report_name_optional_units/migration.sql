-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "name" TEXT,
ADD COLUMN     "requiresUnits" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ReportRevision" ADD COLUMN     "name" TEXT,
ADD COLUMN     "requiresUnits" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "reportName" TEXT,
ADD COLUMN     "requiresUnits" BOOLEAN NOT NULL DEFAULT true;

