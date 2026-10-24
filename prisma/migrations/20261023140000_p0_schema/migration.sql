-- P0: øktversjon, opplastingsmetadata og uforanderlige rapporter.
--
-- MERK: Den unike indeksen på Report(workOrderId, templateId) feiler hvis det
-- finnes duplikater. Sjekk før migreringen:
--   SELECT "workOrderId", "templateId", count(*)
--   FROM "Report" WHERE "templateId" IS NOT NULL
--   GROUP BY 1,2 HAVING count(*) > 1;
-- Duplikater må løses manuelt før denne migreringen kjøres.

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "templateSnapshotJson" TEXT,
ADD COLUMN     "templateTitle" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "departmentId" TEXT,
    "customerId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_storedName_key" ON "Upload"("storedName");

-- CreateIndex
CREATE INDEX "Upload_ownerType_ownerId_idx" ON "Upload"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Upload_departmentId_idx" ON "Upload"("departmentId");

-- CreateIndex
CREATE INDEX "Upload_uploadedById_idx" ON "Upload"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "Report_workOrderId_templateId_key" ON "Report"("workOrderId", "templateId");
