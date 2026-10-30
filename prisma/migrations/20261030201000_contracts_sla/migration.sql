-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "RenewalMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "SlaState" AS ENUM ('ON_TRACK', 'AT_RISK', 'BREACHED', 'MET', 'CANCELLED');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "contractNumber" TEXT,
ADD COLUMN     "endDate" DATE,
ADD COLUMN     "indexationPercent" DECIMAL(5,2),
ADD COLUMN     "noticeDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "priceListId" TEXT,
ADD COLUMN     "renewalMode" "RenewalMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "slaPolicyId" TEXT,
ADD COLUMN     "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "ContractLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "productId" TEXT,
    "scope" TEXT NOT NULL DEFAULT '',
    "visitsPerYear" INTEGER,
    "responseMinutes" INTEGER,
    "resolutionMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaClock" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "respondBy" TIMESTAMP(3) NOT NULL,
    "resolveBy" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "state" "SlaState" NOT NULL DEFAULT 'ON_TRACK',
    "breachedAt" TIMESTAMP(3),

    CONSTRAINT "SlaClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractLine_contractId_idx" ON "ContractLine"("contractId");

-- CreateIndex
CREATE INDEX "ContractLine_productId_idx" ON "ContractLine"("productId");

-- CreateIndex
CREATE INDEX "PriceList_isActive_idx" ON "PriceList"("isActive");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_idx" ON "PriceListItem"("priceListId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_code_key" ON "PriceListItem"("priceListId", "code");

-- CreateIndex
CREATE INDEX "SlaPolicy_departmentId_idx" ON "SlaPolicy"("departmentId");

-- CreateIndex
CREATE INDEX "SlaPolicy_isActive_idx" ON "SlaPolicy"("isActive");

-- CreateIndex
CREATE INDEX "SlaClock_state_resolveBy_idx" ON "SlaClock"("state", "resolveBy");

-- CreateIndex
CREATE INDEX "SlaClock_workOrderId_idx" ON "SlaClock"("workOrderId");

-- CreateIndex
CREATE INDEX "SlaClock_policyId_idx" ON "SlaClock"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaClock_workOrderId_policyId_key" ON "SlaClock"("workOrderId", "policyId");

-- CreateIndex
CREATE INDEX "BusinessHours_departmentId_idx" ON "BusinessHours"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHours_departmentId_weekday_key" ON "BusinessHours"("departmentId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_departmentId_key" ON "Holiday"("date", "departmentId");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_departmentId_idx" ON "Holiday"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- CreateIndex
CREATE INDEX "Contract_status_endDate_idx" ON "Contract"("status", "endDate");

-- CreateIndex
CREATE INDEX "Contract_slaPolicyId_idx" ON "Contract"("slaPolicyId");

-- CreateIndex
CREATE INDEX "Contract_priceListId_idx" ON "Contract"("priceListId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaClock" ADD CONSTRAINT "SlaClock_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaClock" ADD CONSTRAINT "SlaClock_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SlaPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHours" ADD CONSTRAINT "BusinessHours_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: eksisterende avtaler hadde bare `isActive`. Pausede avtaler blir
-- PAUSED, aktive blir ACTIVE. Nye statuser (DRAFT/EXPIRED/TERMINATED) er bare
-- mulige etter denne migreringen.
UPDATE "Contract" SET "status" = 'PAUSED' WHERE "isActive" = false;

-- Rettigheter (C-02/N-12): nye nøkler må legges på de seedede rollene, ellers
-- får kontor og montør aldri tilgang uten manuell rolle-redigering.
-- Administrator har alltid alle rettigheter i koden, men raden oppdateres også
-- slik at rolleoversikten i innstillingene viser riktig liste.
UPDATE "Role"
SET "permissions" = (
  SELECT ARRAY(
    SELECT DISTINCT unnest("permissions" || ARRAY['contracts.view', 'contracts.manage', 'sla.manage']::TEXT[])
  )
)
WHERE "key" = 'ADMIN';

UPDATE "Role"
SET "permissions" = (
  SELECT ARRAY(
    SELECT DISTINCT unnest("permissions" || ARRAY['contracts.view', 'contracts.manage']::TEXT[])
  )
)
WHERE "key" = 'OFFICE';

UPDATE "Role"
SET "permissions" = (
  SELECT ARRAY(
    SELECT DISTINCT unnest("permissions" || ARRAY['contracts.view']::TEXT[])
  )
)
WHERE "key" = 'TECHNICIAN';
