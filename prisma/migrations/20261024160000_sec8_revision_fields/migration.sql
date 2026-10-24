-- AlterTable
ALTER TABLE "ReportRevision" ADD COLUMN     "comments" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "templateTitle" TEXT;

