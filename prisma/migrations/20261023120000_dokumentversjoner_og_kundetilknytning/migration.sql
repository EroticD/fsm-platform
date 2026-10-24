-- Dokumentversjoner og kundetilknytning.
--
-- Disse endringene ble opprinnelig laget med `prisma db push` lokalt, men må
-- ligge i en migrasjon slik at `prisma migrate deploy` oppretter dem i
-- produksjon. Kjør migrasjonen på en tom database og verifiser med
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "responsibleTechnicianId" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "Customer_departmentId_idx" ON "Customer"("departmentId");

-- CreateIndex
CREATE INDEX "Customer_responsibleTechnicianId_idx" ON "Customer"("responsibleTechnicianId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_responsibleTechnicianId_fkey" FOREIGN KEY ("responsibleTechnicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
