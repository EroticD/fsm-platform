-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "MaintenanceTrigger" AS ENUM ('CALENDAR', 'METER');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "criticality" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "installDate" DATE,
ADD COLUMN     "meterUnit" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "qrToken" TEXT,
ADD COLUMN     "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "warrantyNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "warrantyUntil" DATE;

-- CreateTable
CREATE TABLE "EquipmentCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "visitId" TEXT,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trigger" "MaintenanceTrigger" NOT NULL,
    "intervalMonths" INTEGER,
    "meterInterval" DECIMAL(12,2),
    "leadDays" INTEGER NOT NULL DEFAULT 14,
    "nextDueDate" DATE,
    "lastMeterValue" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productId" TEXT,
    "customerId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenancePlanOccurrence" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "workOrderId" TEXT,
    "meterValue" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenancePlanOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentCategory_parentId_idx" ON "EquipmentCategory"("parentId");

-- CreateIndex
CREATE INDEX "EquipmentCategory_name_idx" ON "EquipmentCategory"("name");

-- CreateIndex
CREATE INDEX "MeterReading_productId_readAt_idx" ON "MeterReading"("productId", "readAt");

-- CreateIndex
CREATE INDEX "MeterReading_visitId_idx" ON "MeterReading"("visitId");

-- CreateIndex
CREATE INDEX "MeterReading_userId_idx" ON "MeterReading"("userId");

-- CreateIndex
CREATE INDEX "MaintenancePlan_nextDueDate_isActive_idx" ON "MaintenancePlan"("nextDueDate", "isActive");

-- CreateIndex
CREATE INDEX "MaintenancePlan_customerId_idx" ON "MaintenancePlan"("customerId");

-- CreateIndex
CREATE INDEX "MaintenancePlan_productId_idx" ON "MaintenancePlan"("productId");

-- CreateIndex
CREATE INDEX "MaintenancePlan_departmentId_idx" ON "MaintenancePlan"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlanOccurrence_workOrderId_key" ON "MaintenancePlanOccurrence"("workOrderId");

-- CreateIndex
CREATE INDEX "MaintenancePlanOccurrence_status_dueDate_idx" ON "MaintenancePlanOccurrence"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlanOccurrence_planId_dueDate_key" ON "MaintenancePlanOccurrence"("planId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Product_qrToken_key" ON "Product"("qrToken");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_parentId_idx" ON "Product"("parentId");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_warrantyUntil_idx" ON "Product"("warrantyUntil");

-- AddForeignKey
ALTER TABLE "EquipmentCategory" ADD CONSTRAINT "EquipmentCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EquipmentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlanOccurrence" ADD CONSTRAINT "MaintenancePlanOccurrence_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlanOccurrence" ADD CONSTRAINT "MaintenancePlanOccurrence_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: eksisterende enheter skal også ha en QR-identitet, slik at
-- etiketten kan skrives ut uten en manuell rotasjon først. Nye enheter får
-- token fra tjenestelaget; denne setningen gjelder bare rader fra før fasen.
UPDATE "Product"
SET "qrToken" = md5(random()::text || clock_timestamp()::text || "id")
WHERE "qrToken" IS NULL;
